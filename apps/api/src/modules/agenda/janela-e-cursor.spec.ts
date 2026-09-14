import { BadRequestException } from '@nestjs/common';
import { StatusCompromisso, UserRole } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AgendaService, type Leitor } from './agenda.service';
import { ListCompromissosQueryDto } from './dto/agenda.dto';
import {
  LIMITE_SEM_PAGINA,
  cursorDe,
  lerCursor,
  ordemDaListagem,
  whereDaJanela,
  whereDoRecorte,
  type Janela,
} from './recortes.util';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * PRÓXIMAS | ANTERIORES E "CARREGAR MAIS", PROVADOS COM LINHAS (14/09/2026).
 *
 * A aba Todas abria 60 dias atrás e o hoje ficava no meio da lista. A lista por
 * dia do celular divide Todas pela direção do tempo e pagina por cursor
 * (início, id). O que estes testes travam:
 *  · as duas metades repartem Todas — nada some, nada aparece duas vezes;
 *  · a página seguinte continua exatamente depois da anterior, inclusive no
 *    meio de um empate de horário (o robô grava muitas às 9h em ponto);
 *  · o contador de cada metade conta o mesmo conjunto que a lista mostra.
 *
 * O banco falso aplica `where`, `orderBy` e `take` como o Postgres. Campo que
 * ele não conhece QUEBRA o teste, em vez de passar em silêncio.
 */
const br = (local: string) => new Date(`${local}-03:00`);
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const { PENDENTE, EM_ANDAMENTO, CONCLUIDO, CANCELADO } = StatusCompromisso;

interface Linha {
  id: string;
  nome: string;
  status: StatusCompromisso;
  inicio: Date;
}

/** Segunda-feira, 14/09/2026, 10h de Teresina. */
const AGORA = br('2026-09-14T10:00:00');

const linha = (n: number, nome: string, status: StatusCompromisso, local: string): Linha => ({
  id: uuid(n),
  nome,
  status,
  inicio: br(local),
});

/*
  Os ids NÃO seguem a ordem do horário de propósito: num empate, quem decide é
  o id, e um acervo em que os dois coincidissem não provaria o desempate.
*/
const ACERVO: Linha[] = [
  linha(9, 'ontem-9h-aberta', PENDENTE, '2026-09-13T09:00:00'),
  linha(2, 'ontem-9h-concluida', CONCLUIDO, '2026-09-13T09:00:00'),
  linha(5, 'ontem-9h-cancelada', CANCELADO, '2026-09-13T09:00:00'),
  linha(7, 'ontem-23h50-concluida', CONCLUIDO, '2026-09-13T23:50:00'),
  linha(1, 'hoje-00h10-concluida', CONCLUIDO, '2026-09-14T00:10:00'),
  linha(12, 'hoje-7h30-em-andamento', EM_ANDAMENTO, '2026-09-14T07:30:00'),
  linha(8, 'hoje-9h-a', PENDENTE, '2026-09-14T09:00:00'),
  linha(3, 'hoje-9h-b', PENDENTE, '2026-09-14T09:00:00'),
  linha(11, 'hoje-9h-c', PENDENTE, '2026-09-14T09:00:00'),
  linha(4, 'amanha-9h', PENDENTE, '2026-09-15T09:00:00'),
  linha(6, 'sexta-11-15h-concluida', CONCLUIDO, '2026-09-11T15:00:00'),
  linha(10, 'agosto-20-cancelada', CANCELADO, '2026-08-20T10:00:00'),
  linha(13, 'julho-1-aberta', PENDENTE, '2026-07-01T09:00:00'),
  linha(14, 'julho-1-concluida', CONCLUIDO, '2026-07-01T09:00:00'),
];

function casa(l: Linha, w: Record<string, any>): boolean {
  return Object.entries(w).every(([campo, cond]) => {
    if (campo === 'AND') return (Array.isArray(cond) ? cond : [cond]).every((x) => casa(l, x));
    if (campo === 'OR') return (cond as any[]).some((x) => casa(l, x));
    if (campo === 'status') return typeof cond === 'string' ? l.status === cond : cond.in.includes(l.status);
    // O contador de urgentes roda junto: nenhuma linha deste acervo é urgente.
    if (campo === 'urgente') return cond === false;
    if (campo === 'id') {
      if (typeof cond === 'string') return l.id === cond;
      return (!cond.gt || l.id > cond.gt) && (!cond.lt || l.id < cond.lt);
    }
    if (campo === 'inicio') {
      if (cond instanceof Date) return l.inicio.getTime() === cond.getTime();
      return (
        (!cond.lt || l.inicio < cond.lt) &&
        (!cond.lte || l.inicio <= cond.lte) &&
        (!cond.gt || l.inicio > cond.gt) &&
        (!cond.gte || l.inicio >= cond.gte)
      );
    }
    throw new Error(`O banco falso não conhece o campo "${campo}".`);
  });
}

function ordenar(linhas: Linha[], orderBy: Record<string, 'asc' | 'desc'>[]): Linha[] {
  return [...linhas].sort((a, b) => {
    for (const regra of orderBy) {
      const [campo, sentido] = Object.entries(regra)[0];
      const va = campo === 'inicio' ? a.inicio.getTime() : (a as any)[campo];
      const vb = campo === 'inicio' ? b.inicio.getTime() : (b as any)[campo];
      if (va === vb) continue;
      const menor = va < vb ? -1 : 1;
      return sentido === 'asc' ? menor : -menor;
    }
    return 0;
  });
}

function montar() {
  const findMany = jest.fn(async (args: any) => {
    const achadas = ACERVO.filter((l) => casa(l, args.where));
    return ordenar(achadas, args.orderBy).slice(0, args.take);
  });
  const count = jest.fn(async (args: any) => ACERVO.filter((l) => casa(l, args.where)).length);
  const prisma: any = { compromisso: { findMany, count } };
  const servico = new AgendaService(prisma as never, { registrar: jest.fn() } as never, {} as never);
  return { servico, findMany, count };
}

const ADVOGADO: Leitor = { id: 'adv1', role: UserRole.ADVOGADO, permissoes: null };

const nomes = (linhas: Linha[]) => linhas.map((l) => l.nome);

/** Anda página a página, como o "Carregar mais" do web, até a página vir menor que o limite. */
async function todasAsPaginas(janela: Janela, limite: number) {
  const { servico } = montar();
  const paginas: string[][] = [];
  let cursor: string | undefined;
  for (let volta = 0; volta < 50; volta++) {
    const pagina = (await servico.listar(
      { recorte: 'todos', janela, limite, cursor } as never,
      ADVOGADO,
    )) as unknown as Linha[];
    paginas.push(nomes(pagina));
    if (pagina.length < limite) return paginas;
    cursor = cursorDe(pagina[pagina.length - 1]);
  }
  throw new Error('A paginação não terminou: o cursor não avança.');
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
  jest.setSystemTime(AGORA);
});
afterEach(() => jest.useRealTimers());

describe('as duas metades repartem o tempo', () => {
  const em = (w: Record<string, any>) => ACERVO.filter((l) => casa(l, w)).map((l) => l.nome).sort();

  it('Próximas: de hoje em diante, mais toda aberta de dia anterior', () => {
    expect(em(whereDaJanela('adiante', AGORA))).toEqual(
      [
        'ontem-9h-aberta',
        'hoje-00h10-concluida',
        'hoje-7h30-em-andamento',
        'hoje-9h-a',
        'hoje-9h-b',
        'hoje-9h-c',
        'amanha-9h',
        'julho-1-aberta',
      ].sort(),
    );
  });

  /** 23h50 de ontem em Teresina já é 14/09 no UTC — e continua sendo ontem. */
  it('Anteriores: só fechada de dia anterior, com o dia de Teresina', () => {
    expect(em(whereDaJanela('anteriores', AGORA))).toEqual(
      [
        'ontem-9h-concluida',
        'ontem-9h-cancelada',
        'ontem-23h50-concluida',
        'sexta-11-15h-concluida',
        'agosto-20-cancelada',
        'julho-1-concluida',
      ].sort(),
    );
  });

  it('juntas cobrem o acervo inteiro, sem repetir ninguém', () => {
    const adiante = em(whereDaJanela('adiante', AGORA));
    const anteriores = em(whereDaJanela('anteriores', AGORA));
    expect(adiante.filter((n) => anteriores.includes(n))).toEqual([]);
    expect([...adiante, ...anteriores].sort()).toEqual(nomes(ACERVO).sort());
  });

  it('dentro de Todas, Próximas + Anteriores = Todas (a concluída de julho fica fora das três)', () => {
    const todos = whereDoRecorte('todos', AGORA);
    const adiante = em({ AND: [todos, whereDaJanela('adiante', AGORA)] });
    const anteriores = em({ AND: [todos, whereDaJanela('anteriores', AGORA)] });
    expect([...adiante, ...anteriores].sort()).toEqual(em(todos));
    expect(em(todos)).not.toContain('julho-1-concluida');
    expect(anteriores).not.toContain('julho-1-concluida');
  });
});

describe('a ordem de cada metade', () => {
  it('Próximas é crescente, e o empate das 9h sai pelo id', async () => {
    const { servico } = montar();
    const lista = (await servico.listar({ recorte: 'todos', janela: 'adiante' } as never, ADVOGADO)) as unknown as Linha[];
    expect(nomes(lista)).toEqual([
      'julho-1-aberta',
      'ontem-9h-aberta',
      'hoje-00h10-concluida',
      'hoje-7h30-em-andamento',
      'hoje-9h-b', // id 3
      'hoje-9h-a', // id 8
      'hoje-9h-c', // id 11
      'amanha-9h',
    ]);
  });

  it('Anteriores é decrescente — "Ontem" primeiro —, e o empate também inverte', async () => {
    const { servico } = montar();
    const lista = (await servico.listar({ recorte: 'todos', janela: 'anteriores' } as never, ADVOGADO)) as unknown as Linha[];
    expect(nomes(lista)).toEqual([
      'ontem-23h50-concluida',
      'ontem-9h-cancelada', // id 5
      'ontem-9h-concluida', // id 2
      'sexta-11-15h-concluida',
      'agosto-20-cancelada',
    ]);
  });

  it('sem janela, a listagem de sempre: crescente, até 500, agora com o id no desempate', async () => {
    const { servico, findMany } = montar();
    await servico.listar({} as never, ADVOGADO);
    const args = findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual([{ inicio: 'asc' }, { id: 'asc' }]);
    expect(args.take).toBe(LIMITE_SEM_PAGINA);
    expect(LIMITE_SEM_PAGINA).toBe(500);
    expect(ordemDaListagem('anteriores')).toEqual([{ inicio: 'desc' }, { id: 'desc' }]);
  });
});

describe('"Carregar mais": a página seguinte continua depois da anterior', () => {
  it.each<[Janela, number]>([
    ['adiante', 2],
    ['adiante', 3],
    ['adiante', 5],
    ['anteriores', 2],
    ['anteriores', 4],
  ])('%s de %i em %i: as páginas somadas são a lista inteira, na mesma ordem', async (janela, limite) => {
    const { servico } = montar();
    const inteira = nomes(
      (await servico.listar({ recorte: 'todos', janela } as never, ADVOGADO)) as unknown as Linha[],
    );
    const paginas = await todasAsPaginas(janela, limite);
    expect(paginas.flat()).toEqual(inteira);
    expect(new Set(paginas.flat()).size).toBe(inteira.length);
    expect(paginas.slice(0, -1).every((p) => p.length === limite)).toBe(true);
  });

  /** O corte cai entre hoje-9h-b e hoje-9h-a: mesmo instante, a página seguinte não pula nem repete. */
  it('corte no meio do empate das 9h', async () => {
    const paginas = await todasAsPaginas('adiante', 5);
    expect(paginas[0]).toEqual([
      'julho-1-aberta',
      'ontem-9h-aberta',
      'hoje-00h10-concluida',
      'hoje-7h30-em-andamento',
      'hoje-9h-b',
    ]);
    expect(paginas[1]).toEqual(['hoje-9h-a', 'hoje-9h-c', 'amanha-9h']);
  });

  /** Oito itens em páginas de 4: a terceira volta vazia. É o custo aceito de não mandar o total na página. */
  it('lista que termina redonda pede uma página vazia a mais, e para', async () => {
    const paginas = await todasAsPaginas('adiante', 4);
    expect(paginas.map((p) => p.length)).toEqual([4, 4, 0]);
  });

  it('cursor que não é cursor: 400, sem consultar o banco', async () => {
    const { servico, findMany } = montar();
    await expect(
      servico.listar({ recorte: 'todos', janela: 'adiante', cursor: '2026-09-14_qualquer' } as never, ADVOGADO),
    ).rejects.toThrow(BadRequestException);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('o contador de cada metade conta o que a lista mostra', () => {
  it('Próximas 8 e Anteriores 5, somando as 13 de Todas', async () => {
    const { servico } = montar();
    const contagem = await servico.contarRecortes({} as never, ADVOGADO);
    expect(contagem.todosAdiante).toBe(8);
    expect(contagem.todosAnteriores).toBe(5);
    expect(contagem.todos).toBe(13);
    expect(contagem.todosAdiante + contagem.todosAnteriores).toBe(contagem.todos);

    for (const janela of ['adiante', 'anteriores'] as const) {
      const lista = await montar().servico.listar({ recorte: 'todos', janela } as never, ADVOGADO);
      expect(lista).toHaveLength(janela === 'adiante' ? contagem.todosAdiante : contagem.todosAnteriores);
    }
  });
});

describe('o cursor', () => {
  it('é o início em ISO e o id, e volta igual', () => {
    const item = ACERVO.find((l) => l.nome === 'hoje-9h-a')!;
    const texto = cursorDe(item);
    expect(texto).toBe(`2026-09-14T12:00:00.000Z_${uuid(8)}`);
    expect(lerCursor(texto)).toEqual({ inicio: item.inicio, id: item.id });
    // O web recebe `inicio` como texto do JSON: a mesma conta dá o mesmo cursor.
    expect(cursorDe({ inicio: '2026-09-14T12:00:00.000Z', id: uuid(8) })).toBe(texto);
  });

  it.each([
    ['vazio', ''],
    ['só a data', '2026-09-14T12:00:00.000Z'],
    ['id curto', '2026-09-14T12:00:00.000Z_abc'],
    ['sem fuso', `2026-09-14T12:00:00.000_${uuid(8)}`],
    ['data impossível', `2026-13-45T12:00:00.000Z_${uuid(8)}`],
  ])('recusa %s', (_nome, texto) => {
    expect(lerCursor(texto)).toBeNull();
  });
});

describe('o DTO aceita o que o web novo manda e recusa o resto', () => {
  const erros = (q: Record<string, unknown>) =>
    validateSync(plainToInstance(ListCompromissosQueryDto, q), { whitelist: true, forbidNonWhitelisted: true })
      .map((e) => e.property)
      .sort();

  it('a página da lista por dia, com a query em texto como chega na URL', () => {
    expect(erros({ recorte: 'todos', janela: 'anteriores', limite: '50', cursor: `2026-09-13T12:00:00.000Z_${uuid(2)}` })).toEqual([]);
    const dto = plainToInstance(ListCompromissosQueryDto, { limite: '50' });
    expect(dto.limite).toBe(50);
  });

  it('o web antigo, sem nenhum dos três, continua valendo', () => {
    expect(erros({ recorte: 'hoje', pessoa: 'eu' })).toEqual([]);
  });

  it.each<[string, Record<string, unknown>, string]>([
    ['janela desconhecida', { janela: 'ontem' }, 'janela'],
    ['limite zero', { limite: '0' }, 'limite'],
    ['limite acima de 200', { limite: '201' }, 'limite'],
    ['limite quebrado', { limite: '12.5' }, 'limite'],
    ['limite que não é número', { limite: 'muitos' }, 'limite'],
    ['cursor torto', { cursor: 'depois-da-audiencia' }, 'cursor'],
  ])('recusa %s', (_nome, q, campo) => {
    expect(erros(q)).toEqual([campo]);
  });
});
