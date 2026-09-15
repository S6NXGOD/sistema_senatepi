import { StatusCompromisso } from '@prisma/client';
import { AgendaService } from './agenda.service';
import {
  JANELA_DO_DESFAZER_MS,
  andamentoDaConclusao,
  podeDesfazerConclusao,
  type RegistroDaConclusao,
} from './desfazer-conclusao.util';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * DESFAZER A CONCLUSÃO (D6) — só quem concluiu, até 120 s, e só quando não há
 * efeito que desfazer não saiba desfazer. O toast dura 8 s; o servidor aceita
 * até 2 minutos para cobrir rede lenta e o celular que dormiu no meio.
 */
const { PENDENTE, EM_ANDAMENTO, CONCLUIDO } = StatusCompromisso;
const agora = new Date('2026-09-13T15:00:00.000Z');
const concluidoEm = new Date(agora.getTime() - 30_000);

const atividade = { status: CONCLUIDO, concluidoEm, concluidoPor: 'u1' };
const registro = (extra: Record<string, unknown> = {}): RegistroDaConclusao => ({
  metadata: {
    concluidoEm: concluidoEm.toISOString(),
    de: PENDENTE,
    seguimentoCriado: null,
    preProcessualCriado: null,
    processoAntes: 'p1',
    processoDepois: 'p1',
    substituidas: [],
    andamentoId: 'm1',
    ...extra,
  },
});

describe('podeDesfazerConclusao', () => {
  it('quem concluiu, dentro do prazo, sem efeito colateral: volta ao que era', () => {
    expect(podeDesfazerConclusao(atividade, registro(), 'u1', agora)).toEqual({ ok: true, voltarPara: PENDENTE, andamentoId: 'm1' });
    expect(podeDesfazerConclusao(atividade, registro({ de: EM_ANDAMENTO }), 'u1', agora)).toEqual(
      expect.objectContaining({ ok: true, voltarPara: EM_ANDAMENTO }),
    );
  });

  it('a janela é de 120 s, com a borda incluída', () => {
    const noLimite = new Date(concluidoEm.getTime() + JANELA_DO_DESFAZER_MS);
    const passou = new Date(noLimite.getTime() + 1);
    expect(podeDesfazerConclusao(atividade, registro(), 'u1', noLimite).ok).toBe(true);
    expect(podeDesfazerConclusao(atividade, registro(), 'u1', passou)).toEqual({
      ok: false,
      motivo: expect.stringContaining('O tempo para desfazer acabou'),
    });
  });

  it.each<[string, Parameters<typeof podeDesfazerConclusao>, string]>([
    ['outra pessoa', [atividade, registro(), 'u2', agora], 'Só quem concluiu'],
    ['sem usuário', [atividade, registro(), undefined, agora], 'Só quem concluiu'],
    ['não está concluída', [{ ...atividade, status: PENDENTE }, registro(), 'u1', agora], 'não está concluída'],
    ['registro de outra conclusão', [atividade, registro({ concluidoEm: '2026-09-10T10:00:00.000Z' }), 'u1', agora], 'Não achei o registro'],
    ['sem registro', [atividade, null, 'u1', agora], 'Não achei o registro'],
    ['criou seguimento', [atividade, registro({ seguimentoCriado: 's1' }), 'u1', agora], 'seguimento'],
    ['abriu pré-processual', [atividade, registro({ preProcessualCriado: 'proc9' }), 'u1', agora], 'pré-processual'],
    ['vinculou processo', [atividade, registro({ processoAntes: null, processoDepois: 'p1' }), 'u1', agora], 'vinculou'],
    ['substituiu providência', [atividade, registro({ substituidas: ['s0'] }), 'u1', agora], 'substituiu'],
  ])('recusa: %s', (_caso, args, trecho) => {
    const r = podeDesfazerConclusao(...args);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.motivo).toContain(trecho);
    // Toda recusa de algo concluído aponta o caminho que continua existindo.
    // (A que não está concluída não tem o que reabrir.)
    if (args[0].status === StatusCompromisso.CONCLUIDO) {
      expect(!r.ok && r.motivo).toContain('reabra a atividade');
    }
  });

  it('conclusão antiga, sem o id do andamento anotado, não acha nada para substituir', () => {
    expect(andamentoDaConclusao(null)).toBeNull();
    expect(andamentoDaConclusao({ metadata: { desfecho: 'X' } as never })).toBeNull();
    expect(andamentoDaConclusao(registro())).toBe('m1');
  });
});

/* ------------------------------------------------------------------------ */

function montar(opcoes: {
  concluidoPor?: string;
  count?: number;
  concluidoEm?: Date;
  atendimentoId?: string;
  /** O atendimento no banco, montado com o `concluidoEm` da consulta. */
  atendimento?: (concluidoEmDaConsulta: Date) => Record<string, any>;
} = {}) {
  const concluida = {
    id: 'c1', status: CONCLUIDO, titulo: 'Elaborar manifestação', desfecho: 'PRAZO_CUMPRIDO',
    concluidoEm: opcoes.concluidoEm ?? new Date(Date.now() - 20_000), concluidoPor: opcoes.concluidoPor ?? 'u1',
    atendimentoId: opcoes.atendimentoId ?? null,
  };
  const updateMany = jest.fn(async (_a: any) => ({ count: opcoes.count ?? 1 }));
  const deleteMany = jest.fn(async (_a: any) => ({ count: 1 }));
  const historico = jest.fn(async (_a: any) => ({}));
  /* O atendimento com estado: igualdade campo a campo, datas pelo instante — como o Postgres compara o carimbo. */
  const atendimento = opcoes.atendimento ? opcoes.atendimento(concluida.concluidoEm) : null;
  const casa = (where: Record<string, any>) =>
    !!atendimento && Object.entries(where).every(([k, v]) =>
      v instanceof Date ? atendimento[k] instanceof Date && atendimento[k].getTime() === v.getTime() : atendimento[k] === v);
  const atendimentoUpdateMany = jest.fn(async ({ where, data }: any) => {
    if (!casa(where)) return { count: 0 };
    Object.assign(atendimento!, data);
    return { count: 1 };
  });
  const prisma: any = {
    compromisso: {
      findUnique: jest.fn(async () => concluida),
      updateMany,
      findUniqueOrThrow: jest.fn(async () => ({ id: 'c1', status: EM_ANDAMENTO })),
    },
    atendimento: {
      findFirst: jest.fn(async ({ where }: any) => (casa(where) ? { ...atendimento } : null)),
      updateMany: atendimentoUpdateMany,
    },
    compromissoHistorico: {
      findFirst: jest.fn(async () => ({
        metadata: {
          concluidoEm: concluida.concluidoEm.toISOString(), de: EM_ANDAMENTO, andamentoId: 'm1',
          seguimentoCriado: null, preProcessualCriado: null, processoAntes: 'p1', processoDepois: 'p1', substituidas: [],
        },
      })),
      create: historico,
    },
    movimentacaoInterna: { deleteMany },
  };
  prisma.$transaction = async (cb: (t: unknown) => unknown) => cb(prisma);
  // A trava do atendimento (15/09/2026): consulta crua, antes de tocar a atividade.
  const trava = jest.fn(async (_partes: TemplateStringsArray, ..._valores: unknown[]) => []);
  prisma.$queryRaw = trava;
  const audit = { registrar: jest.fn(async () => ({})) };
  const servico = new AgendaService(prisma as never, audit as never, {} as never);
  return { servico, updateMany, deleteMany, historico, audit, atendimento, atendimentoUpdateMany, trava };
}

const ctx = { userId: 'u1', nome: 'Ana' };

describe('PATCH :id/desfazer-conclusao', () => {
  it('volta ao status de antes, limpa o desfecho, apaga só o andamento de origem CONCLUSAO e conta no histórico', async () => {
    const m = montar();
    const r = await m.servico.desfazerConclusao('c1', ctx);

    // Sem atendimento de origem, nada a devolver — e nenhuma leitura do atendimento.
    expect(r).toEqual({ id: 'c1', status: EM_ANDAMENTO, atendimentoReaberto: null });
    expect(m.atendimentoUpdateMany).not.toHaveBeenCalled();
    expect(m.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', status: CONCLUIDO, concluidoPor: 'u1' },
      data: { status: EM_ANDAMENTO, desfecho: null, desfechoObs: null, concluidoEm: null, concluidoPor: null },
    });
    expect(m.deleteMany).toHaveBeenCalledWith({ where: { id: 'm1', origem: 'CONCLUSAO' } });

    const linha = m.historico.mock.calls[0][0].data;
    expect(linha.acao).toBe('REABERTO');
    expect(linha.metadata).toEqual(expect.objectContaining({ via: 'desfazer', de: CONCLUIDO, para: EM_ANDAMENTO, andamentoRemovido: 'm1' }));
    expect(linha.descricao).toContain('Peça protocolada');
  });

  it('outra pessoa: 400 e nada muda', async () => {
    const m = montar({ concluidoPor: 'u2' });
    await expect(m.servico.desfazerConclusao('c1', ctx)).rejects.toThrow('Só quem concluiu');
    expect(m.updateMany).not.toHaveBeenCalled();
    expect(m.deleteMany).not.toHaveBeenCalled();
  });

  it('passados os 2 minutos: 400', async () => {
    const m = montar({ concluidoEm: new Date(Date.now() - 121_000) });
    await expect(m.servico.desfazerConclusao('c1', ctx)).rejects.toThrow('O tempo para desfazer acabou');
  });

  /** Dois toques em "Desfazer": o segundo encontra a atividade já aberta. */
  it('dois toques não desfazem duas vezes', async () => {
    const m = montar({ count: 0 });
    await expect(m.servico.desfazerConclusao('c1', ctx)).rejects.toThrow('não está mais concluída');
    expect(m.deleteMany).not.toHaveBeenCalled();
    expect(m.atendimentoUpdateMany).not.toHaveBeenCalled();
  });
});

/**
 * O ATENDIMENTO QUE A CONSULTA FECHOU VOLTA COM ELA — só se o carimbo bater
 * (15/09/2026, E1 da rodada 4). O #13: a Dra. Shérad concluiu a consulta por
 * engano e desfez no toast.
 */
describe('desfazer devolve o atendimento de origem', () => {
  const fechadoPelaConsulta = (concluidoEm: Date) => ({
    id: 'a-13', numero: 13, status: 'CONCLUIDO', desfecho: 'ENCAMINHADO',
    concluidoEm: new Date(concluidoEm.getTime()), concluidoPor: 'u1', conclusaoObs: 'Prazo cumprido.',
    conclusaoOrigem: 'CONSULTA', conclusaoConsultaId: 'c1',
  });

  it('carimbo igual: o #13 volta a aguardar a consulta, com as cinco colunas limpas e a auditoria no atendimento', async () => {
    const m = montar({ atendimentoId: 'a-13', atendimento: fechadoPelaConsulta });
    const r: any = await m.servico.desfazerConclusao('c1', ctx);

    expect(r.atendimentoReaberto).toEqual({ id: 'a-13', numero: 13 });
    // Travou a linha do atendimento antes de devolver a atividade: a mesma ordem da triagem.
    expect(m.trava).toHaveBeenCalledTimes(1);
    expect(m.trava.mock.calls[0][0].join('?')).toMatch(/FROM "atendimentos" WHERE id = \? FOR UPDATE/);
    expect(m.trava.mock.calls[0][1]).toBe('a-13');
    expect(m.trava.mock.invocationCallOrder[0]).toBeLessThan(m.updateMany.mock.invocationCallOrder[0]);
    expect(m.atendimento).toMatchObject({
      status: 'PENDENTE', concluidoEm: null, concluidoPor: null, conclusaoObs: null,
      conclusaoOrigem: null, conclusaoConsultaId: null,
    });
    const doAtendimento = m.audit.registrar.mock.calls.map((c: any[]) => c[0]).find((x: any) => x.entidade === 'Atendimento');
    expect(doAtendimento).toMatchObject({
      entidadeId: 'a-13',
      userId: 'u1',
      descricao: 'Atendimento #13: andamento de CONCLUIDO para PENDENTE, a consulta voltou a ficar aberta',
      metadata: { via: 'CONSULTA', compromissoId: 'c1', fechamentoAnterior: { nota: 'Prazo cumprido.', por: 'u1', origem: 'CONSULTA' } },
    });
    expect(m.historico.mock.calls[0][0].data.metadata).toMatchObject({ atendimentoReaberto: 'a-13' });
  });

  it.each<[string, (concluidoEm: Date) => Record<string, any>]>([
    ['a triagem reabriu e fechou de novo', (em) => ({ ...fechadoPelaConsulta(em), conclusaoOrigem: 'TRIAGEM', conclusaoConsultaId: null, concluidoEm: new Date(em.getTime() + 60_000) })],
    ['outra consulta fechou', (em) => ({ ...fechadoPelaConsulta(em), conclusaoConsultaId: 'c-outra' })],
    ['mesma consulta, outro instante', (em) => ({ ...fechadoPelaConsulta(em), concluidoEm: new Date(em.getTime() + 1) })],
    ['a triagem já reabriu', (em) => ({ ...fechadoPelaConsulta(em), status: 'PENDENTE' })],
    ['concluído antes de 15/09, sem carimbo', (em) => ({ ...fechadoPelaConsulta(em), conclusaoOrigem: null, conclusaoConsultaId: null })],
  ])('carimbo diferente (%s): a consulta volta, o atendimento fica como está', async (_caso, montarAtendimento) => {
    const m = montar({ atendimentoId: 'a-13', atendimento: montarAtendimento });
    const antes = { ...m.atendimento };
    const r: any = await m.servico.desfazerConclusao('c1', ctx);
    expect(r.atendimentoReaberto).toBeNull();
    expect(m.atendimento).toEqual(antes);
    expect(m.atendimentoUpdateMany).not.toHaveBeenCalled();
    expect(m.audit.registrar.mock.calls.map((c: any[]) => c[0].entidade)).not.toContain('Atendimento');
  });
});
