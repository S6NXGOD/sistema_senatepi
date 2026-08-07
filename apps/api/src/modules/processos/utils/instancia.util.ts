/**
 * Qual grau do processo é o "principal" — o que aparece na lista, alimenta os
 * atalhos de `processos` e responde por ele nos filtros.
 *
 * POR QUE PRECISA DE UMA REGRA
 * O DataJud devolve um documento por grau e nenhum deles se declara o
 * principal. Antes, a escolha era acidental: o cliente lia `hits[0]`, e a
 * primeira posição vinha da ordenação por relevância do Elasticsearch — que
 * não tem relação nenhuma com o andamento do processo. Um processo cuja
 * apelação já transitou em julgado podia se apresentar como "2º grau, baixado"
 * enquanto o cumprimento de sentença corria no 1º.
 *
 * Função pura de propósito: é a regra mais fácil de errar de todo o módulo e a
 * única testável sem banco nem rede.
 */

/**
 * Ordem de subida. Menor número = instância mais próxima da origem.
 *
 * Cobre até os tribunais superiores porque o processo trabalhista sobe ao TST e,
 * excepcionalmente, ao STF — e um grau desconhecido caía num balde único, o que
 * tornava o desempate entre dois deles arbitrário.
 *
 * ATENÇÃO ao alcance real: reconhecer o grau NÃO significa buscá-lo. O DataJud
 * guarda cada tribunal num índice próprio (`api_publica_tst`,
 * `api_publica_stf`), e a sincronização consulta apenas o índice do tribunal de
 * origem. Um recurso no TST só aparece aqui se o próprio índice do TRT o
 * devolver. Buscar os índices superiores para todo processo multiplicaria as
 * chamadas ao CNJ — quando valer a pena, o caminho é consultar o TST só para
 * processos cujo 2º grau tenha remessa a ele.
 */
const ORDEM_GRAU: Record<string, number> = {
  G1: 1,
  JE: 2,
  TR: 3,
  G2: 4,
  G3: 5,
  TST: 5,
  STJ: 5,
  G4: 6,
  STF: 6,
  SUP: 6,
};

/** Grau desconhecido vai para o fim — nunca ganha de um grau que reconhecemos. */
function ordemDoGrau(grau: string | null | undefined): number {
  return ORDEM_GRAU[(grau ?? '').toUpperCase()] ?? 99;
}

export interface InstanciaParaEscolha {
  docId: string;
  /** Null é aceito: o CNJ nem sempre informa o grau, e `ordemDoGrau` trata. */
  grau: string | null;
  /** Data do movimento mais recente. Null quando a instância não tem andamento. */
  ultimoMovimentoEm: Date | null;
  /** Baixa definitiva/trânsito sem desarquivamento posterior. */
  baixada: boolean;
}

/**
 * Escolhe a instância principal.
 *
 *   1. Se houver alguma VIVA, só as vivas concorrem — uma instância encerrada
 *      não representa um processo que ainda anda.
 *   2. Entre as concorrentes, a de movimento MAIS RECENTE.
 *   3. Empate (ou nenhum movimento): o MENOR grau, e por fim o `docId`.
 *
 * O passo 1 é o que resolve o caso do 2º grau baixado com 1º grau ativo: sem
 * ele, o G2 venceria sempre que sua baixa fosse mais recente que o último
 * andamento do G1 — exatamente a situação em que o G1 é o que importa.
 *
 * QUANDO TODAS ESTÃO BAIXADAS, vence a mais recente — não o menor grau. O
 * processo acabou, e o que o descreve é a instância que o encerrou: um processo
 * que subiu em apelação e transitou em julgado no 2º grau se apresentando como
 * "1º grau" esconderia justamente a decisão final. O menor grau só desempata
 * quando não há movimento algum para comparar.
 *
 * Devolve `null` para lista vazia; o desempate final por `docId` garante que
 * duas execuções sobre os mesmos dados escolham a mesma instância (sem isso, o
 * atalho de `processos` poderia oscilar entre sincronizações).
 */
export function escolherPrincipal<T extends InstanciaParaEscolha>(instancias: T[]): T | null {
  if (!instancias.length) return null;

  const vivas = instancias.filter((i) => !i.baixada);
  const candidatas = vivas.length ? vivas : instancias;

  return [...candidatas].sort((a, b) => {
    const movA = a.ultimoMovimentoEm?.getTime() ?? -Infinity;
    const movB = b.ultimoMovimentoEm?.getTime() ?? -Infinity;
    if (movA !== movB) return movB - movA; // mais recente primeiro
    const grauA = ordemDoGrau(a.grau);
    const grauB = ordemDoGrau(b.grau);
    if (grauA !== grauB) return grauA - grauB; // menor grau primeiro
    return a.docId.localeCompare(b.docId); // determinismo
  })[0];
}

/**
 * O processo ainda merece ser varrido?
 *
 * Verdadeiro enquanto QUALQUER instância estiver viva. É o que impede o caso do
 * enunciado: a baixa no 2º grau encerrava o processo e, com ele, o
 * acompanhamento do 1º grau — que continuava recebendo andamento sem ninguém
 * ver.
 */
export function temInstanciaViva(instancias: { baixada: boolean }[]): boolean {
  return instancias.some((i) => !i.baixada);
}
