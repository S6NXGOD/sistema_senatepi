import { StatusCompromisso } from '@prisma/client';
import { AgendaService } from './agenda.service';
import { desfechosComSugestao } from './desfechos.catalogo';
import { podeDesfazerConclusao } from './desfazer-conclusao.util';
import { NAO_E_RESERVA } from './equipe.util';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * O QUE A CONCLUSÃO ESCREVE — com prisma falso, afirmando os dados gravados.
 *
 *  · o andamento no processo nasce com `origem: 'CONCLUSAO'` (os Relatórios não
 *    o contam como lançamento de gente) e o id dele fica no histórico;
 *  · concluir de novo REESCREVE aquele andamento em vez de empilhar outro;
 *  · a tela que concluiu (`origem`) vai para o histórico e a auditoria;
 *  · o seguimento cai em dia útil, na data que a prévia mostrou, e leva quem
 *    atuava junto (menos a reserva do robô);
 *  · reabrir limpa a categoria de cancelamento;
 *  · a conversa que abre o pré-processual grava `origem: 'CONVERSAO'`.
 */

function prismaFalso(impl: Record<string, Record<string, (args: any) => unknown>> = {}) {
  const fns = new Map<string, jest.Mock>();
  const padrao = (metodo: string): unknown => {
    if (metodo === 'findMany' || metodo === 'groupBy') return [];
    if (metodo === 'count') return 0;
    if (metodo === 'updateMany' || metodo === 'deleteMany') return { count: 0 };
    if (metodo.startsWith('find')) return null;
    return { id: 'gerado' };
  };
  const fn = (modelo: string, metodo: string): jest.Mock => {
    const chave = `${modelo}.${metodo}`;
    if (!fns.has(chave)) {
      fns.set(chave, jest.fn(async (args: any) => (impl[modelo]?.[metodo] ?? (() => padrao(metodo)))(args)));
    }
    return fns.get(chave)!;
  };
  const prisma: any = new Proxy(
    {},
    {
      get(_alvo, modelo) {
        if (typeof modelo !== 'string' || modelo === 'then') return undefined;
        if (modelo === '$transaction') return async (cb: (tx: unknown) => unknown) => cb(prisma);
        // A trava do atendimento é uma consulta crua (15/09/2026): vira `fn('$queryRaw', 'sql')`.
        if (modelo === '$queryRaw') return fn('$queryRaw', 'sql');
        return new Proxy({}, { get: (_m, metodo) => (typeof metodo === 'string' ? fn(modelo, metodo) : undefined) });
      },
    },
  );
  return { prisma, fn };
}

function montar(atual: Record<string, unknown>, impl: Parameters<typeof prismaFalso>[0] = {}) {
  const { prisma, fn } = prismaFalso({
    ...impl,
    compromisso: {
      findUnique: () => atual,
      // Concluir e reabrir gravam com `updateMany` condicional desde 15/09/2026, e releem o cartão.
      updateMany: () => ({ count: 1 }),
      findUniqueOrThrow: () => ({ id: atual.id }),
      update: () => ({ id: atual.id }),
      create: (a) => ({ id: 'seg1', titulo: a.data.titulo, inicio: a.data.inicio, tipo: a.data.tipo }),
      ...impl.compromisso,
    },
    tipoCompromisso: { findUnique: () => ({ ativo: true }), ...impl.tipoCompromisso },
  });
  const audit = { registrar: jest.fn(async (_a: any) => ({})) };
  const servico = new AgendaService(prisma as never, audit as never, {} as never);
  const historicoDe = (acao: string) =>
    fn('compromissoHistorico', 'create').mock.calls.map((c) => c[0].data).find((d) => d.acao === acao);
  return { servico, fn, audit, historicoDe };
}

const ctx = { userId: 'u1', nome: 'Ana' };
const prazo = {
  id: 'c1', status: StatusCompromisso.PENDENTE, titulo: 'Elaborar manifestação', descricao: null,
  tipo: 'PRAZO', inicio: new Date('2026-09-17T12:00:00Z'), filiadoId: null, processoId: 'p1',
  responsavelId: 'u1', atendimentoId: null, urgente: false, urgenteMotivo: null,
};

describe('o andamento que a conclusão escreve', () => {
  it('nasce com origem CONCLUSAO, e o histórico guarda o id dele e a tela que concluiu', async () => {
    const m = montar(prazo, { movimentacaoInterna: { create: () => ({ id: 'm-novo' }) } });
    await m.servico.concluir('c1', { desfecho: 'PRAZO_CUMPRIDO', origem: 'PAINEL' }, ctx);

    const criar = m.fn('movimentacaoInterna', 'create');
    expect(criar).toHaveBeenCalledTimes(1);
    expect(criar.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ processoId: 'p1', autorId: 'u1', origem: 'CONCLUSAO' }),
    );

    const concluidoEm = m.fn('compromisso', 'updateMany').mock.calls[0][0].data.concluidoEm as Date;
    const linha = m.historicoDe('CONCLUIDO')!;
    expect(linha.metadata).toEqual(
      expect.objectContaining({
        origem: 'PAINEL', andamentoId: 'm-novo', andamentoSubstituido: false, seguimentoCriado: null,
        de: 'PENDENTE', concluidoEm: concluidoEm.toISOString(), processoAntes: 'p1', processoDepois: 'p1',
      }),
    );
    expect(m.audit.registrar.mock.calls[0][0].metadata).toEqual(expect.objectContaining({ origem: 'PAINEL' }));

    // O que a conclusão anotou é exatamente o que o desfazer precisa para decidir.
    expect(
      podeDesfazerConclusao(
        { status: StatusCompromisso.CONCLUIDO, concluidoEm, concluidoPor: 'u1' },
        { metadata: linha.metadata },
        'u1',
        new Date(concluidoEm.getTime() + 5_000),
      ),
    ).toEqual({ ok: true, voltarPara: 'PENDENTE', andamentoId: 'm-novo' });
  });

  /** Reabrir e concluir de novo gravava um segundo "X — Houve acordo" na linha do tempo. */
  it('reconcluir reescreve o andamento da conclusão anterior, sem criar outro', async () => {
    const m = montar(prazo, {
      compromissoHistorico: { findFirst: () => ({ metadata: { andamentoId: 'm-velho' } }) },
      movimentacaoInterna: {
        findFirst: (a) => (a.where.id === 'm-velho' && a.where.origem === 'CONCLUSAO' ? { id: 'm-velho' } : null),
      },
    });
    await m.servico.concluir('c1', { desfecho: 'PRAZO_SEM_PECA', desfechoObs: 'Intimação só para ciência.' }, ctx);

    expect(m.fn('movimentacaoInterna', 'create')).not.toHaveBeenCalled();
    const upd = m.fn('movimentacaoInterna', 'update').mock.calls[0][0];
    expect(upd.where).toEqual({ id: 'm-velho' });
    expect(upd.data.descricao).toContain('Analisado — nada a protocolar');
    expect(m.historicoDe('CONCLUIDO')!.metadata).toEqual(
      expect.objectContaining({ andamentoId: 'm-velho', andamentoSubstituido: true, origem: null }),
    );
  });

  /** A nota que alguém lançou à mão não é eco da conclusão: não se reescreve. */
  it('se a nota anterior não é mais de origem CONCLUSAO, cria uma nova', async () => {
    const m = montar(prazo, {
      compromissoHistorico: { findFirst: () => ({ metadata: { andamentoId: 'm-velho' } }) },
      movimentacaoInterna: {
        findFirst: (a) => (a.where.origem === undefined ? { id: 'm-velho' } : null),
        create: () => ({ id: 'm-novo' }),
      },
    });
    await m.servico.concluir('c1', { desfecho: 'PRAZO_CUMPRIDO' }, ctx);
    expect(m.fn('movimentacaoInterna', 'update')).not.toHaveBeenCalled();
    expect(m.fn('movimentacaoInterna', 'create')).toHaveBeenCalledTimes(1);
  });
});

describe('o seguimento', () => {
  const sexta = new Date('2026-09-18T19:00:00Z'); // sexta, 16h em Teresina

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
    jest.setSystemTime(sexta);
  });
  afterEach(() => jest.useRealTimers());

  const contato = {
    ...prazo, tipo: 'CONTATO', titulo: 'Avisar filiado da audiência', processoId: null,
  };

  it('"Nova tentativa de contato" (1 dia) concluída na sexta nasce na segunda às 9h, na data que a prévia mostrou', async () => {
    const m = montar(contato);
    const r: any = await m.servico.concluir('c1', { desfecho: 'CONTATO_SEM_SUCESSO', desfechoObs: 'Telefone desligado.' }, ctx);

    const inicio = m.fn('compromisso', 'create').mock.calls[0][0].data.inicio as Date;
    expect(inicio.toISOString()).toBe('2026-09-21T12:00:00.000Z');

    const previa = desfechosComSugestao('CONTATO', sexta).find((d) => d.slug === 'CONTATO_SEM_SUCESSO');
    expect(previa?.seguimento?.sugeridoPara).toBe(inicio.toISOString());
    expect(r.seguimentoCriado.id).toBe('seg1');
  });

  it('leva quem atuava junto, menos a reserva do robô e quem saiu do sistema', async () => {
    const m = montar(contato, {
      compromissoResponsavel: { findMany: (a) => (a.where.compromissoId === 'c1' ? [{ usuarioId: 'u2' }] : []) },
    });
    await m.servico.concluir('c1', { desfecho: 'CONTATO_SEM_SUCESSO', desfechoObs: 'Telefone desligado.' }, ctx);

    const consulta = m.fn('compromissoResponsavel', 'findMany').mock.calls.map((c) => c[0].where).find((w) => w.compromissoId === 'c1');
    expect(consulta).toEqual({ compromissoId: 'c1', principal: false, ...NAO_E_RESERVA, usuario: { ativo: true } });

    const upserts = m.fn('compromissoResponsavel', 'upsert').mock.calls.map((c) => c[0].create);
    expect(upserts).toEqual([
      { compromissoId: 'seg1', usuarioId: 'u1', principal: true },
      { compromissoId: 'seg1', usuarioId: 'u2', principal: false },
    ]);
  });
});

describe('reabrir', () => {
  it('limpa também a categoria do cancelamento', async () => {
    const m = montar({ id: 'c1', status: StatusCompromisso.CANCELADO, iniciadoEm: null, titulo: 'Reunião' });
    await m.servico.mudarStatus('c1', { status: StatusCompromisso.PENDENTE }, ctx);
    const gravacao = m.fn('compromisso', 'updateMany').mock.calls[0][0];
    // Condicional à situação lida: quem chega segundo não regrava por cima.
    expect(gravacao.where).toEqual({ id: 'c1', status: StatusCompromisso.CANCELADO });
    expect(gravacao.data).toEqual(
      expect.objectContaining({ status: 'PENDENTE', canceladoCategoria: null, canceladoMotivo: null }),
    );
  });

  it('outra pessoa mudou a atividade no meio: "abra de novo", sem histórico nem auditoria', async () => {
    const m = montar(
      { id: 'c1', status: StatusCompromisso.CANCELADO, iniciadoEm: null, titulo: 'Reunião' },
      { compromisso: { updateMany: () => ({ count: 0 }) } },
    );
    await expect(m.servico.mudarStatus('c1', { status: StatusCompromisso.PENDENTE }, ctx))
      .rejects.toThrow('Esta atividade acabou de ser mudada por outra pessoa.');
    expect(m.audit.registrar).not.toHaveBeenCalled();
    expect(m.historicoDe('REABERTO')).toBeUndefined();
  });
});

describe('a conversa que abre o pré-processual', () => {
  it('é gravada com origem CONVERSAO — e a conclusão não escreve um segundo andamento', async () => {
    const consulta = { ...prazo, tipo: 'CONSULTA_JURIDICA', titulo: 'Consulta Jurídica — MARIA', processoId: null };
    const m = montar(consulta, { processo: { create: () => ({ id: 'proc1', titulo: 'Consulta Jurídica — MARIA' }) } });
    await m.servico.concluir('c1', { desfecho: 'PROCESSO_CRIADO', desfechoObs: 'Quer ação de insalubridade.' }, ctx);

    const criadas = m.fn('movimentacaoInterna', 'create').mock.calls.map((c) => c[0].data);
    expect(criadas).toHaveLength(1);
    expect(criadas[0]).toEqual(expect.objectContaining({ processoId: 'proc1', origem: 'CONVERSAO' }));
  });
});

/*
  O CASO PRÉ-PROCESSUAL NÃO FICA ÓRFÃO (15/09/2026). Ele nascia numa transação
  própria, já comitada, antes da gravação condicional da consulta. Com a triagem
  cancelando a consulta no mesmo instante, a gravação recusava e o processo
  ficava no acervo, ligado ao filiado e ao atendimento. Agora nasce depois de a
  consulta ser gravada, com o `tx` da conclusão.
*/
describe('o pré-processual nasce dentro da conclusão', () => {
  const consulta = {
    ...prazo, tipo: 'CONSULTA_JURIDICA', titulo: 'Consulta Jurídica — MARIA', processoId: null,
    filiadoId: 'f1', atendimentoId: 'a1', origemDesfechoId: null,
  };
  const casoNovo = {
    processo: { create: () => ({ id: 'proc1', titulo: 'Consulta Jurídica — MARIA' }) },
    filiado: { findUnique: () => ({ nomeCompleto: 'MARIA DAS DORES', cpf: '123.456.789-00' }) },
  };
  const VIROU_PROCESSO = { desfecho: 'PROCESSO_CRIADO', desfechoObs: 'Quer ação de insalubridade.' };

  it('a consulta mudou no meio (a triagem cancelou): nenhum processo, parte, equipe, vínculo nem auditoria de caso', async () => {
    const m = montar(consulta, { ...casoNovo, compromisso: { updateMany: () => ({ count: 0 }) } });
    await expect(m.servico.concluir('c1', VIROU_PROCESSO, ctx))
      .rejects.toThrow('Esta atividade acabou de ser mudada por outra pessoa.');

    expect(m.fn('processo', 'create')).not.toHaveBeenCalled();
    expect(m.fn('parteProcesso', 'create')).not.toHaveBeenCalled();
    expect(m.fn('processoAdvogado', 'create')).not.toHaveBeenCalled();
    expect(m.fn('movimentacaoInterna', 'create')).not.toHaveBeenCalled();
    expect(m.fn('atendimento', 'update')).not.toHaveBeenCalled();
    expect(m.audit.registrar).not.toHaveBeenCalled();
  });

  it('com a consulta gravada, o caso nasce depois dela, liga a consulta e o atendimento, e é auditado depois', async () => {
    const m = montar(consulta, casoNovo);
    const r: any = await m.servico.concluir('c1', VIROU_PROCESSO, ctx);

    const ordem = (modelo: string, metodo: string) => m.fn(modelo, metodo).mock.invocationCallOrder[0];
    expect(ordem('$queryRaw', 'sql')).toBeLessThan(ordem('compromisso', 'updateMany'));
    expect(ordem('compromisso', 'updateMany')).toBeLessThan(ordem('processo', 'create'));
    expect(m.fn('compromisso', 'update').mock.calls.map((c) => c[0])).toContainEqual({ where: { id: 'c1' }, data: { processoId: 'proc1' } });
    expect(m.fn('atendimento', 'update').mock.calls[0][0]).toEqual({ where: { id: 'a1' }, data: { processoId: 'proc1' } });

    const entidades = m.audit.registrar.mock.calls.map((c) => c[0]);
    expect(entidades[0]).toEqual(expect.objectContaining({ entidade: 'Processo', entidadeId: 'proc1', acao: 'CREATE' }));
    expect(m.historicoDe('CONCLUIDO')!.metadata).toEqual(
      expect.objectContaining({ preProcessualCriado: 'proc1', processoDepois: 'proc1' }),
    );
    expect(r.preProcessualCriado).toEqual({ id: 'proc1', titulo: 'Consulta Jurídica — MARIA' });
  });
});
