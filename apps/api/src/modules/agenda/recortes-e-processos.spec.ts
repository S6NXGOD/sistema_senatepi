import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { StatusCompromisso, UserRole } from '@prisma/client';
import { AgendaService, leitorVeProcessos, type Leitor } from './agenda.service';
import { daPessoa, ondeSouReserva } from './equipe.util';
import {
  DIGITOS_MINIMOS_PARA_NPU,
  RECORTES,
  TIPOS_COM_HORA,
  ehRecorte,
  filtroDaBusca,
  limitesDoDia,
  whereDoRecorte,
  type Recorte,
} from './recortes.util';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * OS RECORTES DA AGENDA, PROVADOS COM LINHAS — não com o texto do `where`.
 *
 * O avaliador abaixo aplica o filtro do Prisma a uma lista em memória com a
 * mesma semântica do banco para os campos que os recortes usam. Se um recorte
 * usar um campo que ele não conhece, o teste QUEBRA (não passa em silêncio).
 *
 * As horas 23h30 e 00h30 de Teresina são as que o fuso do contêiner erra: às
 * 23h30 daqui, o dia UTC já é o seguinte.
 */
const br = (local: string) => new Date(`${local}-03:00`);

interface Linha {
  id: string;
  status: StatusCompromisso;
  inicio: Date;
}

/*
  O AVALIADOR APRENDEU `id` E O INSTANTE EXATO em 14/09/2026: o cursor da
  página seguinte compara (início, id), e `inicio: <Date>` é igualdade. Os dois
  entram com a semântica do banco; campo desconhecido continua quebrando.
*/
function casa(l: Linha, w: Record<string, any>): boolean {
  return Object.entries(w).every(([campo, cond]) => {
    if (campo === 'AND') return (Array.isArray(cond) ? cond : [cond]).every((x) => casa(l, x));
    if (campo === 'OR') return (cond as any[]).some((x) => casa(l, x));
    if (campo === 'status') return typeof cond === 'string' ? l.status === cond : cond.in.includes(l.status);
    if (campo === 'id') {
      if (typeof cond === 'string') return l.id === cond;
      return (!cond.gt || l.id > cond.gt) && (!cond.lt || l.id < cond.lt);
    }
    if (campo === 'inicio' && cond instanceof Date) return l.inicio.getTime() === cond.getTime();
    if (campo === 'inicio') {
      return (
        (!cond.lt || l.inicio < cond.lt) &&
        (!cond.lte || l.inicio <= cond.lte) &&
        (!cond.gt || l.inicio > cond.gt) &&
        (!cond.gte || l.inicio >= cond.gte)
      );
    }
    throw new Error(`O avaliador do teste não conhece o campo "${campo}".`);
  });
}

const { PENDENTE, EM_ANDAMENTO, CONCLUIDO, CANCELADO } = StatusCompromisso;

const ACERVO: Linha[] = [
  { id: 'a-ontem-aberta', status: PENDENTE, inicio: br('2026-09-12T10:00:00') },
  { id: 'b-hoje-22h', status: PENDENTE, inicio: br('2026-09-13T22:00:00') },
  { id: 'c-hoje-concluida', status: CONCLUIDO, inicio: br('2026-09-13T09:00:00') },
  { id: 'd-ontem-concluida', status: CONCLUIDO, inicio: br('2026-09-12T09:00:00') },
  { id: 'e-dia-20', status: PENDENTE, inicio: br('2026-09-20T09:00:00') },
  { id: 'f-dia-21', status: PENDENTE, inicio: br('2026-09-21T09:00:00') },
  { id: 'g-dia-15-cancelada', status: CANCELADO, inicio: br('2026-09-15T09:00:00') },
  { id: 'h-julho-concluida', status: CONCLUIDO, inicio: br('2026-07-01T09:00:00') },
  { id: 'i-junho-aberta', status: PENDENTE, inicio: br('2026-06-01T09:00:00') },
  { id: 'j-hoje-23h45', status: EM_ANDAMENTO, inicio: br('2026-09-13T23:45:00') },
];

const NOITE = br('2026-09-13T23:30:00');
const MADRUGADA = br('2026-09-14T00:30:00');

const noRecorte = (recorte: Recorte, agora: Date) =>
  ACERVO.filter((l) => casa(l, whereDoRecorte(recorte, agora))).map((l) => l.id).sort();

describe('o dia é o de Teresina', () => {
  it('às 23h30 daqui ainda é 13/09, embora o UTC já esteja no 14', () => {
    expect(NOITE.toISOString()).toBe('2026-09-14T02:30:00.000Z');
    const { hojeIni, hojeFim, fimDosSeteDias, inicioDeTodos } = limitesDoDia(NOITE);
    expect(hojeIni).toEqual(br('2026-09-13T00:00:00'));
    expect(hojeFim).toEqual(br('2026-09-14T00:00:00'));
    expect(fimDosSeteDias).toEqual(br('2026-09-21T00:00:00'));
    expect(inicioDeTodos).toEqual(br('2026-07-15T00:00:00'));
  });

  it('às 00h30 o dia virou', () => {
    expect(limitesDoDia(MADRUGADA).hojeIni).toEqual(br('2026-09-14T00:00:00'));
  });
});

describe('cada aba às 23h30', () => {
  it.each<[Recorte, string[]]>([
    ['hoje', ['a-ontem-aberta', 'b-hoje-22h', 'c-hoje-concluida', 'i-junho-aberta', 'j-hoje-23h45']],
    ['atrasadas', ['a-ontem-aberta', 'i-junho-aberta']],
    ['atencao', ['a-ontem-aberta', 'b-hoje-22h', 'i-junho-aberta']],
    ['7dias', ['a-ontem-aberta', 'b-hoje-22h', 'c-hoje-concluida', 'e-dia-20', 'g-dia-15-cancelada', 'i-junho-aberta', 'j-hoje-23h45']],
    ['aberto', ['a-ontem-aberta', 'b-hoje-22h', 'e-dia-20', 'f-dia-21', 'i-junho-aberta', 'j-hoje-23h45']],
    ['todos', ['a-ontem-aberta', 'b-hoje-22h', 'c-hoje-concluida', 'd-ontem-concluida', 'e-dia-20', 'f-dia-21', 'g-dia-15-cancelada', 'i-junho-aberta', 'j-hoje-23h45']],
  ])('%s', (recorte, esperado) => {
    expect(noRecorte(recorte, NOITE)).toEqual([...esperado].sort());
  });
});

describe('e às 00h30, com o dia virado', () => {
  /** A de 22h e a de 23h45 ficaram para trás; a concluída de ontem saiu de "Hoje". */
  it('hoje traz o que ficou para trás e solta a concluída de ontem', () => {
    expect(noRecorte('hoje', MADRUGADA)).toEqual(['a-ontem-aberta', 'b-hoje-22h', 'i-junho-aberta', 'j-hoje-23h45']);
  });

  it('atrasadas e atenção passam a incluir as de ontem à noite', () => {
    expect(noRecorte('atrasadas', MADRUGADA)).toEqual(['a-ontem-aberta', 'b-hoje-22h', 'i-junho-aberta', 'j-hoje-23h45']);
    expect(noRecorte('atencao', MADRUGADA)).toEqual(noRecorte('atrasadas', MADRUGADA));
  });
});

describe('o vocabulário', () => {
  it('as seis abas do contrato, e só elas', () => {
    expect([...RECORTES]).toEqual(['hoje', 'atrasadas', 'atencao', '7dias', 'aberto', 'todos']);
    expect(ehRecorte('7dias')).toBe(true);
    expect(ehRecorte('urgentes')).toBe(false);
  });

  it('os tipos com hora marcada (D7)', () => {
    expect([...TIPOS_COM_HORA].sort()).toEqual(['AUDIENCIA', 'CONSULTA_JURIDICA', 'PERICIA', 'REUNIAO']);
  });
});

describe('a busca acha o caso do jeito que o advogado lembra', () => {
  const doOr = (w: any) => w.OR as any[];

  it('parte contrária pelo nome', () => {
    const ou = doOr(filtroDaBusca('Prefeitura de Picos'));
    expect(ou).toContainEqual({
      processo: { partes: { some: { nome: { contains: 'Prefeitura de Picos', mode: 'insensitive' } } } },
    });
    // Sem dígitos, o NPU não entra.
    expect(JSON.stringify(ou)).not.toContain('numeroCNJ');
  });

  it('NPU colado com pontuação vira só dígitos', () => {
    const ou = doOr(filtroDaBusca('0801234-56.2024.5.22.0001'));
    expect(ou).toContainEqual({ processo: { numeroCNJ: { contains: '08012345620245220001' } } });
  });

  it(`número curto (menos de ${DIGITOS_MINIMOS_PARA_NPU} dígitos) não procura NPU`, () => {
    expect(JSON.stringify(filtroDaBusca('Prazo 15'))).not.toContain('numeroCNJ');
  });

  it('quem não vê Processos busca só por título e filiado', () => {
    const ou = doOr(filtroDaBusca('0801234-56.2024 Prefeitura', { processos: false }));
    expect(ou).toHaveLength(2);
    expect(JSON.stringify(ou)).not.toMatch(/partes|numeroCNJ/);
  });
});

/* ------------------------------------------------------------------------ */
/* O serviço, com prisma falso                                              */
/* ------------------------------------------------------------------------ */

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
        return new Proxy({}, { get: (_m, metodo) => (typeof metodo === 'string' ? fn(modelo, metodo) : undefined) });
      },
    },
  );
  return { prisma, fn };
}

const TRIAGEM: Leitor = { id: 'tri1', role: UserRole.TRIAGEM, permissoes: null };
const ADVOGADO: Leitor = { id: 'adv1', role: UserRole.ADVOGADO, permissoes: null };

function montar(impl: Parameters<typeof prismaFalso>[0] = {}) {
  const { prisma, fn } = prismaFalso(impl);
  const servico = new AgendaService(prisma as never, { registrar: jest.fn() } as never, {} as never);
  return { servico, fn };
}

describe('quem não vê Processos não recebe dado de processo pela agenda', () => {
  it('a régua é a matriz: Triagem no preset não vê; com Processos na matriz própria, vê', () => {
    expect(leitorVeProcessos(TRIAGEM)).toBe(false);
    expect(leitorVeProcessos(ADVOGADO)).toBe(true);
    expect(leitorVeProcessos({ ...TRIAGEM, permissoes: { processos: 'VISUALIZAR' } })).toBe(true);
    // Chamada interna, sem leitor: como sempre foi.
    expect(leitorVeProcessos(undefined)).toBe(true);
  });

  it('a lista da Triagem vem sem as partes; a do advogado, com', async () => {
    const t = montar();
    await t.servico.listar({}, TRIAGEM);
    const selTriagem = t.fn('compromisso', 'findMany').mock.calls[0][0].select;
    expect(selTriagem.processo.select.numeroCNJ).toBe(true);
    expect(selTriagem.processo.select).not.toHaveProperty('partes');

    const a = montar();
    await a.servico.listar({}, ADVOGADO);
    expect(a.fn('compromisso', 'findMany').mock.calls[0][0].select.processo.select).toHaveProperty('partes');
  });

  it('a busca da Triagem não procura por parte nem NPU', async () => {
    const t = montar();
    await t.servico.listar({ busca: 'Prefeitura 0801234-56.2024' }, TRIAGEM);
    expect(JSON.stringify(t.fn('compromisso', 'findMany').mock.calls[0][0].where)).not.toMatch(/partes|numeroCNJ/);
  });

  it('o detalhe da Triagem vem sem o teor das publicações e sem as partes, mas com a triagem de origem', async () => {
    const achado = { findUnique: () => ({ id: 'c1', status: CONCLUIDO, responsavelId: 'u1', criador: null }) };

    const t = montar({ compromisso: achado });
    await t.servico.detalhe('c1', TRIAGEM);
    const incTriagem = t.fn('compromisso', 'findUnique').mock.calls[0][0].include;
    expect(incTriagem).not.toHaveProperty('origemComunicacoes');
    expect(incTriagem.processo.select).not.toHaveProperty('partes');
    expect(incTriagem.processo.select.numeroCNJ).toBe(true);
    expect(incTriagem.atendimento.select).toEqual(
      expect.objectContaining({ descricao: true, assunto: true, assuntoOutro: true }),
    );

    const a = montar({ compromisso: achado });
    await a.servico.detalhe('c1', ADVOGADO);
    const incAdv = a.fn('compromisso', 'findUnique').mock.calls[0][0].include;
    expect(incAdv).toHaveProperty('origemComunicacoes');
    expect(incAdv.processo.select).toHaveProperty('partes');
  });
});

describe('listagem: a aba e a pessoa resolvidas no servidor', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
    jest.setSystemTime(NOITE);
  });
  afterEach(() => jest.useRealTimers());

  const filtrosDe = async (q: Record<string, string>, leitor: Leitor = ADVOGADO) => {
    const m = montar();
    await m.servico.listar(q as never, leitor);
    return m.fn('compromisso', 'findMany').mock.calls[0][0].where.AND as any[];
  };

  it('a aba entra pela mesma função que conta', async () => {
    const and = await filtrosDe({ recorte: 'atencao' });
    expect(and).toContainEqual(whereDoRecorte('atencao', NOITE));
  });

  it('"pessoa=eu" é a régua daPessoa de quem pede — sem a reserva do robô', async () => {
    expect(await filtrosDe({ pessoa: 'eu' })).toContainEqual(daPessoa('adv1'));
    expect(await filtrosDe({ pessoa: 'u9' })).toContainEqual(daPessoa('u9'));
  });

  it('"reservaDe=eu" é ondeSouReserva', async () => {
    expect(await filtrosDe({ reservaDe: 'eu' })).toContainEqual(ondeSouReserva('adv1'));
  });

  it('"eu" sem usuário não vira a agenda inteira', async () => {
    const m = montar();
    await m.servico.listar({ pessoa: 'eu' } as never, undefined);
    const and = m.fn('compromisso', 'findMany').mock.calls[0][0].where.AND as any[];
    expect(and).toHaveLength(1);
    expect(JSON.stringify(and)).not.toContain('"eu"');
  });

  /** "Esperando por: Fulano 4" conta por responsável — o link abre o mesmo conjunto. */
  it('somenteResponsavel corta a equipe', async () => {
    const so = await filtrosDe({ responsaveis: 'u1,u2', somenteResponsavel: '1' });
    expect(so).toContainEqual({ responsavelId: { in: ['u1', 'u2'] } });
    expect(JSON.stringify(so)).not.toContain('equipe');

    // Sem o flag, o comportamento de sempre: responsável OU equipe.
    const ambos = await filtrosDe({ responsaveis: 'u1,u2' });
    expect(JSON.stringify(ambos)).toContain('equipe');
  });
});

describe('contadores das abas: um count() por aba, com os filtros da lista', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
    jest.setSystemTime(NOITE);
  });
  afterEach(() => jest.useRealTimers());

  it('cada número sai do mesmo recorte que a lista daquela aba aplica', async () => {
    let n = 0;
    const m = montar({ compromisso: { count: () => ++n } });
    const q = { tipo: 'PRAZO', pessoa: 'eu', recorte: 'hoje' } as never;
    const contagem = await m.servico.contarRecortes(q, ADVOGADO);

    // As duas metades de Todas entraram em 14/09/2026 (D20 da rodada 3): 9 números.
    expect(contagem).toEqual({
      hoje: 1, atrasadas: 2, atencao: 3, seteDias: 4, aberto: 5, todos: 6, urgentes: 7,
      todosAdiante: 8, todosAnteriores: 9,
    });

    const wheres = m.fn('compromisso', 'count').mock.calls.map((c) => c[0].where.AND as any[]);
    expect(wheres).toHaveLength(9);
    // A aba pedida na query não contamina as outras: base (tipo + pessoa) + o recorte de cada uma
    // (+ a janela, nas duas metades de Todas).
    for (const [i, and] of wheres.entries()) {
      expect(and).toHaveLength(i < 7 ? 3 : 4);
      expect(and[0]).toEqual({ tipo: 'PRAZO' });
      expect(and[1]).toEqual(daPessoa('adv1'));
    }

    const abas: [number, Record<string, string>][] = [
      [0, { recorte: 'hoje' }],
      [1, { recorte: 'atrasadas' }],
      [2, { recorte: 'atencao' }],
      [3, { recorte: '7dias' }],
      [4, { recorte: 'aberto' }],
      [5, { recorte: 'todos' }],
      [7, { recorte: 'todos', janela: 'adiante' }],
      [8, { recorte: 'todos', janela: 'anteriores' }],
    ];
    for (const [i, aba] of abas) {
      const lista = montar();
      await lista.servico.listar({ tipo: 'PRAZO', pessoa: 'eu', ...aba } as never, ADVOGADO);
      const daLista = lista.fn('compromisso', 'findMany').mock.calls[0][0].where.AND as any[];
      expect(wheres[i]).toEqual(daLista);
    }
  });
});

describe('a rota dos contadores não vira um id', () => {
  it('@Get("recortes") vem antes de @Get(":id")', () => {
    const controller = readFileSync(join(__dirname, 'agenda.controller.ts'), 'utf8');
    const iRecortes = controller.search(/^\s*@Get\('recortes'\)/m);
    const iPorId = controller.search(/^\s*@Get\(':id'\)/m);
    expect(iRecortes).toBeGreaterThan(0);
    expect(iRecortes).toBeLessThan(iPorId);
  });
});
