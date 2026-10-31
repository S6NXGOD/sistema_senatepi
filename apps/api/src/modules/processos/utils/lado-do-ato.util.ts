/**
 * O LADO QUE O DIÁRIO INFORMA É O DA AÇÃO — OU O DO RECURSO?
 *
 * POR QUE ISTO EXISTE
 * ---------------------------------------------------------------------------
 * Toda publicação do DJEN traz `destinatarios: [{ nome, polo }]`, e esse `polo`
 * é a posição da parte NAQUELE ato. Quando o ato é um recurso, a posição é a
 * RECURSAL: quem perdeu em primeiro grau e recorreu aparece como `A`, mesmo
 * tendo sido réu da ação. Copiar isso para a ficha inverte o processo.
 *
 * A dúvida é velha e já custou caro (ver `de-quem-e-a-ordem.util`, onde
 * EMBARGADO e AGRAVADO estavam nos mapas de polo e dispensaram uma contrarrazão
 * nossa). O que faltava era saber QUANDO confiar — e isso dá para medir.
 *
 * MEDIÇÃO NA PRODUÇÃO (31/10/2026, 1.956 publicações do acervo em que o próprio
 * sindicato é destinatário com um lado só, confrontadas com o polo gravado na
 * ficha):
 *
 *   classe originária, NPU de 1º grau .... 1.314 acertos / 38 erros .... 97,2%
 *   classe originária, NPU de 2º grau ....     7 acertos /  0 erros ... 100,0%
 *   classe de recurso, NPU de 2º grau ....    10 acertos /  0 erros ... 100,0%
 *   classe de recurso, NPU de 1º grau ....   230 acertos / 357 erros ... 39,2%
 *
 * Só UMA das quatro faixas é ruim, e é ruim de um jeito específico: pior que
 * moeda ao ar. E ela tem explicação inteira — é o recurso noticiado DENTRO do
 * número da ação de origem. O registro é a ação; o ato numera o recurso; os
 * dois discordam por construção.
 *
 * Quando o recurso tem número próprio (`...0000`, autuado no tribunal), o
 * registro É o recurso, e aí a posição recursal é a posição certa.
 *
 * O QUE ESTA FUNÇÃO NÃO FAZ: adivinhar o lado certo quando ele não vale. Ela
 * só responde "dá para usar isto?" — quem não pode usar manda o nome para a
 * fila de dúvida, com a frase pronta para alguém ler e decidir.
 */

/** Sem acento, maiúsculo, só letras e números — a mesma régua do resto do módulo. */
function normalizar(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[^\x00-\x7F]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * As classes em que o tribunal numera os polos do RECURSO.
 *
 * Fronteira de palavra em cada termo, e as formas plurais escritas à mão: um
 * `\bAPELAC\b` não casa "APELACAO", e foi exatamente assim que a primeira
 * medição deste arquivo escondeu 14 publicações dentro do balde errado.
 */
const CLASSE_DE_RECURSO =
  /\b(RECURSO|RECURSOS|AGRAVO|AGRAVOS|APELACAO|APELACOES|EMBARGOS|REEXAME|CORREICAO|REMESSA NECESSARIA|CONFLITO DE COMPETENCIA)\b/;

export function ehClasseDeRecurso(nomeClasse: unknown): boolean {
  return CLASSE_DE_RECURSO.test(normalizar(nomeClasse));
}

/**
 * O processo foi autuado no próprio tribunal (2º grau)?
 *
 * Posições 17–20 do NPU são a ORIGEM: `0000` significa "o tribunal", e não uma
 * vara. Número curto demais não responde nada — devolve `false`, que é o lado
 * conservador (trata como 1º grau e desconfia do recurso).
 */
export function ehNumeroDeSegundoGrau(numeroProcesso: unknown): boolean {
  const n = String(numeroProcesso ?? '').replace(/\D/g, '');
  return n.length === 20 && n.slice(16, 20) === '0000';
}

export interface LadoDoAto {
  /** `true` quando o polo do ato pode posicionar a parte na ficha. */
  daAcao: boolean;
  /** Frase pronta para a tela. Vazia quando `daAcao` é verdadeiro. */
  porque: string;
}

export function ladoDoAtoEhDaAcao(nomeClasse: unknown, numeroProcesso: unknown): LadoDoAto {
  if (!ehClasseDeRecurso(nomeClasse)) return { daAcao: true, porque: '' };
  if (ehNumeroDeSegundoGrau(numeroProcesso)) return { daAcao: true, porque: '' };
  return {
    daAcao: false,
    porque:
      'este ato é um recurso dentro do número da ação de origem — o Diário numera os lados do ' +
      'RECURSO, e quem recorreu aparece como autor mesmo tendo sido réu',
  };
}
