import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../../common/permissions/permissions.guard';
import { PRESETS_PERFIL } from '../../common/permissions/permissoes.constants';
import { AudienciasController } from './audiencias.controller';
import { AudienciasDoDiarioService } from './audiencias-do-diario.service';

/**
 * A AUDIÊNCIA SAI DO DIÁRIO — o fim de uma máquina que nunca produziu nada.
 *
 * O sistema tinha classificador, radar, criador de pauta, aviso ao filiado e
 * tarefa de preparo. Medido na produção em 15/10/2026, antes desta mudança:
 *
 *   movimentações do DataJud marcadas como audiência ...... 265
 *   dessas, com DATA em qualquer campo ...................... 0
 *   audiências criadas pelo robô ............................ 0
 *   audiências na agenda (todas à mão) ...................... 3
 *
 * A máquina estava FAMINTA, não quebrada: o DataJud manda o rótulo e nunca o
 * dia. Quem manda o dia é o Diário — 101 publicações do acervo designam
 * audiência, 76 distintas.
 *
 * Este arquivo prova o comportamento do serviço que faz a ponte, e as duas
 * travas de permissão da rota que o dispara à mão.
 */

const PUB = new Date('2026-09-30T00:00:00.000Z');
const FUTURO = 'AUDIÊNCIA UNA VIRTUAL: 25/11/2026 11:45 https://trt22-jus-br.zoom.us/j/4341731264';
const PASSADO = 'AUDIÊNCIA UNA VIRTUAL: 02/10/2026 11:45';

type Linha = {
  id: string;
  texto: string;
  dataDisponibilizacao: Date;
  nomeOrgao: string | null;
  numeroProcesso: string;
  processoId: string | null;
  compromissoId: string | null;
  audienciaAvaliadaEm: Date | null;
  processo: unknown;
};

const processo = {
  id: 'p1',
  numeroCNJ: '00014110320265220108',
  advogadoId: 'adv-derivado',
  filiadoId: null,
  filiado: null,
  partes: [
    { nome: 'SINDICATO DOS ENFERMEIROS DO PIAUÍ', polo: 'ATIVO', parteExterna: { institucional: true } },
    { nome: 'PRORRENAL LTDA', polo: 'PASSIVO' },
  ],
};

function montar(linhas: Partial<Linha>[], opcoes: { principal?: string | null } = {}) {
  const banco: Linha[] = linhas.map((l, i) => ({
    id: l.id ?? `c${i}`,
    texto: l.texto ?? FUTURO,
    dataDisponibilizacao: l.dataDisponibilizacao ?? PUB,
    nomeOrgao: l.nomeOrgao ?? 'Vara do Trabalho de Bom Jesus',
    numeroProcesso: l.numeroProcesso ?? '00014110320265220108',
    processoId: l.processoId === undefined ? 'p1' : l.processoId,
    compromissoId: l.compromissoId ?? null,
    audienciaAvaliadaEm: l.audienciaAvaliadaEm ?? null,
    processo: l.processoId === null ? null : processo,
  }));
  const updates: { id: string; data: Record<string, unknown> }[] = [];
  const prisma = {
    comunicacaoDjen: {
      findMany: jest.fn(async (args: { where: Record<string, unknown>; take?: number }) => {
        const soNovas = 'audienciaAvaliadaEm' in args.where;
        return banco
          .filter((l) => (soNovas ? !l.audienciaAvaliadaEm : true))
          .filter((l) => l.processoId !== null)
          .slice(0, args.take ?? 999);
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        updates.push({ id: where.id, data });
        return {};
      }),
    },
    processoAdvogado: {
      findFirst: jest.fn(async () =>
        opcoes.principal === undefined ? { advogadoId: 'adv-principal' } : opcoes.principal ? { advogadoId: opcoes.principal } : null,
      ),
    },
  };
  const agendar = jest.fn(
    async (_entrada: Record<string, unknown>): Promise<{
      compromissoId: string | null; criou: boolean; avisoAoFiliado: boolean;
    }> => ({ compromissoId: 'k1', criou: true, avisoAoFiliado: false }),
  );
  const derrubar = jest.fn(async (_id: string, _o: Record<string, unknown>) => 1);
  const automacao = {
    agendarPauta: agendar,
    derrubarPautasAbertas: derrubar,
    secretariaParaAviso: jest.fn(async () => 'sec1'),
    responsavelParaPauta: jest.fn(async (id: string | null) => id ?? 'admin'),
  };
  const svc = new AudienciasDoDiarioService(prisma as never, automacao as never);
  return { svc, prisma, automacao, agendar, derrubar, updates };
}

describe('o leitor de pauta do Diário', () => {
  it('agenda a audiência futura e carimba a leitura na publicação', async () => {
    const { svc, agendar, updates } = montar([{ texto: FUTURO }]);
    const r = await svc.varrer();

    expect(r.agendadas).toBe(1);
    expect(agendar).toHaveBeenCalledTimes(1);
    const entrada = agendar.mock.calls[0][0];
    expect(entrada).toMatchObject({
      tipo: 'AUDIENCIA',
      qualificador: 'una',
      horaPresumida: false,
      link: 'https://trt22-jus-br.zoom.us/j/4341731264',
      secretariaId: 'sec1',
    });
    expect((entrada.inicio as Date).toISOString()).toBe('2026-11-25T14:45:00.000Z');
    // Virtual: o local diz o juízo E que é por vídeo, porque o endereço da
    // vara mandaria alguém para o prédio errado.
    expect(entrada.local).toBe('Vara do Trabalho de Bom Jesus · audiência virtual');
    expect(updates[0].data).toMatchObject({
      compromissoId: 'k1',
      providencia: 'PREPARAR_AUDIENCIA',
      audienciaEm: new Date('2026-11-25T14:45:00.000Z'),
    });
  });

  /**
   * O CARIMBO DO ROBÔ MORA EM COLUNA DO ROBÔ.
   *
   * `tarefaDispensadaEm` é a dispensa de uma PESSOA e CALA o aviso na tela; o
   * carimbo do robô é o que torna o aviso possível. Escrever na coluna de
   * gente já apagou trabalho nosso antes — este teste é a lápide disso.
   */
  it('nunca escreve na dispensa humana', async () => {
    const { svc, updates } = montar([{ texto: FUTURO }, { texto: 'INTIME-SE A PARTE.' }]);
    await svc.varrer();
    expect(updates.length).toBe(2);
    for (const u of updates) {
      expect(u.data).not.toHaveProperty('tarefaDispensadaEm');
      expect(u.data).not.toHaveProperty('tarefaDispensadaMotivo');
      expect(u.data.audienciaAvaliadaEm).toBeInstanceOf(Date);
    }
  });

  /**
   * PAUTA NO PASSADO NÃO VIRA AGENDA — 96 das 101 do acervo já aconteceram.
   * Mas a leitura FICA GRAVADA: é o que deixa conferir o robô sem reprocessar.
   */
  it('audiência que já aconteceu é carimbada, não agendada', async () => {
    const { svc, agendar, updates } = montar([{ texto: PASSADO }]);
    const r = await svc.varrer();
    expect(r.agendadas).toBe(0);
    expect(r.noPassado).toBe(1);
    expect(agendar).not.toHaveBeenCalled();
    expect(updates[0].data).toMatchObject({ audienciaAvaliadaMotivo: 'JA_ACONTECEU' });
    expect(updates[0].data.audienciaEm).toBeInstanceOf(Date);
  });

  it('o motivo da recusa vai para a publicação e para o resumo', async () => {
    const { svc, updates } = montar([{ texto: 'CIÊNCIA DA ATA DE AUDIÊNCIA JUNTADA AOS AUTOS.' }]);
    const r = await svc.varrer();
    expect(r.semPauta).toBe(1);
    expect(r.porMotivo).toEqual({ SEM_DESIGNACAO: 1 });
    expect(updates[0].data).toMatchObject({ audienciaAvaliadaMotivo: 'SEM_DESIGNACAO' });
  });

  /**
   * O DONO DO CASO É O `principal` DE `processos_advogados` — bate 131/131 na
   * produção. `processo.advogadoId` é atalho DERIVADO e pode ter sido
   * recalculado; ele é a segunda opção, nunca a primeira.
   */
  it('a pauta vai para o principal da equipe, não para o atalho derivado', async () => {
    const { svc, agendar } = montar([{ texto: FUTURO }]);
    await svc.varrer();
    expect(agendar.mock.calls[0][0].responsavelId).toBe('adv-principal');
  });

  it('sem principal, cai no advogado do processo', async () => {
    const { svc, agendar } = montar([{ texto: FUTURO }], { principal: null });
    await svc.varrer();
    expect(agendar.mock.calls[0][0].responsavelId).toBe('adv-derivado');
  });

  /**
   * NÃO ATROPELA O VÍNCULO ALHEIO. Quando a publicação já aponta para uma
   * atividade criada por outro caminho, sobrescrever apagaria em silêncio a
   * ligação entre o ato e aquele trabalho.
   */
  it('não sobrescreve o compromisso que a publicação já tinha', async () => {
    const { svc, updates } = montar([{ texto: FUTURO, compromissoId: 'outro' }]);
    await svc.varrer();
    expect(updates[0].data).not.toHaveProperty('compromissoId');
    expect(updates[0].data).toMatchObject({ providencia: 'PREPARAR_AUDIENCIA' });
  });

  /** Sem processo cadastrado não há a que pendurar a pauta. */
  it('publicação sem processo não entra na fila', async () => {
    const { svc, agendar } = montar([{ texto: FUTURO, processoId: null }]);
    const r = await svc.varrer();
    expect(r.examinadas).toBe(0);
    expect(agendar).not.toHaveBeenCalled();
  });

  /**
   * A FILA É O CARIMBO PRÓPRIO, não `compromissoId`. Uma publicação pode já
   * ter gerado tarefa por outro caminho e ainda designar uma audiência fora
   * da agenda — eram 5 assim na produção.
   */
  it('reexaminar=true volta no que já foi carimbado', async () => {
    const { svc, prisma } = montar([{ texto: FUTURO, audienciaAvaliadaEm: new Date() }]);
    expect((await svc.varrer()).examinadas).toBe(0);
    const r = await svc.varrer({ reexaminar: true });
    expect(r.examinadas).toBe(1);
    const ultimaChamada = prisma.comunicacaoDjen.findMany.mock.calls.at(-1)![0] as { where: Record<string, unknown> };
    expect(ultimaChamada.where).not.toHaveProperty('audienciaAvaliadaEm');
  });

  /** Reprocessar o histórico inteiro não pode virar rodada sem fim. */
  it('a rodada tem teto', async () => {
    const muitas = Array.from({ length: 500 }, (_, i) => ({ id: `c${i}`, texto: FUTURO }));
    const { svc, prisma } = montar(muitas);
    await svc.varrer();
    expect((prisma.comunicacaoDjen.findMany.mock.calls[0][0] as { take: number }).take).toBe(300);
  });
});

/**
 * AS PERMISSÕES DA ROTA QUE RELÊ O DIÁRIO.
 *
 * Duas travas, e as duas importam: a rota LÊ processo e GRAVA NA AGENDA. O
 * `@Modulo` do controller cobre um módulo só, então a segunda é explícita —
 * a mesma dupla do botão "agendar" ao lado.
 */
/**
 * AGENDAR SEM SABER DESMARCAR É PIOR DO QUE NÃO AGENDAR.
 *
 * O advogado passa a confiar na agenda; uma pauta que não vai acontecer e
 * continua lá é uma promessa falsa. O lado DataJud já derrubava a pauta — mas
 * ele chega 62 dias depois, na mediana. O Diário chega em D+0.
 */
describe('a pauta que não vai acontecer', () => {
  const CANCELADA = 'FICA CANCELADA A AUDIÊNCIA designada para o dia 25/11/2026 às 11:45.';
  const REMARCADA =
    'A AUDIÊNCIA DO PRESENTE FEITO, ANTERIORMENTE DESIGNADA PARA 03/12/2026, ' +
    'FOI REDESIGNADA PARA O DIA E HORÁRIO A SEGUIR: 28/11/2026 08:30.';

  it('cancelamento derruba as pautas abertas do processo', async () => {
    const { svc, derrubar, agendar, updates } = montar([{ texto: CANCELADA }]);
    const r = await svc.varrer();
    expect(agendar).not.toHaveBeenCalled();
    expect(r.derrubadas).toBe(1);
    expect(derrubar).toHaveBeenCalledWith('p1', expect.objectContaining({
      desde: PUB,
      motivo: expect.stringContaining('cancelada pelo juízo'),
    }));
    expect(updates[0].data).toMatchObject({ audienciaAvaliadaMotivo: 'CANCELAMENTO' });
  });

  /**
   * A REMARCAÇÃO CRIA A NOVA E DERRUBA A VELHA — e `exceto` protege o dia da
   * nova, senão a rodada seguinte cancelaria a pauta que ela mesma criou.
   */
  it('remarcação agenda a data nova e derruba a anterior, poupando o dia novo', async () => {
    const { svc, derrubar, agendar } = montar([{ texto: REMARCADA }]);
    const r = await svc.varrer();
    expect(r.agendadas).toBe(1);
    expect(agendar.mock.calls[0][0].inicio).toEqual(new Date('2026-11-28T11:30:00.000Z'));
    expect(derrubar).toHaveBeenCalledWith('p1', expect.objectContaining({
      exceto: new Date('2026-11-28T11:30:00.000Z'),
      motivo: expect.stringContaining('remarcada pelo juízo'),
    }));
    // Derruba ANTES de criar: inverter deixaria a nova sem a proteção do dia.
    expect(derrubar.mock.invocationCallOrder[0]).toBeLessThan(agendar.mock.invocationCallOrder[0]);
  });

  /**
   * RELER NÃO RESSUSCITA — o bug que só apareceu rodando contra o Postgres.
   *
   * `pautaDoDia` só olha pauta PENDENTE, para não duplicar. A CANCELADA não
   * bloqueia nada, então reprocessar o histórico recriou as duas audiências
   * que o juízo tinha acabado de derrubar, lado a lado com o cancelamento que
   * as derrubou. A lápide é o `atoPublicadoEm`, e quem decide é o criador.
   */
  it('passa a data do ato para o criador — é ela que impede a ressurreição', async () => {
    const { svc, agendar } = montar([{ texto: FUTURO }]);
    await svc.varrer();
    expect(agendar.mock.calls[0][0].atoPublicadoEm).toEqual(PUB);
  });

  it('pauta já derrubada depois do ato não volta, e é contada à parte', async () => {
    const { svc, updates, agendar } = montar([{ texto: FUTURO }]);
    // O criador devolve "não criei e não há compromisso": é a lápide segurando.
    agendar.mockResolvedValueOnce({ compromissoId: null, criou: false, avisoAoFiliado: false });
    const r = await svc.varrer();
    expect(r.naoRessuscitadas).toBe(1);
    expect(r.agendadas).toBe(0);
    expect(r.jaExistiam).toBe(0);
    expect(updates[0].data).toMatchObject({ audienciaAvaliadaMotivo: 'PAUTA_JA_DERRUBADA' });
  });

  /** Designação comum não mexe em nada que já esteja marcado. */
  it('designação simples não derruba pauta nenhuma', async () => {
    const { svc, derrubar } = montar([{ texto: FUTURO }]);
    await svc.varrer();
    expect(derrubar).not.toHaveBeenCalled();
  });
});

describe('quem pode mandar reler o Diário', () => {
  const guard = new PermissionsGuard(new Reflector());
  const P = AudienciasController.prototype;
  const contexto = (metodo: string, handler: unknown, role: string, permissoes: Record<string, string> = {}) =>
    ({
      getHandler: () => handler,
      getClass: () => AudienciasController,
      switchToHttp: () => ({ getRequest: () => ({ method: metodo, user: { id: 'u1', role, permissoes } }) }),
    }) as never;

  const chamar = (role: string, permissoes: Record<string, string>) => {
    const doDiario = { varrer: jest.fn(async () => ({ agendadas: 0 })) };
    const ctrl = new AudienciasController({} as never, doDiario as never);
    return {
      doDiario,
      executar: () =>
        ctrl.lerPautasDoDiario({}, { id: 'u1', role, permissoes } as never),
    };
  };

  it('a matriz exige EDITAR em processos — VISUALIZAR não passa do guard', () => {
    expect(() =>
      guard.canActivate(contexto('POST', P.lerPautasDoDiario, 'ADVOGADO', { processos: 'VISUALIZAR' })),
    ).toThrow(ForbiddenException);
    expect(
      guard.canActivate(contexto('POST', P.lerPautasDoDiario, 'ADVOGADO', { processos: 'EDITAR' })),
    ).toBe(true);
  });

  it('passar no guard não basta: sem EDITAR na agenda a rota recusa', () => {
    const { executar, doDiario } = chamar('ADVOGADO', { processos: 'EDITAR', agenda: 'VISUALIZAR' });
    expect(executar).toThrow(ForbiddenException);
    expect(doDiario.varrer).not.toHaveBeenCalled();
  });

  it('com as duas, roda', async () => {
    const { executar, doDiario } = chamar('ADVOGADO', { processos: 'EDITAR', agenda: 'EDITAR' });
    await executar();
    expect(doDiario.varrer).toHaveBeenCalledWith({ reexaminar: false, limite: undefined });
  });

  /**
   * NÃO É OPERAÇÃO DE SISTEMA. Ler o Diário e agendar audiência é trabalho de
   * quem cuida do processo. Os presets de ADVOGADO e COORDENAÇÃO já dão as
   * duas chaves; a TRIAGEM, não — e é a matriz que decide, não um decorador.
   */
  it('os perfis que já podem, pelo preset de fábrica', () => {
    const pode = (role: 'ADVOGADO' | 'COORDENACAO' | 'TRIAGEM' | 'ADMINISTRADOR') =>
      PRESETS_PERFIL[role].processos === 'EDITAR' && PRESETS_PERFIL[role].agenda === 'EDITAR';
    expect(pode('ADVOGADO')).toBe(true);
    expect(pode('COORDENACAO')).toBe(true);
    expect(pode('ADMINISTRADOR')).toBe(true);
  });
});
