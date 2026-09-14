import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isValidElement, type ReactNode } from 'react';
import {
  PAGINA_DA_AGENDA,
  agruparPorDia,
  estadoDoPrazoEm,
  horaBRDe,
  paginasChegaramAHoje,
  proximoCursor,
  rotuloCurtoDoDia,
  rotuloDoCabecalho,
  semRepetidas,
  type StatusCompromisso,
} from '@/lib/agenda';
import { useTelaLarga as daLib } from '@/lib/use-tela-larga';
import { useTelaLarga as daEscala } from '@/components/escalas/use-tela-larga';
import { RodapeDaPaginacao } from './lista-por-dia';

const t = (iso: string) => new Date(iso).getTime();

/** Uma linha da agenda com só o que a lista lê. */
const linha = (
  id: string,
  inicio: string,
  tipo: string,
  status: StatusCompromisso = 'PENDENTE',
  origemAutomatica = false,
) => ({ id, inicio, tipo, status, origemAutomatica });

const ids = (itens: { id: string }[]) => itens.map((c) => c.id);

/**
 * A LISTA POR DIA (14/09/2026). No celular o quadro empilhava as quatro colunas
 * e a pergunta "o que tenho hoje e depois" ficava espalhada entre elas. As
 * regras moram em funções puras; aqui elas rodam com linhas de verdade.
 *
 * O relógio: segunda, 14/09/2026, 10h de Teresina.
 */
const AGORA = t('2026-09-14T10:00:00-03:00');

describe('rotuloDoCabecalho — calculado, nunca escrito à mão', () => {
  it('hoje, amanhã e ontem ganham o nome; os outros dias, só a data', () => {
    expect(rotuloDoCabecalho('2026-09-14', '2026-09-14')).toBe('Hoje · seg, 14/09');
    expect(rotuloDoCabecalho('2026-09-15', '2026-09-14')).toBe('Amanhã · ter, 15/09');
    expect(rotuloDoCabecalho('2026-09-13', '2026-09-14')).toBe('Ontem · dom, 13/09');
    expect(rotuloDoCabecalho('2026-09-16', '2026-09-14')).toBe('qua, 16/09');
  });

  /** O pedido dizia "sex, 13/09": 13/09/2026 é domingo. */
  it('o dia da semana é o do calendário', () => {
    expect(rotuloCurtoDoDia('2026-09-13', '2026-09-14')).toBe('dom, 13/09');
    expect(rotuloCurtoDoDia('2026-09-12', '2026-09-14')).toBe('sáb, 12/09');
  });

  it('outro ano leva o ano; a virada do mês e do ano não erra amanhã', () => {
    expect(rotuloDoCabecalho('2027-01-07', '2026-09-14')).toBe('qui, 07/01/2027');
    expect(rotuloDoCabecalho('2027-01-01', '2026-12-31')).toBe('Amanhã · sex, 01/01/2027');
    expect(rotuloDoCabecalho('2026-10-01', '2026-09-30')).toBe('Amanhã · qui, 01/10');
  });

  it('texto que não é dia volta como veio', () => {
    expect(rotuloDoCabecalho('lixo', '2026-09-14')).toBe('lixo');
  });
});

describe('horaBRDe — a hora da coluna é a de Teresina', () => {
  it('23h30 de Teresina já é o dia seguinte em UTC, e continua 23:30', () => {
    expect(horaBRDe('2026-09-15T02:30:00Z')).toBe('23:30');
    expect(horaBRDe('2026-09-14T09:30:00-03:00')).toBe('09:30');
    expect(horaBRDe('não é data')).toBe('');
  });
});

describe('agruparPorDia — Próximas (e as abas Hoje, 7 dias, Em aberto)', () => {
  const itens = [
    linha('f', '2026-09-16T10:00:00-03:00', 'REUNIAO'),
    linha('c', '2026-09-14T09:00:00-03:00', 'AUDIENCIA'),
    linha('b', '2026-09-11T09:00:00-03:00', 'PRAZO'),
    linha('d', '2026-09-14T15:00:00-03:00', 'AUDIENCIA', 'PENDENTE', true),
    linha('e', '2026-09-14T08:00:00-03:00', 'CONSULTA_JURIDICA', 'CONCLUIDO'),
    linha('a', '2026-09-10T15:00:00-03:00', 'PRAZO', 'EM_ANDAMENTO'),
    // 23h30 de hoje em Teresina, já 15/09 em UTC: é de HOJE.
    linha('g', '2026-09-15T02:30:00Z', 'PRAZO'),
    linha('h', '2026-09-15T14:00:00-03:00', 'PERICIA'),
  ];
  const grupos = agruparPorDia(itens, { agora: AGORA, sentido: 'adiante', incluirHoje: true });

  it('o que ficou para trás vem num grupo só, no topo, a mais antiga primeiro', () => {
    expect(grupos[0]).toMatchObject({ chave: 'ficaram-para-tras', paraTras: true, ymd: null, rotulo: 'Ficaram para trás' });
    expect(ids(grupos[0].itens)).toEqual(['a', 'b']);
  });

  it('depois um grupo por dia de Teresina, do mais cedo ao mais tarde', () => {
    expect(grupos.map((g) => g.rotulo)).toEqual([
      'Ficaram para trás',
      'Hoje · seg, 14/09',
      'Amanhã · ter, 15/09',
      'qua, 16/09',
    ]);
    expect(grupos[1].hoje).toBe(true);
  });

  /**
   * Tarefa (botão cheio Concluir, D7) antes de hora marcada; cada metade por
   * início. A audiência do robô é tarefa. A concluída de hoje continua no dia.
   */
  it('dentro do dia: tarefas primeiro, depois a hora marcada, cada uma por início', () => {
    expect(ids(grupos[1].itens)).toEqual(['d', 'g', 'e', 'c']);
  });

  it('dia sem atividade é pulado', () => {
    expect(grupos.some((g) => g.ymd === '2026-09-17')).toBe(false);
  });

  it('a aberta de hoje com a hora passada NÃO sobe para o âmbar: passou da hora é informação', () => {
    expect(estadoDoPrazoEm(itens[1], AGORA)).toBe('PASSOU_DA_HORA');
    expect(ids(grupos[0].itens)).not.toContain('c');
  });

  it('início igual desempata pelo id, como a API ordena', () => {
    const empate = agruparPorDia(
      [linha('b2', '2026-09-15T09:00:00-03:00', 'PRAZO'), linha('a1', '2026-09-15T09:00:00-03:00', 'PRAZO')],
      { agora: AGORA, sentido: 'adiante', incluirHoje: false },
    );
    expect(ids(empate[0].itens)).toEqual(['a1', 'b2']);
  });
});

describe('agruparPorDia — Hoje sempre presente', () => {
  it('com incluirHoje, a lista vazia ainda tem o grupo de hoje, vazio', () => {
    const grupos = agruparPorDia([], { agora: AGORA, sentido: 'adiante', incluirHoje: true });
    expect(grupos).toEqual([
      { chave: '2026-09-14', paraTras: false, ymd: '2026-09-14', hoje: true, rotulo: 'Hoje · seg, 14/09', itens: [] },
    ]);
  });

  it('só com o que ficou para trás, Hoje vem logo abaixo do âmbar', () => {
    const grupos = agruparPorDia([linha('a', '2026-09-10T15:00:00-03:00', 'PRAZO')], {
      agora: AGORA, sentido: 'adiante', incluirHoje: true,
    });
    expect(grupos.map((g) => g.chave)).toEqual(['ficaram-para-tras', '2026-09-14']);
  });

  it('a aba "Ficaram para trás" não inclui Hoje', () => {
    const grupos = agruparPorDia([linha('a', '2026-09-10T15:00:00-03:00', 'PRAZO')], {
      agora: AGORA, sentido: 'adiante', incluirHoje: false,
    });
    expect(grupos.map((g) => g.chave)).toEqual(['ficaram-para-tras']);
  });
});

describe('agruparPorDia — dia escolhido no calendário', () => {
  it('sem o âmbar: a aberta de um dia passado fica no próprio dia', () => {
    const grupos = agruparPorDia(
      [linha('a', '2026-09-10T15:00:00-03:00', 'PRAZO'), linha('x', '2026-09-10T09:00:00-03:00', 'REUNIAO', 'CONCLUIDO')],
      { agora: AGORA, sentido: 'adiante', incluirHoje: false, separarParaTras: false },
    );
    expect(grupos.map((g) => [g.rotulo, ids(g.itens)])).toEqual([['qui, 10/09', ['a', 'x']]]);
  });
});

describe('agruparPorDia — Anteriores', () => {
  const itens = [
    linha('h', '2026-09-11T09:00:00-03:00', 'PRAZO', 'CONCLUIDO'),
    linha('j', '2026-09-13T10:00:00-03:00', 'REUNIAO', 'CONCLUIDO'),
    linha('i', '2026-09-11T14:00:00-03:00', 'AUDIENCIA', 'CANCELADO'),
    linha('k', '2026-09-11T08:00:00-03:00', 'CONSULTA_JURIDICA', 'CONCLUIDO'),
  ];
  const grupos = agruparPorDia(itens, { agora: AGORA, sentido: 'anteriores', incluirHoje: true });

  it('do dia mais recente ao mais antigo, sem âmbar e sem Hoje', () => {
    expect(grupos.map((g) => g.rotulo)).toEqual(['Ontem · dom, 13/09', 'sex, 11/09']);
    expect(grupos.some((g) => g.paraTras || g.hoje)).toBe(false);
  });

  /**
   * Tudo decrescente, inclusive dentro do dia e sem separar tarefa: a página
   * seguinte da API vem depois do último item, e nunca entra acima do que a
   * pessoa já leu.
   */
  it('dentro do dia também decrescente, pela hora', () => {
    expect(ids(grupos[1].itens)).toEqual(['i', 'h', 'k']);
  });
});

describe('proximoCursor — a próxima página por (início, id)', () => {
  const uuid = '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b';
  const pagina = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: i === n - 1 ? uuid : `id-${i}`,
      inicio: '2026-09-14T09:00:00-03:00',
    }));

  it('página cheia devolve o cursor do último item, no formato que a API valida', () => {
    const cursor = proximoCursor(pagina(PAGINA_DA_AGENDA), PAGINA_DA_AGENDA);
    expect(cursor).toBe(`2026-09-14T12:00:00.000Z_${uuid}`);
    // A mesma validação do DTO da API (resumo da agenda, 14/09/2026).
    expect(cursor).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z_[0-9a-fA-F-]{36}$/);
  });

  it('página com menos que o limite é a última', () => {
    expect(proximoCursor(pagina(PAGINA_DA_AGENDA - 1), PAGINA_DA_AGENDA)).toBeUndefined();
    expect(proximoCursor([], PAGINA_DA_AGENDA)).toBeUndefined();
  });

  it('a página é de 50', () => {
    expect(PAGINA_DA_AGENDA).toBe(50);
  });
});

describe('semRepetidas — as páginas viram uma lista', () => {
  it('a remarcada que veio em duas páginas aparece uma vez, onde a pessoa já leu', () => {
    const lista = semRepetidas([
      [{ id: 'a', v: 1 }, { id: 'b', v: 1 }],
      [{ id: 'b', v: 2 }, { id: 'c', v: 2 }],
    ]);
    expect(lista).toEqual([{ id: 'a', v: 1 }, { id: 'b', v: 1 }, { id: 'c', v: 2 }]);
  });
});

/**
 * O HOJE VAZIO SÓ QUANDO AS PÁGINAS CHEGARAM A HOJE (14/09/2026). Em Próximas
 * a API manda primeiro o que ficou para trás; com a primeira página cheia
 * disso, as de hoje estão na seguinte e "Nenhuma atividade hoje" seria falso.
 */
describe('paginasChegaramAHoje — Todas · Próximas paginada', () => {
  const atrasadas = Array.from({ length: PAGINA_DA_AGENDA }, (_, i) =>
    linha(`a${String(i).padStart(2, '0')}`, '2026-09-10T09:00:00-03:00', 'PRAZO'),
  );

  it('página cheia de atrasadas e com próxima: não chegou, e a lista não afirma Hoje vazio', () => {
    const chegou = paginasChegaramAHoje(atrasadas, true, AGORA);
    expect(chegou).toBe(false);
    const grupos = agruparPorDia(atrasadas, { agora: AGORA, sentido: 'adiante', incluirHoje: chegou });
    expect(grupos.some((g) => g.hoje)).toBe(false);
  });

  it('sem próxima página, chegou: o Hoje vazio é resposta', () => {
    expect(paginasChegaramAHoje(atrasadas, false, AGORA)).toBe(true);
    expect(paginasChegaramAHoje([], false, AGORA)).toBe(true);
  });

  it('o último item já é de hoje (23h30 de Teresina, 02h30 UTC de amanhã) ou depois: chegou', () => {
    expect(paginasChegaramAHoje([...atrasadas, linha('g', '2026-09-15T02:30:00Z', 'PRAZO')], true, AGORA)).toBe(true);
    expect(paginasChegaramAHoje([...atrasadas, linha('h', '2026-09-16T09:00:00-03:00', 'PRAZO')], true, AGORA)).toBe(true);
  });

  it('o último é de ontem às 23h59 de Teresina: ainda não chegou', () => {
    expect(paginasChegaramAHoje([linha('o', '2026-09-14T02:59:00Z', 'PRAZO')], true, AGORA)).toBe(false);
  });
});

/** Tudo o que o elemento desenha, como texto. */
function textoDe(no: ReactNode): string {
  if (no === null || no === undefined || typeof no === 'boolean') return '';
  if (typeof no === 'string' || typeof no === 'number') return String(no);
  if (Array.isArray(no)) return no.map(textoDe).join('');
  if (isValidElement<{ children?: ReactNode }>(no)) return textoDe(no.props.children);
  return '';
}

/**
 * FALHA NO "CARREGAR MAIS" FALA (14/09/2026). O react-query guarda a página 1
 * quando a 2 falha: sem esta linha o botão só voltava ao normal, mudo.
 */
describe('RodapeDaPaginacao — a página seguinte que não veio', () => {
  const base = { mostrando: 50, total: 120, temMais: true, carregando: false, onCarregarMais: () => undefined };
  const FRASE = 'Não deu para carregar mais. Tente de novo.';

  it('com erro, diz que não veio e o botão continua para tentar de novo', () => {
    const texto = textoDe(RodapeDaPaginacao({ ...base, erro: true }));
    expect(texto).toContain(FRASE);
    expect(texto).toContain('Carregar mais');
  });

  it('sem erro, ou já tentando de novo, nada de frase', () => {
    expect(textoDe(RodapeDaPaginacao(base))).not.toContain(FRASE);
    expect(textoDe(RodapeDaPaginacao({ ...base, erro: true, carregando: true }))).not.toContain(FRASE);
  });

  it('a agenda passa o erro da página seguinte, e não o da consulta inteira', () => {
    const pagina = readFileSync(resolve(__dirname, '../../app/(dashboard)/agenda/page.tsx'), 'utf8');
    expect(pagina).toContain('erro={todas.isFetchNextPageError}');
    expect(pagina).toContain("incluirHoje: !diaSelecionado && aba !== 'atrasadas' && todasChegouAHoje,");
    expect(pagina).toContain('paginasChegaramAHoje(itensDeTodas, !!todas.hasNextPage, Date.now())');
  });
});

describe('a largura que decide a visão é uma só', () => {
  /** Mudou para lib/ quando a Agenda passou a usar; o caminho da Escala só reexporta. */
  it('Escala e Agenda leem o mesmo hook', () => {
    expect(daEscala).toBe(daLib);
  });
});
