/**
 * Etiquetas que o sistema já consegue deduzir sozinho ao importar um processo.
 *
 * POR QUE ISTO EXISTE
 * Toda importação terminava com alguém digitando "Coletiva" e "Fase de Execução"
 * à mão — duas informações que estão escritas na classe processual e no último
 * andamento que o CNJ acabou de devolver. Deduzir o óbvio é barato; o que não
 * pode é decidir pelo advogado.
 *
 * REGRA DE OURO: isto SUGERE, não impõe. A tela marca as etiquetas devolvidas
 * aqui e o operador desmarca o que não quiser antes de confirmar. Por isso a
 * lista é curta e só cobre o que é inequívoco — na dúvida, não etiqueta: uma
 * etiqueta errada em massa é pior que etiqueta nenhuma, porque ela vira filtro,
 * e filtro errado esconde processo.
 *
 * Mora no back, e não na tela, porque é regra de negócio testável — o front não
 * tem suíte de testes, e classificação sem teste envelhece errado.
 */

import { CODIGOS_TPU_EXECUCAO } from './fase.util';

/** Etiquetas do catálogo (`ETIQUETAS_SUGERIDAS` no front) que sabemos deduzir. */
export const ETIQUETA_COLETIVA = 'Coletiva';
export const ETIQUETA_EXECUCAO = 'Fase de Execução';
export const ETIQUETA_RECURSO = 'Recurso';
export const ETIQUETA_PERICIA = 'Perícia';

/** Sem acento e em minúsculas — "Execução" e "EXECUCAO" têm de casar igual. */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/**
 * AÇÃO COLETIVA. Vem da CLASSE, nunca do andamento: "ação civil pública" é a
 * natureza do processo e não muda no meio do caminho.
 *
 * `substituicao processual` entra porque é como a Justiça do Trabalho nomeia a
 * ação que o sindicato move em nome da categoria — o caso mais comum do
 * SENATEPI.
 */
const CLASSES_COLETIVAS = [
  'acao coletiva',
  'acao civil publica',
  'acao civil coletiva',
  'dissidio coletivo',
  'substituicao processual',
  'mandado de seguranca coletivo',
];

/**
 * FASE DE EXECUÇÃO. Pode vir da classe (o processo já nasceu como execução) ou
 * de QUALQUER andamento do histórico.
 *
 * OLHAR SÓ O ÚLTIMO ANDAMENTO NÃO FUNCIONA — e isso foi medido, não suposto:
 * no 0000600-48.2023.5.22.0108 (TRT22), que está em execução desde agosto de
 * 2025, o andamento mais recente é "Disponibilização no Diário da Justiça
 * Eletrônico". O ato que abre a execução acontece uma vez e é soterrado por
 * dezenas de atos de rotina; procurá-lo só no topo da pilha faria a etiqueta
 * nunca disparar.
 *
 * "liquidacao" entra: é a etapa que abre a execução na Justiça do Trabalho.
 * "execucao fiscal" NÃO é excluída de propósito — é execução de verdade, mesmo
 * que raríssima no acervo do sindicato.
 */
const TERMOS_EXECUCAO = [
  'cumprimento de sentenca',
  'cumprimento provisorio',
  'cumprimento definitivo',
  'execucao',
  'liquidacao',
];

/**
 * RECURSO. Só da CLASSE, e a lista é fechada de propósito: a palavra "recurso"
 * aparece em andamento de rotina o tempo todo ("aguardando prazo recursal",
 * "certidão de decurso do prazo recursal") sem que exista recurso nenhum nos
 * autos. Classe é o que o tribunal registrou como sendo o processo.
 */
const CLASSES_RECURSAIS = [
  'recurso',
  'agravo',
  'apelacao',
  'embargos de declaracao',
  'embargos infringentes',
];

/**
 * PERÍCIA. Vem do ASSUNTO — insalubridade e periculosidade dependem de laudo
 * pericial por exigência legal (CLT, art. 195), então a perícia é praticamente
 * certa e vale avisar antes de ela ser designada.
 *
 * NÃO deduzimos perícia de andamento ("nomeado perito"): quando isso aparece, a
 * perícia já foi marcada e a etiqueta chega tarde para o que ela serve —
 * planejar. E o radar de audiências já cuida do ato em si.
 */
const ASSUNTOS_COM_PERICIA = ['insalubridade', 'periculosidade'];

export interface EntradaEtiquetas {
  classeProcessual?: string | null;
  /** Assunto principal informado pelo CNJ. */
  assuntoPrincipal?: string | null;
  /**
   * TODO o histórico de andamentos, não só o último (ver acima).
   *
   * O código é conferido ANTES do texto: `CODIGOS_TPU_EXECUCAO` vem da mesma
   * constante que decide a fase processual na lista (`fase.util.ts`), então a
   * etiqueta sugerida aqui e a fase mostrada lá não podem divergir — que é
   * exatamente o tipo de desencontro que ninguém percebe.
   */
  movimentacoes?: { codigoMovimento?: number | null; descricao?: string | null }[];
}

/**
 * Etiquetas deduzidas, sem repetição e em ordem estável.
 *
 * Devolve lista vazia quando não há nada de inequívoco — que é o caso da
 * maioria dos processos, e está certo assim.
 */
/**
 * ETIQUETAS QUE O SISTEMA MANTÉM SOZINHO — derivadas na leitura, nunca gravadas.
 *
 * POR QUE ISTO SUBSTITUI A SUGESTÃO NA IMPORTAÇÃO
 * Sugerir a etiqueta no cadastro resolvia o primeiro dia e criava o problema de
 * todos os outros: o rótulo congela e o processo anda. Os números da produção em
 * 07/08/2026 mostram o resultado — as duas únicas etiquetas em uso eram
 * "Fase de Execução" (4 processos) e "Coletiva" (3), ambas deriváveis; a
 * "Coletiva" faltava em 2 dos 5 processos institucionais (alguém esqueceu), e o
 * único processo com assunto de insalubridade não tinha "Perícia" (ninguém
 * lembrou). Ou seja: o trabalho manual dava trabalho E saía errado.
 *
 * Derivada na LEITURA, e não gravada, de propósito: o que não é armazenado não
 * pode ficar desatualizado. Some sozinha quando deixa de valer.
 *
 * FASE DE EXECUÇÃO E RECURSO NÃO ENTRAM AQUI: a coluna de fase processual já diz
 * isso, com regra própria e testada, e repetir a mesma informação em dois
 * lugares foi exatamente o que gerou a contradição na tela.
 */
export function etiquetasDerivadas({
  tipoAcao,
  classeProcessual,
  assuntoPrincipal,
}: {
  tipoAcao?: string | null;
  classeProcessual?: string | null;
  assuntoPrincipal?: string | null;
}): string[] {
  const etiquetas: string[] = [];
  const classe = normalizar(classeProcessual ?? '');
  const assunto = normalizar(assuntoPrincipal ?? '');

  // Ação institucional é coletiva por definição — o sindicato move em nome da
  // categoria. A classe cobre o caso raro de coletiva que não é institucional.
  if (tipoAcao === 'INSTITUCIONAL' || (classe && CLASSES_COLETIVAS.some((t) => classe.includes(t)))) {
    etiquetas.push(ETIQUETA_COLETIVA);
  }
  if (assunto && ASSUNTOS_COM_PERICIA.some((t) => assunto.includes(t))) {
    etiquetas.push(ETIQUETA_PERICIA);
  }
  return etiquetas;
}

export function etiquetasAutomaticas({
  classeProcessual,
  assuntoPrincipal,
  movimentacoes = [],
}: EntradaEtiquetas): string[] {
  const classe = normalizar(classeProcessual ?? '');
  const assunto = normalizar(assuntoPrincipal ?? '');
  const etiquetas: string[] = [];

  if (classe && CLASSES_COLETIVAS.some((t) => classe.includes(t))) {
    etiquetas.push(ETIQUETA_COLETIVA);
  }
  if (classe && CLASSES_RECURSAIS.some((t) => classe.includes(t))) {
    etiquetas.push(ETIQUETA_RECURSO);
  }
  if (assunto && ASSUNTOS_COM_PERICIA.some((t) => assunto.includes(t))) {
    etiquetas.push(ETIQUETA_PERICIA);
  }

  const codigosExecucao: readonly number[] = CODIGOS_TPU_EXECUCAO;
  const executando =
    (classe && TERMOS_EXECUCAO.some((t) => classe.includes(t))) ||
    movimentacoes.some(
      (m) =>
        (m.codigoMovimento != null && codigosExecucao.includes(m.codigoMovimento)) ||
        TERMOS_EXECUCAO.some((t) => normalizar(m.descricao ?? '').includes(t)),
    );
  if (executando) etiquetas.push(ETIQUETA_EXECUCAO);

  return etiquetas;
}
