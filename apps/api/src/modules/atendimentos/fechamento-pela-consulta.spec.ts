import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AgendaService } from '../agenda/agenda.service';
import {
  comFraseDeCorrida, concluirAtendimentoPelaConsulta, conclusaoObsDaConsulta, ehCorridaNoBanco, ORIGEM_DA_CONCLUSAO,
  reabrirAtendimentoFechadoPelaConsulta,
} from './fechamento-pela-consulta';
import { NOTA_MAXIMA } from './fechamento.util';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * O ATENDIMENTO FECHA SOZINHO QUANDO A CONSULTA É REGISTRADA (15/09/2026, E1).
 *
 * Testado com um banco falso que tem estado e que lê o `where` como o Postgres:
 * igualdade (datas pelo instante), `in`, `not` que NUNCA casa com nulo, e o
 * `none` da relação com as consultas. Assim cada condição do `updateMany` é
 * provada pelo que fica gravado, e não por uma linha que existe no fonte.
 *
 * O mundo é o do balcão de 14/09/2026: o #13, encaminhado à Dra. Shérad, com a
 * consulta de seg 14/09 às 09:00.
 */

type Linha = Record<string, any>;

const clonar = <T>(x: T): T => {
  if (x instanceof Date) return new Date(x.getTime()) as T;
  if (Array.isArray(x)) return x.map(clonar) as T;
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, clonar(v)])) as T;
  return x;
};

interface Banco {
  compromissos: Linha[];
  atendimentos: Linha[];
  historico: Linha[];
}

function confere(bd: Banco, linha: Linha, where: Linha | undefined): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (v instanceof Date) return linha[k] instanceof Date && linha[k].getTime() === v.getTime();
    if (v && typeof v === 'object') {
      if (k === 'compromissos' && 'none' in v) {
        return !bd.compromissos.some((c) => c.atendimentoId === linha.id && confere(bd, c, v.none));
      }
      if ('in' in v) return (v.in as unknown[]).includes(linha[k]);
      // Como no SQL: `col <> X` não traz a linha NULA (memória "not em coluna nula").
      if ('not' in v) return linha[k] !== null && linha[k] !== undefined && linha[k] !== v.not;
    }
    return linha[k] === v;
  });
}

interface Ganchos {
  antesDaTransacao?: (bd: Banco) => void;
  /** Roda na trava do atendimento: é ali que o Postgres acusa o deadlock de quem esperava a linha. */
  naTrava?: () => void;
}

function montarBanco(inicial: Partial<Banco>, ganchos: Ganchos = {}) {
  const estado = { bd: clonar({ compromissos: [], atendimentos: [], historico: [], ...inicial }) as Banco };
  const passos: string[] = [];
  const bd = () => estado.bd;

  const api: Linha = {
    atendimento: {
      updateMany: async ({ where, data }: any) => {
        passos.push('atendimento.updateMany');
        const alvo = bd().atendimentos.filter((a) => confere(bd(), a, where));
        alvo.forEach((a) => Object.assign(a, data));
        return { count: alvo.length };
      },
      findUnique: async ({ where, select }: any) => {
        const a = bd().atendimentos.find((x) => x.id === where.id);
        if (!a) return null;
        const linha = clonar(a);
        if (select?.compromissos) {
          linha.compromissos = bd().compromissos
            .filter((c) => c.atendimentoId === a.id && confere(bd(), c, select.compromissos.where))
            .slice(0, select.compromissos.take ?? Infinity)
            .map((c) => ({ id: c.id }));
        }
        return linha;
      },
      findUniqueOrThrow: async ({ where }: any) => {
        const a = bd().atendimentos.find((x) => x.id === where.id);
        if (!a) throw new Error('não existe');
        return clonar(a);
      },
      findFirst: async ({ where }: any) => clonar(bd().atendimentos.find((a) => confere(bd(), a, where)) ?? null),
    },
    compromisso: {
      findUnique: async ({ where }: any) => clonar(bd().compromissos.find((c) => c.id === where.id) ?? null),
      findUniqueOrThrow: async ({ where }: any) => clonar(bd().compromissos.find((c) => c.id === where.id)),
      findMany: async () => [],
      updateMany: async ({ where, data }: any) => {
        passos.push(`compromisso.updateMany:${where.id}`);
        const alvo = bd().compromissos.filter((c) => confere(bd(), c, where));
        alvo.forEach((c) => Object.assign(c, data));
        return { count: alvo.length };
      },
    },
    compromissoHistorico: {
      create: async ({ data }: any) => { bd().historico.push(clonar(data)); return data; },
      findFirst: async ({ where }: any) =>
        clonar([...bd().historico].reverse().find((h) => h.compromissoId === where.compromissoId && h.acao === where.acao) ?? null),
    },
  };

  const padrao = (metodo: string) =>
    metodo === 'count' ? 0 : metodo === 'findMany' ? [] : /^(updateMany|deleteMany)$/.test(metodo) ? { count: 0 } : null;
  const comPadrao = (modelo: string) =>
    new Proxy(api[modelo] ?? {}, {
      get: (alvo, metodo: string) => alvo[metodo] ?? (async () => padrao(metodo)),
    });

  const prisma: any = new Proxy({}, {
    get(_a, modelo) {
      if (typeof modelo !== 'string' || modelo === 'then') return undefined;
      // A consulta crua da trava: registra QUAL linha foi travada, e em que ponto da transação.
      if (modelo === '$queryRaw') {
        return async (partes: TemplateStringsArray, ...valores: unknown[]) => {
          const sql = partes.join('?');
          passos.push(/FROM "atendimentos".*FOR UPDATE/.test(sql) ? `trava:atendimentos:${valores[0]}` : `sql:${sql}`);
          ganchos.naTrava?.();
          return [];
        };
      }
      if (modelo === '$transaction') {
        return async (fn: (tx: unknown) => unknown) => {
          ganchos.antesDaTransacao?.(estado.bd);
          const copia = clonar(estado.bd);
          passos.push('transacao:inicio');
          try {
            const r = await fn(prisma);
            passos.push('transacao:commit');
            return r;
          } catch (e) {
            estado.bd = copia;
            passos.push('transacao:desfeita');
            throw e;
          }
        };
      }
      return comPadrao(modelo);
    },
  });
  return { prisma, estado, passos };
}

/** O erro que o Prisma 5 lança quando o Postgres aborta a transação. */
function corrida(code: string, codigoDoPostgres?: string) {
  return new Prisma.PrismaClientKnownRequestError('transação abortada pelo banco', {
    code,
    clientVersion: '5.20.0',
    ...(codigoDoPostgres ? { meta: { code: codigoDoPostgres } } : {}),
  });
}

describe('ehCorridaNoBanco e comFraseDeCorrida', () => {
  it('reconhece o deadlock e o conflito de escrita, e só eles', () => {
    expect(ehCorridaNoBanco(corrida('P2034'))).toBe(true);
    expect(ehCorridaNoBanco(corrida('P2010', '40P01'))).toBe(true);
    expect(ehCorridaNoBanco(corrida('P2010', '40001'))).toBe(true);
    expect(ehCorridaNoBanco(corrida('P2010', '23505'))).toBe(false);
    expect(ehCorridaNoBanco(corrida('P2002'))).toBe(false);
    expect(ehCorridaNoBanco(new Error('P2034'))).toBe(false);
  });

  it('troca a corrida pela frase, e deixa passar qualquer outro erro como veio', async () => {
    const perdida = await comFraseDeCorrida('Abra de novo.', async () => { throw corrida('P2034'); }).catch((e) => e);
    expect(perdida).toBeInstanceOf(BadRequestException);
    expect(perdida.message).toBe('Abra de novo.');

    const outro = new Error('conexão caiu');
    await expect(comFraseDeCorrida('Abra de novo.', async () => { throw outro; })).rejects.toBe(outro);
    await expect(comFraseDeCorrida('Abra de novo.', async () => 42)).resolves.toBe(42);
  });
});

const HOJE_9H = new Date('2026-09-14T12:00:00.000Z');
const REGISTRADA_EM = new Date('2026-09-14T13:12:00.000Z');

const CONSULTA_13: Linha = {
  id: 'c-13', status: 'PENDENTE', titulo: 'Consulta Jurídica — Iraci Moura', descricao: null, tipo: 'CONSULTA_JURIDICA',
  inicio: HOJE_9H, filiadoId: 'f-1', processoId: null, responsavelId: 'u-sherad', atendimentoId: 'a-13',
  origemDesfechoId: null, urgente: false, urgenteMotivo: null, iniciadoEm: null,
  desfecho: null, desfechoObs: null, concluidoEm: null, concluidoPor: null,
};

const ATENDIMENTO_13: Linha = {
  id: 'a-13', numero: 13, status: 'PENDENTE', desfecho: 'ENCAMINHADO',
  concluidoEm: null, concluidoPor: null, conclusaoObs: null, conclusaoOrigem: null, conclusaoConsultaId: null,
};

const PEDIDO = {
  consulta: { id: 'c-13', atendimentoId: 'a-13', origemDesfechoId: null },
  desfecho: 'DUVIDA_ESCLARECIDA',
  rotuloDesfecho: 'Dúvida esclarecida',
  desfechoObs: 'Orientada a pedir a progressão no RH.',
  autorId: 'u-sherad',
  agora: REGISTRADA_EM,
};

describe('conclusaoObsDaConsulta — a nota que o atendimento guarda', () => {
  it('o rótulo do desfecho e a observação de quem atendeu', () => {
    expect(conclusaoObsDaConsulta('Dúvida esclarecida', ' Orientada a pedir a progressão no RH. '))
      .toBe('Dúvida esclarecida. Orientada a pedir a progressão no RH.');
    expect(conclusaoObsDaConsulta('Dúvida esclarecida', null)).toBe('Dúvida esclarecida.');
    // Rótulo que já termina em ponto não ganha outro.
    expect(conclusaoObsDaConsulta('Houve acordo.', 'Pagamento em 3 parcelas.')).toBe('Houve acordo. Pagamento em 3 parcelas.');
  });

  it('cortada no teto da nota do atendimento', () => {
    expect(conclusaoObsDaConsulta('Dúvida esclarecida', 'x'.repeat(3000))).toHaveLength(NOTA_MAXIMA);
  });
});

describe('concluirAtendimentoPelaConsulta', () => {
  it('#13: fecha com o mesmo instante da consulta, quem a registrou, a nota e o carimbo da consulta', async () => {
    const m = montarBanco({ compromissos: [clonar(CONSULTA_13)], atendimentos: [clonar(ATENDIMENTO_13)] });
    const r = await concluirAtendimentoPelaConsulta(m.prisma, PEDIDO);

    expect(m.estado.bd.atendimentos[0]).toEqual({
      ...ATENDIMENTO_13,
      status: 'CONCLUIDO',
      concluidoEm: REGISTRADA_EM,
      concluidoPor: 'u-sherad',
      conclusaoObs: 'Dúvida esclarecida. Orientada a pedir a progressão no RH.',
      conclusaoOrigem: 'CONSULTA',
      conclusaoConsultaId: 'c-13',
    });
    expect(r).toEqual({
      atendimentoId: 'a-13',
      numero: 13,
      auditoria: {
        acao: 'UPDATE',
        entidade: 'Atendimento',
        entidadeId: 'a-13',
        descricao: 'Atendimento #13: andamento de PENDENTE para CONCLUIDO, pela consulta',
        metadata: {
          alteracoes: [{ campo: 'status', label: 'Andamento', de: 'PENDENTE', para: 'CONCLUIDO' }],
          via: 'CONSULTA',
          compromissoId: 'c-13',
          desfecho: 'DUVIDA_ESCLARECIDA',
          nota: 'Dúvida esclarecida. Orientada a pedir a progressão no RH.',
        },
      },
    });
    expect(ORIGEM_DA_CONCLUSAO).toEqual({ TRIAGEM: 'TRIAGEM', CONSULTA: 'CONSULTA' });
  });

  it.each<[string, Partial<Banco>, string]>([
    ['a triagem já concluiu', { atendimentos: [{ ...ATENDIMENTO_13, status: 'CONCLUIDO', conclusaoOrigem: 'TRIAGEM' }] }, 'JA_FECHADO'],
    ['o atendimento foi cancelado', { atendimentos: [{ ...ATENDIMENTO_13, status: 'CANCELADO' }] }, 'JA_FECHADO'],
    ['resolvido no ato', { atendimentos: [{ ...ATENDIMENTO_13, desfecho: 'RESOLVIDO_ATO' }] }, 'SEM_ENCAMINHAMENTO'],
    ['sem desfecho', { atendimentos: [{ ...ATENDIMENTO_13, desfecho: null }] }, 'SEM_ENCAMINHAMENTO'],
    ['a cópia pendente do Dr. Murilo', { compromissos: [{ ...CONSULTA_13, id: 'c-copia', responsavelId: 'u-murilo' }] }, 'OUTRA_CONSULTA_ABERTA'],
    ['a cópia em andamento', { compromissos: [{ ...CONSULTA_13, id: 'c-copia', status: 'EM_ANDAMENTO' }] }, 'OUTRA_CONSULTA_ABERTA'],
  ])('não fecha quando %s: devolve o motivo, sem lançar e sem mexer em nada', async (_caso, mudanca, motivo) => {
    const inicial: Partial<Banco> = {
      compromissos: [clonar(CONSULTA_13), ...(mudanca.compromissos ?? [])],
      atendimentos: mudanca.atendimentos ?? [clonar(ATENDIMENTO_13)],
    };
    const m = montarBanco(inicial);
    const antes = clonar(m.estado.bd.atendimentos[0]);
    await expect(concluirAtendimentoPelaConsulta(m.prisma, PEDIDO)).resolves.toEqual({ naoFechou: motivo });
    expect(m.estado.bd.atendimentos[0]).toEqual(antes);
  });

  it.each<[string, Linha]>([
    ['cancelada', { id: 'c-velha', status: 'CANCELADO' }],
    ['já registrada', { id: 'c-velha', status: 'CONCLUIDO' }],
    ['seguimento aberto (herda o atendimento)', { id: 's-retorno', status: 'PENDENTE', origemDesfechoId: 'c-velha' }],
    ['de OUTRO atendimento', { id: 'c-alheia', status: 'PENDENTE', atendimentoId: 'a-12' }],
  ])('outra consulta %s não impede', async (_caso, outra) => {
    const m = montarBanco({ compromissos: [clonar(CONSULTA_13), { ...CONSULTA_13, ...outra }], atendimentos: [clonar(ATENDIMENTO_13)] });
    const r = await concluirAtendimentoPelaConsulta(m.prisma, PEDIDO);
    expect(r).toMatchObject({ atendimentoId: 'a-13', numero: 13 });
    expect(m.estado.bd.atendimentos[0].status).toBe('CONCLUIDO');
  });

  it('a própria consulta ainda aberta na leitura não se conta como "outra"', async () => {
    // Na agenda ela já está CONCLUIDO quando a regra roda; aqui fica PENDENTE de propósito.
    const m = montarBanco({ compromissos: [clonar(CONSULTA_13)], atendimentos: [clonar(ATENDIMENTO_13)] });
    expect(await concluirAtendimentoPelaConsulta(m.prisma, PEDIDO)).toMatchObject({ numero: 13 });
  });

  it.each<[string, typeof PEDIDO.consulta]>([
    ['atividade sem atendimento', { id: 'c-13', atendimentoId: null as never, origemDesfechoId: null }],
    ['seguimento que herdou o atendimento', { id: 's-13', atendimentoId: 'a-13', origemDesfechoId: 'c-13' as never }],
  ])('%s: nulo, sem ler nem gravar', async (_caso, consulta) => {
    const m = montarBanco({ compromissos: [clonar(CONSULTA_13)], atendimentos: [clonar(ATENDIMENTO_13)] });
    expect(await concluirAtendimentoPelaConsulta(m.prisma, { ...PEDIDO, consulta })).toBeNull();
    expect(m.passos).toEqual([]);
    expect(m.estado.bd.atendimentos[0].status).toBe('PENDENTE');
  });

  it('atendimento apagado entre a leitura e a gravação: nulo, sem lançar', async () => {
    const m = montarBanco({ compromissos: [clonar(CONSULTA_13)], atendimentos: [] });
    await expect(concluirAtendimentoPelaConsulta(m.prisma, PEDIDO)).resolves.toBeNull();
  });
});

describe('reabrirAtendimentoFechadoPelaConsulta — só com o carimbo', () => {
  const FECHADO: Linha = {
    ...ATENDIMENTO_13,
    status: 'CONCLUIDO', concluidoEm: REGISTRADA_EM, concluidoPor: 'u-sherad',
    conclusaoObs: 'Dúvida esclarecida.', conclusaoOrigem: 'CONSULTA', conclusaoConsultaId: 'c-13',
  };
  const PEDIDO_REABRIR = { compromissoId: 'c-13', atendimentoId: 'a-13', concluidoEm: REGISTRADA_EM };

  it('carimbo igual: volta ao que era antes da consulta, e a auditoria leva o fechamento', async () => {
    const m = montarBanco({ atendimentos: [clonar(FECHADO)] });
    const r = await reabrirAtendimentoFechadoPelaConsulta(m.prisma, PEDIDO_REABRIR);
    expect(m.estado.bd.atendimentos[0]).toEqual(ATENDIMENTO_13);
    expect(r).toEqual({
      atendimentoId: 'a-13',
      numero: 13,
      auditoria: {
        acao: 'UPDATE',
        entidade: 'Atendimento',
        entidadeId: 'a-13',
        descricao: 'Atendimento #13: andamento de CONCLUIDO para PENDENTE, a consulta voltou a ficar aberta',
        metadata: {
          alteracoes: [{ campo: 'status', label: 'Andamento', de: 'CONCLUIDO', para: 'PENDENTE' }],
          via: 'CONSULTA',
          compromissoId: 'c-13',
          fechamentoAnterior: { nota: 'Dúvida esclarecida.', em: REGISTRADA_EM.toISOString(), por: 'u-sherad', origem: 'CONSULTA' },
        },
      },
    });
  });

  it.each<[string, Linha]>([
    ['a triagem reabriu e concluiu de novo', { conclusaoOrigem: 'TRIAGEM', conclusaoConsultaId: null, concluidoEm: new Date('2026-09-14T13:30:00.000Z') }],
    ['fechado por outra consulta', { conclusaoConsultaId: 'c-outra' }],
    ['um milissegundo de diferença', { concluidoEm: new Date(REGISTRADA_EM.getTime() + 1) }],
    ['já reaberto', { status: 'PENDENTE' }],
    ['concluído antes de 15/09 (colunas nulas)', { conclusaoOrigem: null, conclusaoConsultaId: null }],
  ])('carimbo diferente (%s): nulo, e o atendimento fica como está', async (_caso, mudanca) => {
    const m = montarBanco({ atendimentos: [{ ...FECHADO, ...mudanca }] });
    const antes = clonar(m.estado.bd.atendimentos[0]);
    expect(await reabrirAtendimentoFechadoPelaConsulta(m.prisma, PEDIDO_REABRIR)).toBeNull();
    expect(m.estado.bd.atendimentos[0]).toEqual(antes);
    expect(m.passos).not.toContain('atendimento.updateMany');
  });

  it.each([
    ['sem atendimento de origem', { ...PEDIDO_REABRIR, atendimentoId: null }],
    ['sem instante de conclusão', { ...PEDIDO_REABRIR, concluidoEm: null }],
  ])('%s: nulo, sem ler', async (_caso, pedido) => {
    const m = montarBanco({ atendimentos: [clonar(FECHADO)] });
    expect(await reabrirAtendimentoFechadoPelaConsulta(m.prisma, pedido)).toBeNull();
    expect(m.estado.bd.atendimentos[0]).toEqual(FECHADO);
  });

  it('ida e volta: concluir e reabrir com o mesmo carimbo devolve o atendimento intacto', async () => {
    const m = montarBanco({ compromissos: [clonar(CONSULTA_13)], atendimentos: [clonar(ATENDIMENTO_13)] });
    await concluirAtendimentoPelaConsulta(m.prisma, PEDIDO);
    await reabrirAtendimentoFechadoPelaConsulta(m.prisma, PEDIDO_REABRIR);
    expect(m.estado.bd.atendimentos[0]).toEqual(ATENDIMENTO_13);
  });
});

/**
 * PELA AGENDA, DE PONTA A PONTA — o `AgendaService` de verdade sobre o mesmo
 * banco falso. É o caminho da gaveta, do painel e da folha de desfecho, que
 * usam a mesma rota.
 */
describe('a agenda fecha e devolve o atendimento', () => {
  const SHERAD = { userId: 'u-sherad', nome: 'Shérad Castro', ip: '10.0.0.9', userAgent: 'jest' };
  const JULIAN = { userId: 'u-julian', nome: 'Julian Helton' };
  const REGISTRO = { desfecho: 'DUVIDA_ESCLARECIDA', desfechoObs: 'Orientada a pedir a progressão no RH.' };

  function agenda(inicial: Partial<Banco>, ganchos: Ganchos = {}) {
    const m = montarBanco(inicial, ganchos);
    const audit = { registrar: jest.fn(async (_r: any) => undefined) };
    const servico = new AgendaService(m.prisma, audit as never, {} as never);
    const doAtendimento = () => audit.registrar.mock.calls.map((c) => c[0]).filter((x) => x.entidade === 'Atendimento');
    const historicoDe = (acao: string): any => m.estado.bd.historico.filter((h) => h.acao === acao).pop();
    return { ...m, servico, audit, doAtendimento, historicoDe };
  }

  it('a Dra. Shérad registra a consulta: o #13 fecha junto, na mesma transação, e a resposta avisa', async () => {
    const m = agenda({ compromissos: [clonar(CONSULTA_13)], atendimentos: [clonar(ATENDIMENTO_13)] });
    const r: any = await m.servico.concluir('c-13', REGISTRO as never, SHERAD);

    const consulta = m.estado.bd.compromissos[0];
    const at = m.estado.bd.atendimentos[0];
    expect(consulta.status).toBe('CONCLUIDO');
    expect(at).toMatchObject({
      status: 'CONCLUIDO', concluidoPor: 'u-sherad', conclusaoOrigem: 'CONSULTA', conclusaoConsultaId: 'c-13',
      conclusaoObs: 'Dúvida esclarecida. Orientada a pedir a progressão no RH.',
    });
    // O MESMO instante nas duas tabelas: é o carimbo que o desfazer confere.
    expect(at.concluidoEm.getTime()).toBe(consulta.concluidoEm.getTime());
    // A ordem das travas (15/09/2026): o atendimento é travado ANTES de a consulta ser gravada, como na triagem.
    const inicio = m.passos.indexOf('transacao:inicio');
    expect(m.passos.slice(inicio + 1, inicio + 4)).toEqual([
      'trava:atendimentos:a-13', 'compromisso.updateMany:c-13', 'atendimento.updateMany',
    ]);
    expect(m.passos.indexOf('atendimento.updateMany')).toBeLessThan(m.passos.indexOf('transacao:commit'));

    expect(r.atendimentoConcluido).toEqual({ id: 'a-13', numero: 13 });
    expect(m.historicoDe('CONCLUIDO').metadata.atendimento).toEqual({ fechado: true, id: 'a-13', numero: 13 });
    expect(m.doAtendimento()).toEqual([
      expect.objectContaining({ entidadeId: 'a-13', userId: 'u-sherad', ip: '10.0.0.9', descricao: 'Atendimento #13: andamento de PENDENTE para CONCLUIDO, pela consulta' }),
    ]);
  });

  it('quem conclui é quem fica no atendimento, mesmo sem ser o responsável (a Coordenação concluiu a do #4)', async () => {
    const m = agenda({ compromissos: [clonar(CONSULTA_13)], atendimentos: [clonar(ATENDIMENTO_13)] });
    await m.servico.concluir('c-13', REGISTRO as never, JULIAN);
    expect(m.estado.bd.atendimentos[0].concluidoPor).toBe('u-julian');
  });

  it('a triagem já tinha concluído: a consulta fecha assim mesmo, e o motivo fica carimbado', async () => {
    const jaFechado = { ...ATENDIMENTO_13, status: 'CONCLUIDO', conclusaoOrigem: 'TRIAGEM', concluidoPor: 'u-julian' };
    const m = agenda({ compromissos: [clonar(CONSULTA_13)], atendimentos: [clonar(jaFechado)] });
    const r: any = await m.servico.concluir('c-13', REGISTRO as never, SHERAD);
    expect(m.estado.bd.compromissos[0].status).toBe('CONCLUIDO');
    expect(m.estado.bd.atendimentos[0]).toEqual(jaFechado);
    expect(r.atendimentoConcluido).toBeNull();
    expect(m.historicoDe('CONCLUIDO').metadata.atendimento).toEqual({ fechado: false, motivo: 'JA_FECHADO' });
    expect(m.doAtendimento()).toEqual([]);
  });

  it('a triagem cancelou a consulta no mesmo instante: "abra de novo", e o atendimento não é tocado', async () => {
    const m = agenda(
      { compromissos: [clonar(CONSULTA_13)], atendimentos: [clonar(ATENDIMENTO_13)] },
      { antesDaTransacao: (bd) => { bd.compromissos[0].status = 'CANCELADO'; } },
    );
    await expect(m.servico.concluir('c-13', REGISTRO as never, SHERAD))
      .rejects.toThrow('Esta atividade acabou de ser mudada por outra pessoa. Abra de novo para ver como ficou.');
    expect(m.passos).not.toContain('atendimento.updateMany');
    expect(m.estado.bd.atendimentos[0]).toEqual(ATENDIMENTO_13);
    expect(m.historicoDe('CONCLUIDO')).toBeUndefined();
  });

  it('o seguimento que herdou o atendimento não o fecha', async () => {
    const retorno = { ...CONSULTA_13, id: 's-13', tipo: 'CONSULTA_JURIDICA', origemDesfechoId: 'c-13' };
    const m = agenda({ compromissos: [clonar(retorno)], atendimentos: [clonar(ATENDIMENTO_13)] });
    const r: any = await m.servico.concluir('s-13', REGISTRO as never, SHERAD);
    expect(m.estado.bd.atendimentos[0]).toEqual(ATENDIMENTO_13);
    expect(r.atendimentoConcluido).toBeNull();
    expect(m.historicoDe('CONCLUIDO').metadata.atendimento).toBeNull();
  });

  it('desfazer no toast: a consulta volta e o #13 volta a aguardar a consulta', async () => {
    const m = agenda({ compromissos: [clonar(CONSULTA_13)], atendimentos: [clonar(ATENDIMENTO_13)] });
    await m.servico.concluir('c-13', REGISTRO as never, SHERAD);
    const r: any = await m.servico.desfazerConclusao('c-13', SHERAD);

    expect(m.estado.bd.compromissos[0].status).toBe('PENDENTE');
    expect(m.estado.bd.atendimentos[0]).toEqual(ATENDIMENTO_13);
    expect(r.atendimentoReaberto).toEqual({ id: 'a-13', numero: 13 });
    expect(m.doAtendimento().map((a) => a.descricao)).toEqual([
      'Atendimento #13: andamento de PENDENTE para CONCLUIDO, pela consulta',
      'Atendimento #13: andamento de CONCLUIDO para PENDENTE, a consulta voltou a ficar aberta',
    ]);
  });

  it('reabrir a consulta pela gaveta devolve o atendimento; reabrir depois que a triagem fechou de novo, não', async () => {
    const m = agenda({ compromissos: [clonar(CONSULTA_13)], atendimentos: [clonar(ATENDIMENTO_13)] });
    await m.servico.concluir('c-13', REGISTRO as never, SHERAD);
    const r: any = await m.servico.mudarStatus('c-13', { status: 'PENDENTE' } as never, JULIAN);
    expect(r.atendimentoReaberto).toEqual({ id: 'a-13', numero: 13 });
    expect(m.estado.bd.atendimentos[0]).toEqual(ATENDIMENTO_13);

    // De novo: a advogada registra, a triagem reabre o atendimento e o conclui ela mesma.
    await m.servico.concluir('c-13', REGISTRO as never, SHERAD);
    Object.assign(m.estado.bd.atendimentos[0], {
      conclusaoOrigem: 'TRIAGEM', conclusaoConsultaId: null, concluidoPor: 'u-julian', concluidoEm: new Date(),
    });
    const depois = clonar(m.estado.bd.atendimentos[0]);
    const r2: any = await m.servico.mudarStatus('c-13', { status: 'PENDENTE' } as never, JULIAN);
    expect(r2.atendimentoReaberto).toBeNull();
    expect(m.estado.bd.compromissos[0].status).toBe('PENDENTE');
    expect(m.estado.bd.atendimentos[0]).toEqual(depois);
  });

  it('iniciar a consulta não mexe no atendimento e não responde com atendimento reaberto', async () => {
    const m = agenda({ compromissos: [clonar(CONSULTA_13)], atendimentos: [clonar(ATENDIMENTO_13)] });
    const r: any = await m.servico.mudarStatus('c-13', { status: 'EM_ANDAMENTO' } as never, SHERAD);
    expect(m.estado.bd.compromissos[0].status).toBe('EM_ANDAMENTO');
    expect(r.atendimentoReaberto).toBeNull();
    expect(m.passos).not.toContain('atendimento.updateMany');
  });

  /*
    A ORDEM DAS TRAVAS NOS OUTROS DOIS CAMINHOS (15/09/2026). Desfazer e reabrir
    também devolvem o atendimento: a primeira coisa da transação é travar a
    linha dele, e só depois a consulta é tocada.
  */
  it('desfazer e reabrir travam o atendimento antes de tocar a consulta', async () => {
    const primeirosPassosDaUltimaTransacao = (passos: string[]) => {
      const inicio = passos.lastIndexOf('transacao:inicio');
      return passos.slice(inicio + 1, inicio + 3);
    };
    const m = agenda({ compromissos: [clonar(CONSULTA_13)], atendimentos: [clonar(ATENDIMENTO_13)] });
    await m.servico.concluir('c-13', REGISTRO as never, SHERAD);
    await m.servico.desfazerConclusao('c-13', SHERAD);
    expect(primeirosPassosDaUltimaTransacao(m.passos)).toEqual(['trava:atendimentos:a-13', 'compromisso.updateMany:c-13']);

    await m.servico.concluir('c-13', REGISTRO as never, SHERAD);
    await m.servico.mudarStatus('c-13', { status: 'PENDENTE' } as never, JULIAN);
    expect(primeirosPassosDaUltimaTransacao(m.passos)).toEqual(['trava:atendimentos:a-13', 'compromisso.updateMany:c-13']);
  });

  it('consulta sem atendimento de origem não trava linha nenhuma', async () => {
    const avulsa = { ...CONSULTA_13, atendimentoId: null };
    const m = agenda({ compromissos: [clonar(avulsa)], atendimentos: [] });
    await m.servico.concluir('c-13', REGISTRO as never, SHERAD);
    expect(m.passos.filter((p) => p.startsWith('trava:') || p.startsWith('sql:'))).toEqual([]);
  });

  /*
    O DEADLOCK QUE SOBRAR VIRA FRASE, NÃO 500 (15/09/2026). A triagem e a
    advogada no mesmo instante: o Postgres aborta uma das duas na espera pela
    linha (numa consulta crua, o Prisma devolve P2010 com o 40P01). Quem perde
    ouve "abra de novo", e o banco desfez tudo.
  */
  it('o banco aborta a conclusão por deadlock: a advogada ouve a frase de corrida, e nada fica gravado', async () => {
    const m = agenda(
      { compromissos: [clonar(CONSULTA_13)], atendimentos: [clonar(ATENDIMENTO_13)] },
      { naTrava: () => { throw corrida('P2010', '40P01'); } },
    );
    const erro = await m.servico.concluir('c-13', REGISTRO as never, SHERAD).catch((e) => e);
    expect(erro).toBeInstanceOf(BadRequestException);
    expect(erro.message).toBe('Esta atividade acabou de ser mudada por outra pessoa. Abra de novo para ver como ficou.');
    expect(m.passos).toContain('transacao:desfeita');
    expect(m.estado.bd.compromissos[0]).toEqual(CONSULTA_13);
    expect(m.estado.bd.atendimentos[0]).toEqual(ATENDIMENTO_13);
    expect(m.historicoDe('CONCLUIDO')).toBeUndefined();
    expect(m.audit.registrar).not.toHaveBeenCalled();
  });

  it('a auditoria do atendimento que falha depois do commit não vira erro na tela do advogado', async () => {
    const m = agenda({ compromissos: [clonar(CONSULTA_13)], atendimentos: [clonar(ATENDIMENTO_13)] });
    m.audit.registrar.mockImplementation(async (r: any) => {
      if (r.entidade === 'Atendimento') throw new Error('banco de auditoria fora');
    });
    const r: any = await m.servico.concluir('c-13', REGISTRO as never, SHERAD);
    expect(r.atendimentoConcluido).toEqual({ id: 'a-13', numero: 13 });
    expect(m.estado.bd.atendimentos[0].status).toBe('CONCLUIDO');
  });
});
