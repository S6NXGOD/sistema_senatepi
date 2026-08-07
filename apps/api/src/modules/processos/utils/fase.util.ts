/**
 * Em que FASE o processo está — conhecimento, execução, recursal ou arquivado.
 *
 * POR QUE NÃO É UMA COLUNA
 * A fase não é um dado que alguém digita: ela é consequência do que já está no
 * banco (quais graus seguem vivos e quais atos foram praticados). Guardá-la
 * numa coluna criaria uma segunda verdade, que envelhece sozinha toda vez que
 * uma sincronização traz movimento novo e ninguém lembra de reescrevê-la.
 * Aqui ela é DERIVADA, num só lugar, e usada tanto pelo filtro da lista (via
 * `whereFase`) quanto pela tela (via `faseDoProcesso`).
 *
 * OS CÓDIGOS FORAM CONFERIDOS AO VIVO, não deduzidos da tabela publicada —
 * mesma regra de `tpu.util.ts`. Agregação `movimentos.codigo` → `movimentos.nome`
 * na API pública do CNJ, em 06/08/2026:
 *
 *   11385  Execução/Cumprimento de Sentença Iniciada(o)   TRT22 104.097 · TJPI 50.506
 *   11384  Liquidação iniciada                            TRT22  78.378
 *   196    Extinção da execução ou do cumprimento         TRT22 102.864 · TJPI 114.012
 *
 * Os dois primeiros aparecem nos dois ramos da Justiça em que o SENATEPI atua, o
 * que é o que autoriza usá-los como regra geral e não como jeitinho do TRT.
 */

/** Início da fase de execução/cumprimento — é o que separa "ganhou" de "recebeu". */
export const CODIGOS_TPU_EXECUCAO = [11384, 11385] as const;

/**
 * Graus que caracterizam fase RECURSAL.
 *
 * Espelha `ORDEM_GRAU` de `instancia.util.ts` a partir do 2º grau. TR (turma
 * recursal) entra: é o órgão que julga o recurso do juizado, ainda que o número
 * do grau seja baixo.
 */
export const GRAUS_RECURSAIS = ['G2', 'G3', 'G4', 'TR', 'TST', 'STJ', 'STF', 'SUP'] as const;

export type FaseProcessual = 'CONHECIMENTO' | 'EXECUCAO' | 'RECURSAL' | 'ARQUIVADO';

export const FASE_LABEL: Record<FaseProcessual, string> = {
  CONHECIMENTO: 'Conhecimento',
  EXECUCAO: 'Execução',
  RECURSAL: 'Recursal',
  ARQUIVADO: 'Arquivado',
};

interface EntradaFase {
  instancias: { grau: string | null; baixada: boolean }[];
  /** Basta saber SE existe ato de execução — não interessa quando. */
  temMovimentoDeExecucao: boolean;
}

/**
 * A fase, em ordem de precedência. A ordem importa e é o único ponto discutível
 * da regra, então está explícita:
 *
 *  1. ARQUIVADO   — nenhuma instância viva. Não há fase; o processo acabou.
 *  2. RECURSAL    — alguma instância viva acima do 1º grau. Vence a execução
 *                   porque, com recurso pendente, é o recurso que manda no
 *                   calendário da equipe — a execução provisória do 1º grau pode
 *                   ser derrubada pelo acórdão.
 *  3. EXECUCAO    — só o 1º grau vivo, e já houve início de execução/liquidação.
 *  4. CONHECIMENTO— o resto.
 *
 * Processo sem nenhuma instância (RASCUNHO, ou cadastro anterior ao backfill)
 * cai em CONHECIMENTO: é o palpite menos danoso — some do filtro "Arquivado",
 * que é o que ninguém quer ver, em vez de sumir da lista de trabalho ativo.
 */
export function faseDoProcesso({ instancias, temMovimentoDeExecucao }: EntradaFase): FaseProcessual {
  const vivas = instancias.filter((i) => !i.baixada);
  if (instancias.length && !vivas.length) return 'ARQUIVADO';
  const recursais: readonly string[] = GRAUS_RECURSAIS;
  if (vivas.some((i) => recursais.includes((i.grau ?? '').toUpperCase()))) return 'RECURSAL';
  if (temMovimentoDeExecucao) return 'EXECUCAO';
  return 'CONHECIMENTO';
}
