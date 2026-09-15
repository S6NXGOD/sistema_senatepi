import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { StatusCompromisso, UserRole } from '@prisma/client';
import { ORIGEM_RESERVA } from '../agenda/equipe.util';
import { EscalasService } from './escalas.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * A TROCA DE PLANTÃO E AS CONSULTAS DE QUEM SAI (D16/D17 da rodada 3, 14/09/2026).
 *
 * O caso: a Dra. Shérad passa o plantão de terça, 15/09/2026, 09:00–12:00, ao
 * Dr. Murilo. O banco falso guarda compromissos, equipe e escalas em memória,
 * aplica os filtros de verdade (filtro que ele não conhece quebra), roda o
 * `passarConsultaEmTransacao` e o `sincronizarEquipe` reais e desfaz tudo se a
 * transação lançar — como o Postgres faria.
 *
 * Horários em UTC: 09:00 de Teresina é 12:00Z.
 */

const { PENDENTE, EM_ANDAMENTO, CANCELADO, CONCLUIDO } = StatusCompromisso;

type Pessoa = {
  id: string; nome: string; nomeExibicao: string | null; ativo: boolean; role: UserRole; permissoes: any;
};
const PESSOAS: Pessoa[] = [
  { id: 'sherad', nome: 'Shérad Lima', nomeExibicao: 'Dra. Shérad', ativo: true, role: UserRole.ADVOGADO, permissoes: null },
  { id: 'murilo', nome: 'Murilo Sá', nomeExibicao: 'Dr. Murilo', ativo: true, role: UserRole.ADVOGADO, permissoes: null },
  { id: 'margareth', nome: 'Margareth Costa', nomeExibicao: 'Dra. Margareth', ativo: true, role: UserRole.ADVOGADO, permissoes: null },
  { id: 'tiago', nome: 'Tiago Rocha', nomeExibicao: 'Dr. Tiago', ativo: true, role: UserRole.ADVOGADO, permissoes: null },
  { id: 'paulo', nome: 'Paulo Neto', nomeExibicao: 'Dr. Paulo', ativo: true, role: UserRole.ADVOGADO, permissoes: { agenda: 'SEM_ACESSO' } },
  { id: 'rosa', nome: 'Rosa Antiga', nomeExibicao: null, ativo: false, role: UserRole.ADVOGADO, permissoes: null },
];

const COORDENACAO = { id: 'coord', role: UserRole.COORDENACAO, permissoes: null };

interface Consulta {
  id: string; titulo: string; tipo: string; status: StatusCompromisso; inicio: Date; fim: Date;
  local: string | null; linkReuniao: string | null; responsavelId: string; origemDesfechoId: string | null;
  atendimento: { id: string; numero: number } | null;
  filiado: { id: string; nomeCompleto: string; telefonePrincipal: string | null; telefoneSecundario: string | null } | null;
}
interface LinhaDaEquipe { compromissoId: string; usuarioId: string; principal: boolean; origem: string | null }

const hora = (iso: string) => new Date(iso);
const umaHora = (iso: string) => new Date(hora(iso).getTime() + 3_600_000);

function consulta(id: string, inicioZ: string, extra: Partial<Consulta> = {}): Consulta {
  return {
    id, titulo: `Consulta jurídica ${id}`, tipo: 'CONSULTA_JURIDICA', status: PENDENTE,
    inicio: hora(inicioZ), fim: umaHora(inicioZ), local: null, linkReuniao: null, responsavelId: 'sherad',
    origemDesfechoId: null, atendimento: null, filiado: null, ...extra,
  };
}

const MARIA = { id: 'f-maria', nomeCompleto: 'Maria da Silva', telefonePrincipal: '(86) 3222-1111', telefoneSecundario: '(86) 99999-8888' };
const JOAO = { id: 'f-joao', nomeCompleto: 'João Pereira', telefonePrincipal: '(86) 98888-7777', telefoneSecundario: null };

/** A agenda de 15/09/2026 que o plantão da Dra. Shérad encontra. */
function agendaDoDia() {
  const consultas: Consulta[] = [
    // 09:00 — responde, por vídeo com link, da triagem (#412).
    consulta('c1', '2026-09-15T12:00:00.000Z', {
      local: 'Por chamada de vídeo', linkReuniao: 'https://meet.google.com/abc-defg-hij',
      atendimento: { id: 'a412', numero: 412 }, filiado: MARIA,
    }),
    // 10:00 — a Dra. Margareth responde; a Dra. Shérad atua junto.
    consulta('c2', '2026-09-15T13:00:00.000Z', { responsavelId: 'margareth', filiado: JOAO, local: 'SENATEPI' }),
    // 11:00 — já em andamento.
    consulta('c3', '2026-09-15T14:00:00.000Z', { status: EM_ANDAMENTO }),
    // 12:00 em ponto — fora da faixa [09:00, 12:00).
    consulta('c4', '2026-09-15T15:00:00.000Z'),
    // 23:30 de 15/09 em Teresina (02:30Z de 16/09) — mesmo dia, fora do horário.
    consulta('c10', '2026-09-16T02:30:00.000Z'),
    // ---- não entram ----
    // 23:30 de 14/09 em Teresina.
    consulta('x-dia-anterior', '2026-09-15T02:30:00.000Z'),
    // Só reserva do robô na consulta do Dr. Tiago.
    consulta('x-reserva', '2026-09-15T12:30:00.000Z', { responsavelId: 'tiago' }),
    consulta('x-audiencia', '2026-09-15T12:00:00.000Z', { tipo: 'AUDIENCIA', titulo: 'Audiência — Processo 0801234-56.2026.8.18.0140' }),
    consulta('x-seguimento', '2026-09-15T14:30:00.000Z', { origemDesfechoId: 'c-antiga' }),
    consulta('x-cancelada', '2026-09-15T12:00:00.000Z', { status: CANCELADO }),
    consulta('x-outro-dia', '2026-09-16T12:00:00.000Z'),
  ];
  const equipe: LinhaDaEquipe[] = [
    { compromissoId: 'c1', usuarioId: 'sherad', principal: true, origem: null },
    { compromissoId: 'c2', usuarioId: 'margareth', principal: true, origem: null },
    { compromissoId: 'c2', usuarioId: 'sherad', principal: false, origem: null },
    { compromissoId: 'c3', usuarioId: 'sherad', principal: true, origem: null },
    { compromissoId: 'c4', usuarioId: 'sherad', principal: true, origem: null },
    { compromissoId: 'c10', usuarioId: 'sherad', principal: true, origem: null },
    { compromissoId: 'x-dia-anterior', usuarioId: 'sherad', principal: true, origem: null },
    { compromissoId: 'x-reserva', usuarioId: 'tiago', principal: true, origem: null },
    { compromissoId: 'x-reserva', usuarioId: 'sherad', principal: false, origem: ORIGEM_RESERVA },
    { compromissoId: 'x-audiencia', usuarioId: 'sherad', principal: true, origem: null },
    { compromissoId: 'x-seguimento', usuarioId: 'sherad', principal: true, origem: null },
    { compromissoId: 'x-cancelada', usuarioId: 'sherad', principal: true, origem: null },
    { compromissoId: 'x-outro-dia', usuarioId: 'sherad', principal: true, origem: null },
  ];
  return { consultas, equipe };
}

type Escala = { id: string; advogadoId: string; data: Date; horaInicio: string; horaFim: string; observacao: string | null };

function montar(opcoes: { escalas?: Escala[]; agenda?: ReturnType<typeof agendaDoDia> } = {}) {
  let estado = {
    escalas: opcoes.escalas ?? [
      { id: 'e15', advogadoId: 'sherad', data: new Date('2026-09-15T00:00:00.000Z'), horaInicio: '09:00', horaFim: '12:00', observacao: null },
    ],
    ...(opcoes.agenda ?? agendaDoDia()),
  };
  const clonar = () => ({
    escalas: estado.escalas.map((e) => ({ ...e })),
    consultas: estado.consultas.map((c) => ({ ...c })),
    equipe: estado.equipe.map((l) => ({ ...l })),
  });

  const pessoa = (id: string) => PESSOAS.find((p) => p.id === id);
  const curta = (p?: Pessoa) => (p ? { id: p.id, nome: p.nome, nomeExibicao: p.nomeExibicao } : null);

  const casaOrigem = (l: LinhaDaEquipe, cond: any) => {
    const [campo] = Object.keys(cond);
    if (campo !== 'origem') throw new Error(`O banco falso não conhece o filtro de equipe "${campo}".`);
    if (cond.origem === null) return l.origem === null;
    // Igualdade simples: é como o helper da agenda tira a marca de reserva de quem entra.
    if (typeof cond.origem === 'string') return l.origem === cond.origem;
    // Prisma: `not` NÃO traz a linha nula.
    if (cond.origem.not !== undefined) return l.origem !== null && l.origem !== cond.origem.not;
    throw new Error('filtro de origem desconhecido');
  };
  const casaLinha = (l: LinhaDaEquipe, where: any): boolean =>
    Object.entries(where).every(([campo, cond]: [string, any]) => {
      if (campo === 'compromissoId' || campo === 'principal') return (l as any)[campo] === cond;
      if (campo === 'origem') return casaOrigem(l, { origem: cond });
      if (campo === 'usuarioId') {
        if (typeof cond === 'string') return l.usuarioId === cond;
        if (cond.notIn) return !cond.notIn.includes(l.usuarioId);
        if (cond.in) return cond.in.includes(l.usuarioId);
      }
      if (campo === 'OR') return cond.some((sub: any) => casaOrigem(l, sub));
      throw new Error(`O banco falso não conhece o filtro de equipe "${campo}".`);
    });

  const casaConsulta = (c: Consulta, where: any): boolean =>
    Object.entries(where).every(([campo, cond]: [string, any]) => {
      switch (campo) {
        case 'id': return typeof cond === 'string' ? c.id === cond : cond.in.includes(c.id);
        case 'tipo': return c.tipo === cond;
        case 'responsavelId': return c.responsavelId === cond;
        case 'origemDesfechoId':
          if (cond !== null) throw new Error('só `origemDesfechoId: null` é conhecido');
          return c.origemDesfechoId === null;
        case 'status': return cond.in.includes(c.status);
        case 'inicio': return c.inicio >= cond.gte && c.inicio < cond.lt;
        case 'equipe':
          return estado.equipe.some((l) => l.compromissoId === c.id && casaLinha(l, cond.some));
        case 'OR': return cond.some((sub: any) => casaConsulta(c, sub));
        default: throw new Error(`O banco falso não conhece o filtro de compromisso "${campo}".`);
      }
    });

  const comRelacoes = (c: Consulta) => ({
    ...c,
    responsavel: curta(pessoa(c.responsavelId)),
    equipe: estado.equipe
      .filter((l) => l.compromissoId === c.id)
      .map((l) => ({ usuarioId: l.usuarioId, principal: l.principal, origem: l.origem, usuario: curta(pessoa(l.usuarioId)) })),
  });

  const conferirIndice = () => {
    for (const c of estado.consultas) {
      if (estado.equipe.filter((l) => l.compromissoId === c.id && l.principal).length > 1) {
        throw new Error(`violação do índice compromisso_um_principal em ${c.id}`);
      }
    }
  };

  const db: any = {
    user: {
      findUnique: jest.fn(async ({ where }: any) => pessoa(where.id) ?? null),
      findMany: jest.fn(async ({ where }: any) => PESSOAS.filter((p) => where.id.in.includes(p.id))),
    },
    escalaAdvogado: {
      findUnique: jest.fn(async ({ where }: any) => {
        const e = estado.escalas.find((x) => x.id === where.id);
        return e ? { ...e, advogado: curta(pessoa(e.advogadoId)) } : null;
      }),
      findMany: jest.fn(async ({ where }: any) =>
        estado.escalas
          .filter((e) => e.advogadoId === where.advogadoId)
          .filter((e) => where.data.in.some((d: Date) => d.getTime() === e.data.getTime())),
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const e = estado.escalas.find((x) => x.id === where.id)!;
        Object.assign(e, data);
        return { ...e, advogado: curta(pessoa(e.advogadoId)) };
      }),
      delete: jest.fn(async ({ where }: any) => {
        estado.escalas = estado.escalas.filter((e) => e.id !== where.id);
      }),
    },
    compromisso: {
      findMany: jest.fn(async ({ where }: any) => estado.consultas.filter((c) => casaConsulta(c, where)).map(comRelacoes)),
      findUnique: jest.fn(async ({ where }: any) => {
        const c = estado.consultas.find((x) => x.id === where.id);
        return c ? { ...c } : null;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const c = estado.consultas.find((x) => x.id === where.id)!;
        Object.assign(c, data);
        return { ...c };
      }),
    },
    compromissoResponsavel: {
      findMany: jest.fn(async ({ where }: any) => estado.equipe.filter((l) => casaLinha(l, where)).map((l) => ({ ...l }))),
      findFirst: jest.fn(async ({ where }: any) => {
        const l = estado.equipe.find((x) => casaLinha(x, where));
        return l ? { ...l } : null;
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        const antes = estado.equipe.length;
        estado.equipe = estado.equipe.filter((l) => !casaLinha(l, where));
        return { count: antes - estado.equipe.length };
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const alvo = estado.equipe.filter((l) => casaLinha(l, where));
        alvo.forEach((l) => Object.assign(l, data));
        conferirIndice();
        return { count: alvo.length };
      }),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const { compromissoId, usuarioId } = where.compromissoId_usuarioId;
        const achada = estado.equipe.find((l) => l.compromissoId === compromissoId && l.usuarioId === usuarioId);
        if (achada) Object.assign(achada, update);
        else estado.equipe.push({ origem: null, ...create });
        conferirIndice();
        return {};
      }),
    },
  };
  // A transação desfaz tudo se lançar — é o que garante que uma recusa lá dentro não deixa meia troca.
  db.$transaction = jest.fn(async (fn: (tx: any) => unknown) => {
    const antes = clonar();
    try {
      return await fn(db);
    } catch (e) {
      estado = antes;
      throw e;
    }
  });

  const auditoria: any[] = [];
  const historico: any[] = [];
  const audit = { registrar: jest.fn(async (r: any) => { auditoria.push(r); }) };
  const agenda = {
    conflitos: jest.fn(async (p: { pessoas: string; inicio: string; fim: string; ignorarId: string }) =>
      p.pessoas === 'murilo' && p.inicio === '2026-09-15T12:00:00.000Z'
        ? [{
          id: 'aud-murilo', titulo: 'Audiência — Processo 0801234-56.2026.8.18.0140',
          inicio: new Date('2026-09-15T12:30:00.000Z'), fim: new Date('2026-09-15T13:30:00.000Z'),
        }]
        : [],
    ),
    registrarNoHistorico: jest.fn(async (id: string, r: any) => { historico.push({ id, ...r }); }),
  };
  const service = new EscalasService(db, audit as never, agenda as never);
  return {
    service, db, agenda, auditoria, historico,
    equipeDe: (id: string) =>
      estado.equipe
        .filter((l) => l.compromissoId === id)
        .sort((a, b) => Number(b.principal) - Number(a.principal) || a.usuarioId.localeCompare(b.usuarioId))
        .map((l) => `${l.usuarioId}${l.principal ? '*' : ''}${l.origem ? ` (${l.origem})` : ''}`),
    consulta: (id: string) => estado.consultas.find((c) => c.id === id)!,
    escala: (id: string) => estado.escalas.find((e) => e.id === id),
  };
}

const ANTES = new Date('2026-09-14T15:00:00.000Z'); // segunda, 14/09, 12h em Teresina
const ctx = { userId: 'coord', nome: 'Coordenação Teste', leitor: COORDENACAO, ip: '127.0.0.1', userAgent: 'jest' };

describe('GET /escalas/:id/consultas — a prévia', () => {
  it('no horário, fora do horário, papel, origem, link, celular e o choque de quem entra', async () => {
    const { service, agenda } = montar();
    const r = await service.consultasDoPlantao('e15', 'murilo', COORDENACAO, ANTES);

    expect(r).toMatchObject({
      escalaId: 'e15', dia: '2026-09-15', horaInicio: '09:00', horaFim: '12:00', passado: false,
      sai: { id: 'sherad', nome: 'Shérad Lima', nomeExibicao: 'Dra. Shérad' },
      entra: { id: 'murilo', nomeExibicao: 'Dr. Murilo', veAgenda: true },
      sobreposicao: null, podePassar: true, porQueNaoPassa: null, total: 3,
    });
    expect(r.noHorario.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    expect(r.foraDoHorario.map((c) => c.id)).toEqual(['c4', 'c10']);

    const [c1, c2, c3] = r.noHorario;
    expect(c1).toEqual({
      id: 'c1',
      titulo: 'Consulta jurídica c1',
      inicio: '2026-09-15T12:00:00.000Z',
      fim: '2026-09-15T13:00:00.000Z',
      status: 'PENDENTE',
      papel: 'RESPONSAVEL',
      jaEraResponsavel: false,
      selecionavel: true,
      porQueNao: null,
      local: 'Por chamada de vídeo',
      temLink: true,
      atendimento: { id: 'a412', numero: 412 },
      // O fixo do principal não é celular: vale o secundário.
      filiado: { id: 'f-maria', nomeCompleto: 'Maria da Silva', celularWhatsApp: '5586999998888' },
      choques: [{
        id: 'aud-murilo', titulo: 'Audiência — Processo 0801234-56.2026.8.18.0140',
        inicio: '2026-09-15T12:30:00.000Z', fim: '2026-09-15T13:30:00.000Z',
      }],
      responsavel: null,
    });
    expect(c2).toMatchObject({
      papel: 'PARTICIPANTE', jaEraResponsavel: false, selecionavel: true, choques: [],
      responsavel: { nome: 'Margareth Costa', nomeExibicao: 'Dra. Margareth' },
    });
    expect(c3).toMatchObject({
      status: 'EM_ANDAMENTO', selecionavel: false,
      porQueNao: 'Em consulta agora — continua com a Dra. Shérad.', choques: [],
    });

    // O choque é conferido para quem entra, ignorando a própria consulta — e não para a que não passa.
    expect(agenda.conflitos).toHaveBeenCalledWith({
      pessoas: 'murilo', inicio: '2026-09-15T12:00:00.000Z', fim: '2026-09-15T13:00:00.000Z', ignorarId: 'c1',
    });
    expect(agenda.conflitos.mock.calls.map((c) => c[0].ignorarId)).toEqual(['c1', 'c2', 'c4', 'c10']);
  });

  it('sem `entra` (excluir, encurtar): a mesma lista, sem choque e sem poder passar', async () => {
    const { service, agenda } = montar();
    const r = await service.consultasDoPlantao('e15', undefined, COORDENACAO, ANTES);
    expect(r).toMatchObject({ entra: null, podePassar: false, porQueNaoPassa: null, total: 3 });
    expect(r.noHorario.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    expect(agenda.conflitos).not.toHaveBeenCalled();
  });

  it('quem lê sem Agenda recebe só a contagem; sem Filiados, sem celular', async () => {
    const { service } = montar();
    const semAgenda = await service.consultasDoPlantao(
      'e15', 'murilo', { id: 'x', role: UserRole.ADVOGADO, permissoes: { agenda: 'SEM_ACESSO' } }, ANTES,
    );
    expect(semAgenda).toMatchObject({ total: 3, noHorario: [], foraDoHorario: [], podePassar: false });

    const semFiliados = await service.consultasDoPlantao(
      'e15', 'murilo', { id: 'x', role: UserRole.ADVOGADO, permissoes: { filiados: 'SEM_ACESSO' } }, ANTES,
    );
    expect(semFiliados.podePassar).toBe(true);
    expect(semFiliados.noHorario[0].filiado).toEqual({ id: 'f-maria', nomeCompleto: 'Maria da Silva', celularWhatsApp: null });
  });

  it('leitor que só vê a Agenda, e quem entra sem Agenda: a frase de por que não passa', async () => {
    const { service } = montar();
    const leitorQueSoVe = await service.consultasDoPlantao(
      'e15', 'murilo', { id: 'x', role: UserRole.COORDENACAO, permissoes: { agenda: 'VISUALIZAR' } }, ANTES,
    );
    expect(leitorQueSoVe).toMatchObject({
      podePassar: false,
      porQueNaoPassa: 'As consultas continuam com a Dra. Shérad. Passar consultas é de quem edita a Agenda.',
    });

    const entraSemAgenda = await service.consultasDoPlantao('e15', 'paulo', COORDENACAO, ANTES);
    expect(entraSemAgenda).toMatchObject({
      entra: { id: 'paulo', veAgenda: false },
      podePassar: false,
      porQueNaoPassa: 'O Dr. Paulo não tem acesso à Agenda e não veria as consultas. Elas continuam com a Dra. Shérad.',
    });
  });

  it('plantão que já passou: nada é selecionável', async () => {
    const { service } = montar();
    const r = await service.consultasDoPlantao('e15', 'murilo', COORDENACAO, new Date('2026-09-16T15:00:00.000Z'));
    expect(r).toMatchObject({ passado: true, podePassar: false, porQueNaoPassa: 'Este plantão já passou. As consultas não mudam de dono.' });
    expect([...r.noHorario, ...r.foraDoHorario].every((c) => !c.selecionavel && c.porQueNao === 'Este plantão já passou. As consultas não mudam de dono.')).toBe(true);
  });

  it('a recusa que o PATCH daria para quem entra vem antes, em `sobreposicao`', async () => {
    const { service } = montar({
      escalas: [
        { id: 'e15', advogadoId: 'sherad', data: new Date('2026-09-15T00:00:00.000Z'), horaInicio: '09:00', horaFim: '12:00', observacao: null },
        { id: 'm15', advogadoId: 'murilo', data: new Date('2026-09-15T00:00:00.000Z'), horaInicio: '10:00', horaFim: '12:00', observacao: null },
      ],
    });
    expect((await service.consultasDoPlantao('e15', 'murilo', COORDENACAO, ANTES)).sobreposicao)
      .toBe('Em 15/09 o Dr. Murilo já está de plantão 10:00–12:00.');
    expect((await service.consultasDoPlantao('e15', 'rosa', COORDENACAO, ANTES)).sobreposicao)
      .toBe('O cadastro de Rosa Antiga está inativo; não dá para escalar quem não usa mais o sistema.');
  });

  it('404, e quem assume não pode ser quem já está', async () => {
    const { service } = montar();
    await expect(service.consultasDoPlantao('nada', 'murilo', COORDENACAO, ANTES)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.consultasDoPlantao('e15', 'sherad', COORDENACAO, ANTES))
      .rejects.toThrow(new BadRequestException('Quem assume já é a pessoa deste plantão.'));
  });
});

describe('PATCH /escalas/:id com passarConsultas — a troca', () => {
  it('passa as escolhidas no mesmo papel, carimba as mantidas e escreve histórico e auditoria com os dois nomes', async () => {
    const { service, auditoria, historico, equipeDe, consulta, escala } = montar();
    const r: any = await service.atualizar('e15', { advogadoId: 'murilo', passarConsultas: ['c1', 'c2'] }, ctx, ANTES);

    expect(escala('e15')?.advogadoId).toBe('murilo');
    // c1: quem entra passa a responder, e o atalho acompanha.
    expect(equipeDe('c1')).toEqual(['murilo*']);
    expect(consulta('c1').responsavelId).toBe('murilo');
    // c2: a Dra. Margareth continua respondendo; o Dr. Murilo atua junto.
    expect(equipeDe('c2')).toEqual(['margareth*', 'murilo']);
    expect(consulta('c2').responsavelId).toBe('margareth');
    // Não escolhidas: não mudam.
    expect(equipeDe('c4')).toEqual(['sherad*']);
    expect(equipeDe('c3')).toEqual(['sherad*']);

    expect(r.consultas).toEqual({
      passadas: [
        {
          id: 'c1', inicio: '2026-09-15T12:00:00.000Z', papel: 'RESPONSAVEL', jaEraResponsavel: false,
          filiado: { id: 'f-maria', nomeCompleto: 'Maria da Silva', celularWhatsApp: '5586999998888' },
        },
        // A Dra. Margareth continua atendendo o João: a tela não pode dizer que agora é o Dr. Murilo.
        {
          id: 'c2', inicio: '2026-09-15T13:00:00.000Z', papel: 'PARTICIPANTE', jaEraResponsavel: false,
          filiado: { id: 'f-joao', nomeCompleto: 'João Pereira', celularWhatsApp: '5586988887777' },
        },
      ],
      mantidas: ['c4', 'c10'],
      ignoradas: [],
    });
    expect(r.advogado).toMatchObject({ id: 'murilo' });

    expect(historico).toEqual([
      {
        id: 'c1',
        acao: 'EDITADO',
        descricao: 'Passou da Dra. Shérad para o Dr. Murilo, que assumiu o plantão de 15/09.',
        metadata: {
          motivo: 'TROCA_DE_PLANTAO', escalaId: 'e15', de: 'sherad', para: 'murilo',
          deNome: 'Dra. Shérad', paraNome: 'Dr. Murilo', papel: 'RESPONSAVEL', jaEraResponsavel: false,
        },
        autorId: 'coord',
        autorNome: 'Coordenação Teste',
      },
      expect.objectContaining({
        id: 'c2',
        descricao: 'Quem atua junto passou da Dra. Shérad para o Dr. Murilo, que assumiu o plantão de 15/09.',
        metadata: expect.objectContaining({ papel: 'PARTICIPANTE' }),
      }),
    ]);

    expect(auditoria.map((a) => [a.entidade, a.entidadeId, a.descricao])).toEqual([
      ['Compromisso', 'c1', 'Consulta de Maria da Silva passou da Dra. Shérad para o Dr. Murilo (troca do plantão de 15/09)'],
      ['Compromisso', 'c2', 'Consulta de João Pereira passou da Dra. Shérad para o Dr. Murilo (troca do plantão de 15/09)'],
      ['EscalaAdvogado', 'e15', 'O Dr. Murilo assumiu o plantão de 15/09 no lugar de Shérad Lima, com 2 consultas'],
    ]);
    expect(auditoria[2].metadata).toMatchObject({
      troca: true,
      advogadoAnteriorId: 'sherad',
      advogadoId: 'murilo',
      consultasPassadas: ['c1', 'c2'],
      consultasMantidas: ['c4', 'c10'],
      consultasIgnoradas: [],
    });
  });

  it('quem entra já era o responsável: a prévia marca a linha, e o histórico diz que quem saiu deixou a equipe', async () => {
    // Revisão da rodada 3 (14/09/2026): na c2, o Dr. Murilo responde e a Dra.
    // Shérad atua junto. Passar a c2 não dá nada a ele — só tira a Dra. Shérad.
    const agenda = agendaDoDia();
    agenda.consultas.find((c) => c.id === 'c2')!.responsavelId = 'murilo';
    agenda.equipe.find((l) => l.compromissoId === 'c2' && l.principal)!.usuarioId = 'murilo';
    const { service, auditoria, historico, equipeDe, consulta } = montar({ agenda });

    const previa = await service.consultasDoPlantao('e15', 'murilo', COORDENACAO, ANTES);
    expect(previa.noHorario.map((c) => [c.id, c.papel, c.jaEraResponsavel])).toEqual([
      ['c1', 'RESPONSAVEL', false],
      ['c2', 'PARTICIPANTE', true],
      ['c3', 'RESPONSAVEL', false],
    ]);
    // Com outra pessoa entrando, a mesma c2 é passagem de verdade.
    const comTiago = await service.consultasDoPlantao('e15', 'tiago', COORDENACAO, ANTES);
    expect(comTiago.noHorario.find((c) => c.id === 'c2')?.jaEraResponsavel).toBe(false);
    // Sem quem entra (excluir, encurtar), não há o que marcar.
    const semEntra = await service.consultasDoPlantao('e15', undefined, COORDENACAO, ANTES);
    expect(semEntra.noHorario.some((c) => c.jaEraResponsavel)).toBe(false);

    const r: any = await service.atualizar('e15', { advogadoId: 'murilo', passarConsultas: ['c1', 'c2'] }, ctx, ANTES);

    expect(equipeDe('c2')).toEqual(['murilo*']);
    expect(consulta('c2').responsavelId).toBe('murilo');
    expect(r.consultas.passadas.map((p: any) => [p.id, p.papel, p.jaEraResponsavel])).toEqual([
      ['c1', 'RESPONSAVEL', false],
      ['c2', 'PARTICIPANTE', true],
    ]);
    expect(historico.map((h) => [h.id, h.descricao])).toEqual([
      ['c1', 'Passou da Dra. Shérad para o Dr. Murilo, que assumiu o plantão de 15/09.'],
      ['c2', 'A Dra. Shérad deixou a equipe; o Dr. Murilo já era o responsável (troca do plantão de 15/09).'],
    ]);
    expect(historico[1].metadata).toMatchObject({ papel: 'PARTICIPANTE', jaEraResponsavel: true });
    expect(auditoria[1].descricao).toBe(
      'Consulta de João Pereira: a Dra. Shérad deixou a equipe; o Dr. Murilo já era o responsável (troca do plantão de 15/09)',
    );
  });

  it('a prévia e a gravação leem a mesma regra: pedir todas as selecionáveis passa todas, sem ignorada', async () => {
    const { service } = montar();
    const previa = await service.consultasDoPlantao('e15', 'murilo', COORDENACAO, ANTES);
    const selecionaveis = [...previa.noHorario, ...previa.foraDoHorario].filter((c) => c.selecionavel).map((c) => c.id);
    const r: any = await service.atualizar('e15', { advogadoId: 'murilo', passarConsultas: selecionaveis }, ctx, ANTES);
    expect(r.consultas.passadas.map((p: any) => p.id)).toEqual(selecionaveis);
    expect(r.consultas.ignoradas).toEqual([]);
    expect(r.consultas.mantidas).toEqual([]);
  });

  it('o que mudou entre a prévia e o salvar vira `ignoradas`, com o motivo, e não derruba a troca', async () => {
    const { service, consulta, equipeDe, escala } = montar();
    // Entre a prévia e o salvar: alguém concluiu a c4 e cancelou a c10.
    consulta('c4').status = CONCLUIDO;
    consulta('c10').status = CANCELADO;
    const r: any = await service.atualizar(
      'e15',
      { advogadoId: 'murilo', passarConsultas: ['c3', 'c4', 'c10', '9b1c7e2a-0000-4000-8000-000000000000', 'c1'] },
      ctx,
      ANTES,
    );
    expect(r.consultas.ignoradas).toEqual([
      { id: 'c3', motivo: 'Já estava em andamento.' },
      { id: 'c4', motivo: 'Já tinha sido concluída.' },
      { id: 'c10', motivo: 'Já tinha sido cancelada.' },
      { id: '9b1c7e2a-0000-4000-8000-000000000000', motivo: 'Não existe mais na agenda.' },
    ]);
    expect(r.consultas.passadas.map((p: any) => p.id)).toEqual(['c1']);
    expect(r.consultas.mantidas).toEqual(['c2']);
    expect(escala('e15')?.advogadoId).toBe('murilo');
    expect(equipeDe('c1')).toEqual(['murilo*']);
  });

  it('consulta remarcada para outro dia entre a prévia e o salvar: não estava mais com ela', async () => {
    const { service, consulta, equipeDe } = montar();
    consulta('c1').inicio = new Date('2026-09-17T12:00:00.000Z');
    const r: any = await service.atualizar('e15', { advogadoId: 'murilo', passarConsultas: ['c1'] }, ctx, ANTES);
    expect(r.consultas.ignoradas).toEqual([{ id: 'c1', motivo: 'Não estava mais marcada com a Dra. Shérad neste dia.' }]);
    expect(equipeDe('c1')).toEqual(['sherad*']);
  });

  it('`[]` é a decisão de manter todas: nada muda na agenda, e fica carimbado', async () => {
    const { service, auditoria, historico, equipeDe } = montar();
    const r: any = await service.atualizar('e15', { advogadoId: 'murilo', passarConsultas: [] }, ctx, ANTES);
    expect(r.consultas).toEqual({ passadas: [], mantidas: ['c1', 'c2', 'c4', 'c10'], ignoradas: [] });
    expect(equipeDe('c1')).toEqual(['sherad*']);
    expect(historico).toEqual([]);
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0].descricao).toBe('O Dr. Murilo assumiu o plantão de 15/09 no lugar de Shérad Lima');
    expect(auditoria[0].metadata.consultasMantidas).toEqual(['c1', 'c2', 'c4', 'c10']);
  });

  it('sem o campo (a tela antiga): as consultas não mudam, a resposta é a de sempre e o log anota quais ficaram', async () => {
    const { service, auditoria, equipeDe, db } = montar();
    const r: any = await service.atualizar('e15', { advogadoId: 'murilo' }, ctx, ANTES);
    expect(r.consultas).toBeUndefined();
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(equipeDe('c1')).toEqual(['sherad*']);
    expect(auditoria[0].metadata.consultasSemDecisao).toEqual(['c1', 'c2', 'c3', 'c4', 'c10']);
    expect(auditoria[0].metadata.consultasPassadas).toBeUndefined();
  });

  it('plantão que já passou: a troca registra quem esteve, e as consultas não mudam de dono', async () => {
    const { service, equipeDe, escala } = montar();
    const r: any = await service.atualizar(
      'e15', { advogadoId: 'murilo', passarConsultas: ['c1'] }, ctx, new Date('2026-09-16T15:00:00.000Z'),
    );
    expect(r.consultas).toEqual({ passadas: [], mantidas: [], ignoradas: [{ id: 'c1', motivo: 'Este plantão já passou.' }] });
    expect(escala('e15')?.advogadoId).toBe('murilo');
    expect(equipeDe('c1')).toEqual(['sherad*']);
  });

  it('recusas antes de gravar: sem troca, sem Agenda EDITAR (403), quem entra sem Agenda', async () => {
    const { service, db, escala, equipeDe } = montar();

    await expect(service.atualizar('e15', { horaFim: '11:00', passarConsultas: [] }, ctx, ANTES))
      .rejects.toThrow(new BadRequestException('Consultas só mudam de dono quando o plantão muda de pessoa.'));

    const soVeAgenda = { ...ctx, leitor: { id: 'x', role: UserRole.COORDENACAO, permissoes: { agenda: 'VISUALIZAR' } } };
    await expect(service.atualizar('e15', { advogadoId: 'murilo', passarConsultas: ['c1'] }, soVeAgenda, ANTES))
      .rejects.toThrow(new ForbiddenException('Passar consultas é de quem edita a Agenda.'));
    // Sem ids, quem só vê a Agenda ainda pode registrar a decisão de manter.
    await expect(service.atualizar('e15', { advogadoId: 'murilo', passarConsultas: [] }, soVeAgenda, ANTES)).resolves.toBeTruthy();

    const outro = montar();
    await expect(outro.service.atualizar('e15', { advogadoId: 'paulo', passarConsultas: ['c1'] }, ctx, ANTES))
      .rejects.toThrow(new BadRequestException('O Dr. Paulo não tem acesso à Agenda e não veria as consultas.'));
    expect(outro.escala('e15')?.advogadoId).toBe('sherad');
    expect(outro.db.escalaAdvogado.update).not.toHaveBeenCalled();

    expect(db.$transaction).toHaveBeenCalledTimes(1); // só a do `[]` que passou
    expect(escala('e15')?.advogadoId).toBe('murilo');
    expect(equipeDe('c1')).toEqual(['sherad*']);
  });

  it('se a escrita da equipe falhar lá dentro, a escala volta a ser de quem era', async () => {
    const { service, db, escala, equipeDe } = montar();
    db.compromissoResponsavel.upsert.mockImplementationOnce(async () => { throw new Error('queda do banco'); });
    await expect(service.atualizar('e15', { advogadoId: 'murilo', passarConsultas: ['c1'] }, ctx, ANTES))
      .rejects.toThrow('queda do banco');
    expect(escala('e15')?.advogadoId).toBe('sherad');
    expect(equipeDe('c1')).toEqual(['sherad*']);
  });
});

describe('os irmãos (D17): excluir e encurtar não mexem nas consultas, mas o log diz quais', () => {
  it('excluir carimba as consultas no horário que ficaram na agenda de quem estava', async () => {
    const { service, auditoria, equipeDe, escala } = montar();
    await service.remover('e15', ctx, ANTES);
    expect(escala('e15')).toBeUndefined();
    expect(auditoria[0]).toMatchObject({ acao: 'DELETE', entidadeId: 'e15' });
    expect(auditoria[0].metadata.consultasQueFicaram).toEqual(['c1', 'c2', 'c3']);
    expect(equipeDe('c1')).toEqual(['sherad*']);
  });

  it('encurtar para 09:00–11:00 carimba a consulta das 11:00 (faixa [início, fim))', async () => {
    const { service, auditoria } = montar();
    await service.atualizar('e15', { horaFim: '11:00' }, ctx, ANTES);
    expect(auditoria[0].metadata.consultasForaDoNovoHorario).toEqual(['c3']);
    expect(auditoria[0].metadata.consultasSemDecisao).toBeUndefined();
  });

  /*
    O AVISO DE ENCURTAR ANTES DE SALVAR (15/09/2026). A tela montava o aviso com
    `noHorario`, que chega vazia para quem não vê a Agenda: com total 3, quem
    encurtava sem Agenda não era avisado de nada. A prévia agora conta pela mesma
    regra do PATCH.
  */
  it('a prévia com o horário novo conta as mesmas consultas que o PATCH carimba, até para quem não vê a Agenda', async () => {
    const { service, auditoria } = montar();
    const previa = await service.consultasDoPlantao('e15', undefined, COORDENACAO, ANTES, { horaFim: '10:00' });
    expect(previa).toMatchObject({ total: 3, foraDoNovoHorario: 2, idsForaDoNovoHorario: ['c2', 'c3'] });

    const semAgenda = await service.consultasDoPlantao(
      'e15', undefined, { id: 'x', role: UserRole.ADVOGADO, permissoes: { agenda: 'SEM_ACESSO' } }, ANTES,
      { horaInicio: '09:00', horaFim: '10:00' },
    );
    expect(semAgenda).toMatchObject({ total: 3, foraDoNovoHorario: 2, idsForaDoNovoHorario: [], noHorario: [] });

    await service.atualizar('e15', { horaFim: '10:00' }, ctx, ANTES);
    expect(auditoria[0].metadata.consultasForaDoNovoHorario).toEqual(previa.idsForaDoNovoHorario);
  });

  it('sem horário novo, ou com o fim antes do início enquanto a pessoa digita: nulo, sem 400', async () => {
    const { service } = montar();
    expect((await service.consultasDoPlantao('e15', undefined, COORDENACAO, ANTES)).foraDoNovoHorario).toBeNull();
    const digitando = await service.consultasDoPlantao('e15', undefined, COORDENACAO, ANTES, { horaFim: '08:00' });
    expect(digitando).toMatchObject({ foraDoNovoHorario: null, idsForaDoNovoHorario: [] });
    // Começar mais tarde também tira quem vinha antes: 10:00–12:00 deixa a das 09:00 de fora.
    const maisTarde = await service.consultasDoPlantao('e15', undefined, COORDENACAO, ANTES, { horaInicio: '10:00' });
    expect(maisTarde).toMatchObject({ foraDoNovoHorario: 1, idsForaDoNovoHorario: ['c1'] });
  });
});
