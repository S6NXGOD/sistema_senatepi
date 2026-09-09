/**
 * PLURAL EM PORTUGUÊS — porque colar sufixo na palavra inteira não funciona.
 *
 * O padrão que apareceu três vezes no código, e errou em duas:
 *
 * ```tsx
 * organização{n === 1 ? '' : 'ões'}   // 27 organizaçãoões  ✗
 * possível{n === 1 ? '' : 'is'}       // 3 possívelis       ✗
 * pré-processua{n === 1 ? 'l' : 'is'} // pré-processuais    ✓
 * ```
 *
 * O terceiro acerta por acidente de radical: "pré-processua" é um pedaço que
 * aceita os dois finais. Português quase nunca é assim — o plural de "-ão" e
 * "-l" TROCA a terminação, não a acumula. Escrever as duas formas por extenso
 * é mais curto que acertar a regra, e não tem como sair errado.
 *
 * Uso:
 *   plural(n, 'organização', 'organizações')     → "organizações"
 *   contar(n, 'processo', 'processos')           → "3 processos"
 */
export function plural(quantidade: number, singular: string, pluralForma: string): string {
  return Math.abs(quantidade) === 1 ? singular : pluralForma;
}

/** O número junto da palavra — o uso mais comum, num só lugar. */
export function contar(quantidade: number, singular: string, pluralForma: string): string {
  return `${quantidade} ${plural(quantidade, singular, pluralForma)}`;
}
