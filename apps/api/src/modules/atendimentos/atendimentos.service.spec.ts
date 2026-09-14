import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AtendimentosService, inicioPadraoDaConsulta, intervaloDeCriacaoBR } from './atendimentos.service';
import { ERRO_LINK } from '../../common/link-reuniao.util';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../../common/audit/audit.service';
import type { EscalasService } from '../escalas/escalas.service';
import type { AgendaService } from '../agenda/agenda.service';

/**
 * O QUE A CONSULTA CRIADA LEVA — testado EXECUTANDO o serviço.
 *
 * Até 13/09/2026 nada afirmava o `data` do `compromisso.create`: o que tocava
 * este módulo lia o fonte com `toContain('proximoHorarioUtilBR(')`, que prova
 * que a linha existe, não que acerta. Foi assim que a consulta "de amanhã às
 * 9h" nasceu às 06:00 durante semanas.
 *
 * O mundo é pequeno e explícito: quatro pessoas ativas, uma inativa. O banco é
 * falso, mas a regra roda inteira — inclusive `sincronizarEquipe`, dentro da
 * transação.
 */

const USUARIOS = [
  { id: 'u-ana', nome: 'Ana Souza', nomeExibicao: 'Dra. Ana', role: 'ADVOGADO', permissoes: null, ativo: true, avatarUrl: null, avatarKey: 'usuarios/ana.jpg' },
  { id: 'u-bruno', nome: 'Bruno Lima', nomeExibicao: null, role: 'ADVOGADO', permissoes: null, ativo: true, avatarUrl: null, avatarKey: null },
  { id: 'u-coord', nome: 'Carla Coordenação', nomeExibicao: null, role: 'COORDENACAO', permissoes: null, ativo: true, avatarUrl: 'https://externo/carla.png', avatarKey: null },
  // Matriz própria sem Agenda: não veria a consulta.
  { id: 'u-tri', nome: 'Tiago Triagem', nomeExibicao: null, role: 'TRIAGEM', permissoes: { agenda: 'SEM_ACESSO' }, ativo: true, avatarUrl: null, avatarKey: null },
  { id: 'u-saiu', nome: 'Saulo Saiu', nomeExibicao: null, role: 'ADVOGADO', permissoes: null, ativo: false, avatarUrl: null, avatarKey: null },
];

interface Mundo {
  atendimento?: Record<string, unknown> | null;
  compromisso?: Record<string, unknown> | null;
  plantao?: unknown[];
  lista?: unknown[];
}

function montar(mundo: Mundo = {}) {
  const gravado = {
    atendimentoCreate: [] as any[],
    atendimentoUpdate: [] as any[],
    compromissoCreate: [] as any[],
    compromissoUpdate: [] as any[],
    equipe: [] as { usuarioId: string; principal: boolean }[],
    transacoes: 0,
  };

  const tx = {
    atendimento: { updateMany: async (args: any) => { gravado.atendimentoUpdate.push(args); return { count: 1 }; } },
    compromisso: {
      create: async (args: any) => { gravado.compromissoCreate.push(args); return { id: 'c-novo' }; },
      update: async (args: any) => { gravado.compromissoUpdate.push(args); return {}; },
    },
    compromissoResponsavel: {
      deleteMany: async () => ({ count: 0 }),
      updateMany: async () => ({ count: 0 }),
      upsert: async ({ create }: any) => {
        gravado.equipe.push({ usuarioId: create.usuarioId, principal: create.principal });
        return {};
      },
      findFirst: async () => {
        const p = gravado.equipe.find((e) => e.principal);
        return p ? { usuarioId: p.usuarioId } : null;
      },
    },
  };

  const prisma = {
    filiado: { findUnique: async () => ({ id: 'f-1', nomeCompleto: 'Maria das Dores' }) },
    atendimento: {
      create: async (args: any) => {
        gravado.atendimentoCreate.push(args);
        return { id: 'a-novo', numero: 99, ...args.data };
      },
      findUnique: async () => mundo.atendimento ?? null,
      update: async (args: any) => { gravado.atendimentoUpdate.push(args); return {}; },
      updateMany: async (args: any) => { gravado.atendimentoUpdate.push(args); return { count: 1 }; },
      count: async () => (mundo.lista ?? []).length,
      findMany: async () => mundo.lista ?? [],
    },
    compromisso: {
      findUnique: async () => mundo.compromisso ?? null,
      update: async (args: any) => { gravado.compromissoUpdate.push(args); return {}; },
    },
    processo: { findUnique: async () => ({ id: 'p-1', numeroCNJ: '0000001-00.2026.5.22.0001' }) },
    user: {
      // Devolve na ORDEM INVERSA do cadastro: o banco não promete ordem nenhuma
      // num `in`, e o teste precisa provar que o serviço não depende dela.
      findMany: async ({ where }: any) =>
        USUARIOS.filter((u) => (!where?.id?.in || where.id.in.includes(u.id)) && (where?.ativo === undefined || u.ativo === where.ativo))
          .reverse()
          .map((u) => ({ ...u })),
    },
    $transaction: async (arg: any) => {
      gravado.transacoes++;
      return Array.isArray(arg) ? Promise.all(arg) : arg(tx);
    },
  } as unknown as PrismaService;

  const audit = { registrar: jest.fn(async () => undefined) };
  const escalas = { listarPlantao: jest.fn(async () => mundo.plantao ?? []) };
  const agenda = { registrarNoHistorico: jest.fn(async () => undefined) };

  const svc = new AtendimentosService(
    prisma, audit as unknown as AuditService, escalas as unknown as EscalasService, agenda as unknown as AgendaService,
  );
  return { svc, gravado, audit, escalas, agenda };
}

/** O atendimento a encaminhar, sem desfecho. */
const PENDENTE = {
  id: 'a-1', numero: 12, desfecho: null, urgente: false, urgenteMotivo: null,
  filiado: { id: 'f-1', nomeCompleto: 'Maria das Dores' },
};

const ENCAMINHAR = { resultado: 'ENCAMINHADO', tipoEncaminhamento: 'CONSULTA_NOVA' } as const;

/** Sexta, 18/09/2026, 17:00 em Teresina. */
const SEXTA_17H = new Date('2026-09-18T20:00:00.000Z');

describe('registrarDesfecho — o que a consulta criada leva', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(SEXTA_17H);
  });
  afterEach(() => jest.useRealTimers());

  async function encaminhar(dto: Record<string, unknown>, atendimento: Record<string, unknown> = PENDENTE) {
    const m = montar({ atendimento });
    jest.spyOn(m.svc, 'detalhe').mockResolvedValue({} as never);
    await m.svc.registrarDesfecho('a-1', { ...ENCAMINHAR, ...dto } as never, { userId: 'u-balcao' });
    return m;
  }

  it('sem data, na sede: consulta jurídica às 9h daqui do próximo dia útil, com 1h, sem local e sem link', async () => {
    const { gravado } = await encaminhar({ advogadoIds: ['u-ana'] });
    const data = gravado.compromissoCreate[0].data;

    // Sexta às 17h → segunda, 21/09, 09:00 de Teresina (12:00 UTC).
    expect(data.inicio).toEqual(new Date('2026-09-21T12:00:00.000Z'));
    expect(data.fim).toEqual(new Date('2026-09-21T13:00:00.000Z'));
    expect(data).toMatchObject({
      tipo: 'CONSULTA_JURIDICA',
      titulo: 'Consulta Jurídica — Maria das Dores',
      responsavelId: 'u-ana',
      filiadoId: 'f-1',
      atendimentoId: 'a-1',
      criadoPor: 'u-balcao',
      local: null,
      linkReuniao: null,
    });
    expect(data.urgente).toBeUndefined();
  });

  /** A data que a tela mostra (rota de opções) e a que o desfecho grava são a mesma. */
  it('a data padrão é a de inicioPadraoDaConsulta — a mesma que a rota de opções usa', async () => {
    const { gravado } = await encaminhar({ advogadoIds: ['u-ana'] });
    expect(gravado.compromissoCreate[0].data.inicio).toEqual(inicioPadraoDaConsulta(SEXTA_17H));
  });

  it('o primeiro ESCOLHIDO responde, mesmo que o banco devolva outra ordem; os demais participam', async () => {
    const { gravado } = await encaminhar({ advogadoIds: ['u-ana', 'u-bruno'] });
    expect(gravado.compromissoCreate[0].data.responsavelId).toBe('u-ana');
    expect(gravado.equipe).toEqual([
      { usuarioId: 'u-ana', principal: true },
      { usuarioId: 'u-bruno', principal: false },
    ]);
    // O texto histórico segue a ordem da escolha também.
    expect(gravado.atendimentoUpdate[0].data.responsavel).toBe('Dra. Ana, Bruno Lima');
  });

  it('com um advogado só, a equipe também é escrita (a linha principal existe)', async () => {
    const { gravado } = await encaminhar({ advogadoIds: ['u-bruno'] });
    expect(gravado.equipe).toEqual([{ usuarioId: 'u-bruno', principal: true }]);
    expect(gravado.compromissoUpdate).toEqual([{ where: { id: 'c-novo' }, data: { responsavelId: 'u-bruno' } }]);
  });

  it('por vídeo: local "Por chamada de vídeo", data escolhida intacta e o link extraído do convite colado', async () => {
    const { gravado } = await encaminhar({
      advogadoIds: ['u-ana'],
      modalidade: 'VIDEO',
      dataConsulta: '2026-09-22T13:30:00.000Z',
      linkReuniao: 'Participe da chamada: meet.google.com/abc-defg-hij',
    });
    const data = gravado.compromissoCreate[0].data;
    expect(data.inicio).toEqual(new Date('2026-09-22T13:30:00.000Z'));
    expect(data.local).toBe('Por chamada de vídeo');
    expect(data.linkReuniao).toBe('https://meet.google.com/abc-defg-hij');
  });

  it('por telefone: local "Por telefone", sem link', async () => {
    const { gravado } = await encaminhar({
      advogadoIds: ['u-ana'], modalidade: 'TELEFONE', dataConsulta: '2026-09-22T13:30:00.000Z',
    });
    expect(gravado.compromissoCreate[0].data).toMatchObject({ local: 'Por telefone', linkReuniao: null });
  });

  it('na sede declarada: local nulo, como sempre foi', async () => {
    const { gravado } = await encaminhar({ advogadoIds: ['u-ana'], modalidade: 'SEDE' });
    expect(gravado.compromissoCreate[0].data.local).toBeNull();
  });

  it.each(['VIDEO', 'TELEFONE'])('%s sem dia e hora é recusado — e nada é gravado', async (modalidade) => {
    const m = montar({ atendimento: PENDENTE });
    await expect(
      m.svc.registrarDesfecho('a-1', { ...ENCAMINHAR, advogadoIds: ['u-ana'], modalidade } as never, { userId: 'u' }),
    ).rejects.toThrow('precisa de dia e hora combinados');
    expect(m.gravado.transacoes).toBe(0);
  });

  it('link fora do vídeo é recusado', async () => {
    const m = montar({ atendimento: PENDENTE });
    await expect(
      m.svc.registrarDesfecho('a-1', {
        ...ENCAMINHAR, advogadoIds: ['u-ana'], modalidade: 'TELEFONE',
        dataConsulta: '2026-09-22T13:30:00.000Z', linkReuniao: 'https://meet.google.com/abc',
      } as never, { userId: 'u' }),
    ).rejects.toThrow('só vale para consulta por vídeo');
  });

  it('link http é recusado com a frase da regra única', async () => {
    const m = montar({ atendimento: PENDENTE });
    await expect(
      m.svc.registrarDesfecho('a-1', {
        ...ENCAMINHAR, advogadoIds: ['u-ana'], modalidade: 'VIDEO',
        dataConsulta: '2026-09-22T13:30:00.000Z', linkReuniao: 'http://meet.google.com/abc',
      } as never, { userId: 'u' }),
    ).rejects.toThrow(ERRO_LINK.http);
    expect(m.gravado.transacoes).toBe(0);
  });

  it('quem tem a Agenda SEM_ACESSO na matriz é recusado pelo nome', async () => {
    const m = montar({ atendimento: PENDENTE });
    const tentativa = m.svc.registrarDesfecho('a-1', { ...ENCAMINHAR, advogadoIds: ['u-ana', 'u-tri'] } as never, { userId: 'u' });
    await expect(tentativa).rejects.toThrow(BadRequestException);
    await expect(
      m.svc.registrarDesfecho('a-1', { ...ENCAMINHAR, advogadoIds: ['u-tri'] } as never, { userId: 'u' }),
    ).rejects.toThrow('Tiago Triagem não tem acesso à Agenda');
    expect(m.gravado.transacoes).toBe(0);
  });

  it('coordenação com Agenda pelo preset passa: a régua é a matriz, não o perfil', async () => {
    const { gravado } = await encaminhar({ advogadoIds: ['u-coord'] });
    expect(gravado.compromissoCreate[0].data.responsavelId).toBe('u-coord');
  });

  it('inativo ou inexistente é recusado', async () => {
    const m = montar({ atendimento: PENDENTE });
    await expect(
      m.svc.registrarDesfecho('a-1', { ...ENCAMINHAR, advogadoIds: ['u-saiu'] } as never, { userId: 'u' }),
    ).rejects.toThrow('inválido');
  });

  it('a urgência da triagem viaja para a consulta, com o motivo', async () => {
    const { gravado } = await encaminhar(
      { advogadoIds: ['u-ana'] },
      { ...PENDENTE, urgente: true, urgenteMotivo: 'Prazo de recurso na segunda' },
    );
    expect(gravado.compromissoCreate[0].data).toMatchObject({
      urgente: true,
      urgenteMotivo: 'Prazo de recurso na segunda',
      urgentePor: 'u-balcao',
    });
  });

  it('desfecho já registrado não é registrado de novo', async () => {
    const m = montar({ atendimento: { ...PENDENTE, desfecho: 'ENCAMINHADO' } });
    await expect(
      m.svc.registrarDesfecho('a-1', { ...ENCAMINHAR, advogadoIds: ['u-ana'] } as never, { userId: 'u' }),
    ).rejects.toThrow('já foi registrado');
  });

  it('a auditoria diz para quem, quando e como', async () => {
    const { audit } = await encaminhar({
      advogadoIds: ['u-ana'], modalidade: 'VIDEO', dataConsulta: '2026-09-22T13:30:00.000Z',
    });
    const registro = (audit.registrar.mock.calls[0] as any[])[0];
    expect(registro.descricao).toContain('Atendimento #12 encaminhado a Dra. Ana');
    expect(registro.descricao).toContain('22/09/2026');
    expect(registro.descricao).toContain('10:30');
    expect(registro.descricao).toContain('por vídeo');
    expect(registro.metadata).toMatchObject({ modalidade: 'VIDEO', comLink: false });
  });
});

/**
 * MARCAR NOVA CONSULTA (14/09/2026, D13 da rodada 3). Com todas as consultas
 * nascidas canceladas, o balcão encaminha de novo pelo mesmo atendimento — e só
 * nesse caso: com uma consulta de pé, encaminhar de novo criaria a duplicata.
 */
describe('registrarDesfecho — marcar nova consulta', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(SEXTA_17H);
  });
  afterEach(() => jest.useRealTimers());

  const CANCELADA = { id: 'c-1', status: 'CANCELADO' };
  const SEM_CONSULTA_DE_PE = { ...PENDENTE, desfecho: 'ENCAMINHADO', status: 'PENDENTE', compromissos: [CANCELADA] };

  it('todas canceladas e o atendimento pendente: nasce a nova consulta, e o primeiro desfecho fica como estava', async () => {
    const m = montar({ atendimento: SEM_CONSULTA_DE_PE });
    jest.spyOn(m.svc, 'detalhe').mockResolvedValue({} as never);
    await m.svc.registrarDesfecho('a-1', { ...ENCAMINHAR, advogadoIds: ['u-bruno'] } as never, { userId: 'u-balcao' });

    expect(m.gravado.compromissoCreate).toHaveLength(1);
    expect(m.gravado.compromissoCreate[0].data).toMatchObject({ responsavelId: 'u-bruno', atendimentoId: 'a-1' });
    const data = m.gravado.atendimentoUpdate[0].data;
    // O painel mede o tempo até a primeira resposta por `desfechoEm`: não recomeça.
    expect(data).not.toHaveProperty('desfecho');
    expect(data).not.toHaveProperty('desfechoEm');
    expect(data).not.toHaveProperty('desfechoObs');
    expect(data).toMatchObject({ tipoEncaminhamento: 'CONSULTA_NOVA', responsavel: 'Bruno Lima' });

    const registro = (m.audit.registrar.mock.calls[0] as any[])[0];
    expect(registro.descricao).toContain('Atendimento #12 encaminhado de novo a Bruno Lima');
    expect(registro.metadata).toMatchObject({ novaConsulta: true, consultasCanceladasAntes: ['c-1'] });
  });

  it('a nota para quem vai atender só é trocada quando vem uma nova', async () => {
    const m = montar({ atendimento: SEM_CONSULTA_DE_PE });
    jest.spyOn(m.svc, 'detalhe').mockResolvedValue({} as never);
    await m.svc.registrarDesfecho(
      'a-1', { ...ENCAMINHAR, advogadoIds: ['u-ana'], desfechoObs: ' Levar o contracheque de agosto. ' } as never, { userId: 'u' },
    );
    expect(m.gravado.atendimentoUpdate[0].data.desfechoObs).toBe('Levar o contracheque de agosto.');
    expect(m.gravado.compromissoCreate[0].data.descricao).toBe('Levar o contracheque de agosto.');
  });

  it.each([
    ['uma consulta ainda de pé', { compromissos: [CANCELADA, { id: 'c-2', status: 'PENDENTE' }] }],
    ['a consulta em andamento', { compromissos: [CANCELADA, { id: 'c-2', status: 'EM_ANDAMENTO' }] }],
    ['o atendimento cancelado', { status: 'CANCELADO' }],
    ['o atendimento concluído', { status: 'CONCLUIDO' }],
    ['nenhuma consulta nascida', { compromissos: [] }],
    ['o desfecho foi resolvido no ato', { desfecho: 'RESOLVIDO_ATO' }],
  ])('recusa com %s — e nada é gravado', async (_caso, parcial) => {
    const m = montar({ atendimento: { ...SEM_CONSULTA_DE_PE, ...parcial } });
    await expect(
      m.svc.registrarDesfecho('a-1', { ...ENCAMINHAR, advogadoIds: ['u-ana'] } as never, { userId: 'u' }),
    ).rejects.toThrow('já foi registrado');
    expect(m.gravado.transacoes).toBe(0);
  });

  it('encaminhado com as consultas canceladas não vira "resolvido no ato" por esta porta', async () => {
    const m = montar({ atendimento: SEM_CONSULTA_DE_PE });
    await expect(
      m.svc.registrarDesfecho('a-1', { resultado: 'RESOLVIDO_ATO', desfechoObs: 'Resolvido' } as never, { userId: 'u' }),
    ).rejects.toThrow('já foi registrado');
    expect(m.gravado.atendimentoUpdate).toHaveLength(0);
  });
});

describe('criar — o assunto Outro guarda o "qual assunto?"', () => {
  it('Outro grava o texto limpo; assunto da lista grava nulo no texto', async () => {
    const m = montar();
    await m.svc.criar({ filiadoId: 'f-1', canal: 'WHATSAPP', descricao: 'Dúvida', assunto: 'OUTRO', assuntoOutro: '  aposentadoria ' } as never, { userId: 'u' });
    await m.svc.criar({ filiadoId: 'f-1', canal: 'WHATSAPP', descricao: 'Dúvida', assunto: 'REMUNERACAO', assuntoOutro: 'aposentadoria' } as never, { userId: 'u' });
    expect(m.gravado.atendimentoCreate.map((c) => [c.data.assunto, c.data.assuntoOutro])).toEqual([
      ['OUTRO', 'aposentadoria'],
      ['REMUNERACAO', null],
    ]);
    // Rótulo, não o enum, na frase.
    expect((m.audit.registrar.mock.calls[0] as any[])[0].descricao).toContain('(WhatsApp)');
  });

  it('Outro sem texto é recusado antes de gravar', async () => {
    const m = montar();
    await expect(
      m.svc.criar({ filiadoId: 'f-1', canal: 'PRESENCIAL', descricao: 'Dúvida', assunto: 'OUTRO' } as never, { userId: 'u' }),
    ).rejects.toThrow(BadRequestException);
    expect(m.gravado.atendimentoCreate).toHaveLength(0);
  });
});

describe('atualizarAssunto — classificar depois', () => {
  const ATUAL = { id: 'a-1', numero: 12, assunto: 'REMUNERACAO', assuntoOutro: null };

  it('grava e audita de → para', async () => {
    const m = montar({ atendimento: ATUAL });
    jest.spyOn(m.svc, 'detalhe').mockResolvedValue({} as never);
    await m.svc.atualizarAssunto('a-1', { assunto: 'OUTRO', assuntoOutro: 'aposentadoria' } as never, { userId: 'u' });

    expect(m.gravado.atendimentoUpdate).toEqual([
      { where: { id: 'a-1' }, data: { assunto: 'OUTRO', assuntoOutro: 'aposentadoria' } },
    ]);
    const registro = (m.audit.registrar.mock.calls[0] as any[])[0];
    expect(registro.descricao).toBe('Atendimento #12: assunto de "Remuneração" para "Outro: aposentadoria"');
    expect(registro.metadata.alteracoes).toEqual([
      { campo: 'assunto', label: 'Assunto', de: 'REMUNERACAO', para: 'OUTRO' },
      { campo: 'assuntoOutro', label: 'Qual assunto', de: null, para: 'aposentadoria' },
    ]);
  });

  it('tirar o assunto também é classificar', async () => {
    const m = montar({ atendimento: { ...ATUAL, assunto: 'OUTRO', assuntoOutro: 'plano de saúde' } });
    jest.spyOn(m.svc, 'detalhe').mockResolvedValue({} as never);
    await m.svc.atualizarAssunto('a-1', { assunto: null } as never, { userId: 'u' });
    expect(m.gravado.atendimentoUpdate[0].data).toEqual({ assunto: null, assuntoOutro: null });
  });

  it('o mesmo assunto de novo não grava nem deixa linha no log', async () => {
    const m = montar({ atendimento: ATUAL });
    jest.spyOn(m.svc, 'detalhe').mockResolvedValue({} as never);
    await m.svc.atualizarAssunto('a-1', { assunto: 'REMUNERACAO', assuntoOutro: 'ignorado' } as never, { userId: 'u' });
    expect(m.gravado.atendimentoUpdate).toHaveLength(0);
    expect(m.audit.registrar).not.toHaveBeenCalled();
  });

  it('atendimento que não existe: 404', async () => {
    const m = montar({ atendimento: null });
    await expect(m.svc.atualizarAssunto('x', { assunto: null } as never, { userId: 'u' })).rejects.toThrow(NotFoundException);
  });
});

describe('opcoesDoEncaminhamento — o plantão do dia da CONSULTA', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(SEXTA_17H);
  });
  afterEach(() => jest.useRealTimers());

  const PLANTAO = [
    { id: 'e-1', data: new Date('2026-09-21T00:00:00Z'), horaInicio: '09:00', horaFim: '12:00', advogado: { id: 'u-bruno', nome: 'Bruno Lima', nomeExibicao: null } },
    // De plantão, mas sem Agenda: o desfecho recusaria — não é oferecido.
    { id: 'e-2', data: new Date('2026-09-21T00:00:00Z'), horaInicio: '14:00', horaFim: '17:00', advogado: { id: 'u-tri', nome: 'Tiago Triagem', nomeExibicao: null } },
  ];

  it('sem data: o dia padrão é o dia em que a consulta cairia (sexta → segunda)', async () => {
    const m = montar({ plantao: PLANTAO });
    const r = await m.svc.opcoesDoEncaminhamento(undefined, SEXTA_17H);
    expect(r.dataPadrao).toBe('2026-09-21');
    expect(r.dia).toBe('2026-09-21');
    expect(m.escalas.listarPlantao).toHaveBeenCalledWith('2026-09-21');
  });

  it('com data: o plantão é o daquele dia, e o padrão continua dito', async () => {
    const m = montar();
    const r = await m.svc.opcoesDoEncaminhamento('2026-09-24', SEXTA_17H);
    expect(r).toMatchObject({ dataPadrao: '2026-09-21', dia: '2026-09-24' });
    expect(m.escalas.listarPlantao).toHaveBeenCalledWith('2026-09-24');
  });

  it('advogados: só ativos com Agenda, perfil ADVOGADO primeiro, sem a matriz na resposta', async () => {
    const m = montar();
    const r = await m.svc.opcoesDoEncaminhamento(undefined, SEXTA_17H);
    expect(r.advogados.map((a) => a.id)).toEqual(
      expect.arrayContaining(['u-ana', 'u-bruno', 'u-coord']),
    );
    expect(r.advogados.map((a) => a.id)).not.toContain('u-tri');
    expect(r.advogados.map((a) => a.id)).not.toContain('u-saiu');
    const perfis = r.advogados.map((a) => a.role);
    expect(perfis.slice(0, 2)).toEqual(['ADVOGADO', 'ADVOGADO']);
    expect(perfis[2]).toBe('COORDENACAO');
    for (const a of r.advogados) expect(a).not.toHaveProperty('permissoes');
  });

  it('plantão no formato do contrato, com a foto a resolver, e sem quem não veria a consulta', async () => {
    const m = montar({ plantao: PLANTAO });
    const r = await m.svc.opcoesDoEncaminhamento(undefined, SEXTA_17H);
    expect(r.plantao).toEqual([
      {
        id: 'e-1',
        advogadoId: 'u-bruno',
        advogado: { id: 'u-bruno', nome: 'Bruno Lima', nomeExibicao: null, avatarUrl: null, avatarKey: null },
        horaInicio: '09:00',
        horaFim: '12:00',
      },
    ]);
  });
});

describe('atualizarLinkDaConsulta — colar o link depois', () => {
  const AT = { id: 'a-1', numero: 12 };
  const CONSULTA = {
    id: 'c-1', titulo: 'Consulta Jurídica — Maria', status: 'PENDENTE', atendimentoId: 'a-1',
    origemDesfechoId: null, linkReuniao: null, local: null,
  };

  function comConsulta(consulta: Record<string, unknown> | null) {
    // As duas leituras (atendimento e compromisso) usam findUnique diferentes.
    const m = montar({ atendimento: AT, compromisso: consulta });
    jest.spyOn(m.svc, 'detalhe').mockResolvedValue({} as never);
    return m;
  }

  it('cola o link normalizado e, sem local, marca a consulta como por vídeo', async () => {
    const m = comConsulta(CONSULTA);
    await m.svc.atualizarLinkDaConsulta('a-1', 'c-1', { linkReuniao: 'zoom.us/j/123456' }, { userId: 'u' });
    expect(m.gravado.compromissoUpdate).toEqual([
      { where: { id: 'c-1' }, data: { linkReuniao: 'https://zoom.us/j/123456', local: 'Por chamada de vídeo' } },
    ]);
    const registro = (m.audit.registrar.mock.calls[0] as any[])[0];
    expect(registro).toMatchObject({ entidade: 'Compromisso', entidadeId: 'c-1', metadata: { atendimentoId: 'a-1' } });
    expect(registro.metadata.alteracoes[0]).toEqual({ campo: 'linkReuniao', label: 'Link da chamada', de: null, para: 'https://zoom.us/j/123456' });
  });

  it('local escrito por alguém não é trocado', async () => {
    const m = comConsulta({ ...CONSULTA, local: 'Sala 2 da sede' });
    await m.svc.atualizarLinkDaConsulta('a-1', 'c-1', { linkReuniao: 'https://meet.google.com/abc-defg-hij' }, { userId: 'u' });
    expect(m.gravado.compromissoUpdate[0].data).toEqual({ linkReuniao: 'https://meet.google.com/abc-defg-hij' });
  });

  it('nulo tira o link', async () => {
    const m = comConsulta({ ...CONSULTA, linkReuniao: 'https://meet.google.com/abc-defg-hij', local: 'Por chamada de vídeo' });
    await m.svc.atualizarLinkDaConsulta('a-1', 'c-1', { linkReuniao: null }, { userId: 'u' });
    expect(m.gravado.compromissoUpdate[0].data).toEqual({ linkReuniao: null });
  });

  it('o mesmo link de novo não grava nem audita', async () => {
    const m = comConsulta({ ...CONSULTA, linkReuniao: 'https://meet.google.com/abc-defg-hij' });
    await m.svc.atualizarLinkDaConsulta('a-1', 'c-1', { linkReuniao: 'meet.google.com/abc-defg-hij' }, { userId: 'u' });
    expect(m.gravado.compromissoUpdate).toHaveLength(0);
    expect(m.audit.registrar).not.toHaveBeenCalled();
  });

  it('consulta de OUTRO atendimento: 404', async () => {
    const m = comConsulta({ ...CONSULTA, atendimentoId: 'a-outro' });
    await expect(m.svc.atualizarLinkDaConsulta('a-1', 'c-1', { linkReuniao: null }, { userId: 'u' })).rejects.toThrow(NotFoundException);
  });

  it('seguimento que herdou o atendimento não é a consulta: 404', async () => {
    const m = comConsulta({ ...CONSULTA, origemDesfechoId: 'c-0' });
    await expect(m.svc.atualizarLinkDaConsulta('a-1', 'c-1', { linkReuniao: null }, { userId: 'u' })).rejects.toThrow('não nasceu deste atendimento');
  });

  it.each([
    ['CONCLUIDO', 'concluída'],
    ['CANCELADO', 'cancelada'],
  ])('consulta %s não recebe link', async (status, palavra) => {
    const m = comConsulta({ ...CONSULTA, status });
    await expect(
      m.svc.atualizarLinkDaConsulta('a-1', 'c-1', { linkReuniao: 'https://meet.google.com/x-y-z' }, { userId: 'u' }),
    ).rejects.toThrow(palavra);
  });

  it('link inválido: 400 com a frase da regra', async () => {
    const m = comConsulta(CONSULTA);
    await expect(
      m.svc.atualizarLinkDaConsulta('a-1', 'c-1', { linkReuniao: 'javascript:alert(1)' }, { userId: 'u' }),
    ).rejects.toThrow(ERRO_LINK.naoEChamada);
  });
});

/**
 * O período da lista é o dia de Teresina, como nos Relatórios: a tela abre o
 * recorte que um número contou, e o corte à meia-noite UTC (21h daqui) punha o
 * atendimento das 22h do dia 12 no dia 13.
 */
describe('intervaloDeCriacaoBR — o período da lista', () => {
  it('começa às 00h daqui do primeiro dia e fecha quando o dia seguinte ao último começa', () => {
    expect(intervaloDeCriacaoBR('2026-08-13', '2026-09-12')).toEqual({
      gte: new Date('2026-08-13T03:00:00.000Z'),
      lt: new Date('2026-09-13T03:00:00.000Z'),
    });
  });

  it('o atendimento das 22h do dia 12 conta no dia 12, não no 13', () => {
    const r = intervaloDeCriacaoBR('2026-09-12', '2026-09-12')!;
    const vintEDuasHoras = new Date('2026-09-13T01:00:00.000Z');
    expect(vintEDuasHoras >= (r.gte as Date) && vintEDuasHoras < (r.lt as Date)).toBe(true);
    expect(intervaloDeCriacaoBR('2026-09-13', undefined)!.gte! > vintEDuasHoras).toBe(true);
  });

  it('uma ponta só, ou nenhuma; texto que não é data é ignorado', () => {
    expect(intervaloDeCriacaoBR(undefined, '2026-09-12')).toEqual({ lt: new Date('2026-09-13T03:00:00.000Z') });
    expect(intervaloDeCriacaoBR('2026-09-12T10:00', 'ontem')).toBeNull();
    expect(intervaloDeCriacaoBR()).toBeNull();
  });
});

describe('listar e detalhe — o encaminhamento derivado na leitura', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(new Date('2026-09-15T14:00:00.000Z'));
  });
  afterEach(() => jest.useRealTimers());

  const CONSULTA_ATENDIDA = {
    id: 'c-1', tipo: 'CONSULTA_JURIDICA', status: 'CONCLUIDO', inicio: new Date('2026-09-14T13:00:00Z'),
    local: null, linkReuniao: null, origemDesfechoId: null, createdAt: new Date('2026-09-10T10:00:00Z'),
    responsavel: { id: 'u-ana', nome: 'Ana Souza', nomeExibicao: 'Dra. Ana' },
  };

  it('listar: cada atendimento com consulta ganha o estado; sem consulta, nada; a lista crua não vaza', async () => {
    const m = montar({
      lista: [
        { id: 'a-1', numero: 1, compromissos: [CONSULTA_ATENDIDA] },
        { id: 'a-2', numero: 2, compromissos: [] },
      ],
    });
    const r = await m.svc.listar({});
    expect(r.items[0]).toMatchObject({ id: 'a-1', encaminhamento: { estado: 'ATENDIDA', compromissoId: 'c-1' } });
    expect(r.items[0]).not.toHaveProperty('compromissos');
    expect(r.items[1]).not.toHaveProperty('encaminhamento');
    expect(r.total).toBe(2);
  });

  it('detalhe: consultas sem o seguimento, e o estado vem delas', async () => {
    const seguimento = { ...CONSULTA_ATENDIDA, id: 'c-2', status: 'PENDENTE', inicio: new Date('2026-09-18T12:00:00Z'), origemDesfechoId: 'c-1', titulo: 'Retorno' };
    const m = montar({
      atendimento: {
        id: 'a-1', numero: 1,
        filiado: { id: 'f-1' },
        compromissos: [{ ...CONSULTA_ATENDIDA, titulo: 'Consulta' }, seguimento],
      },
      lista: [],
    });
    const r = await m.svc.detalhe('a-1');
    const at = r.atendimento as any;
    expect(at.consultas.map((c: any) => c.id)).toEqual(['c-1']);
    expect(at.consultas[0].status).toBe('CONCLUIDO');
    // A lista antiga continua inteira, para o web que ainda lê `compromissos`.
    expect(at.compromissos).toHaveLength(2);
    expect(at.encaminhamento).toMatchObject({ estado: 'ATENDIDA', compromissoId: 'c-1' });
  });
});
