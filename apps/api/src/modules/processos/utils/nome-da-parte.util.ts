/**
 * O NOME DA PARTE, SEM O QUE É DO ATO E NÃO DELA.
 *
 * POR QUE ISTO EXISTE
 * ---------------------------------------------------------------------------
 * O tribunal numera e rotula os destinatários dentro do próprio campo do nome:
 *
 *   "1. MUNICÍPIO DE PALMEIRA DO PIAUÍ (RECORRENTE)"
 *   "2. SINDICATO DOS ENFERMEIROS (...) - SENATEPI (RECORRIDO)"
 *   "1. ESTADO DO PIAUÍ (AGRAVANTE)"
 *
 * Isso entrava na ficha como está. Em 31/10/2026 havia TRÊS partes gravadas
 * assim na produção — e as três no polo ERRADO, ao lado do sindicato, como se
 * o adversário fosse nosso litisconsorte.
 *
 * SÃO DUAS COISAS DIFERENTES, e por isso são duas funções:
 *
 *  · `limparNomeDaParte` tira o que é formatação — a ordem na lista e o papel
 *    recursal entre parênteses. O nome fica como a ficha deve guardá-lo.
 *
 *  · `temPapelRecursalNoNome` AVISA que aquele ato numera um recurso. Medido no
 *    acervo: nas 10 publicações em que o tribunal escreve o papel assim, o polo
 *    publicado discorda do polo da ficha em **10 de 10**. É sinal mais forte
 *    que a classe do ato, e vale mesmo quando a classe parece originária — foi
 *    o caso do dissídio coletivo do TJPI, autuado em 2º grau, com um agravo
 *    publicado por dentro.
 *
 * O QUE NÃO SE TIRA: parênteses que fazem parte do nome. "UNIÃO FEDERAL (AGU)"
 * e "SINDICATO DOS SERVIDORES PÚBLICOS FEDERAIS (SINDSEP-DF)" existem no
 * acervo, e cortar ali deixaria o nome pela metade. Só sai o que é PAPEL.
 */

/** A ordem do destinatário na lista do ato: "1. ", "2) ", "3 - ". */
const ORDINAL_NO_COMECO = /^\s*\d{1,2}\s*[.)\-]\s+/;

/**
 * O papel RECURSAL escrito entre parênteses no fim do nome.
 *
 * Só os recursais. AUTOR, RÉU e companhia não aparecem assim no acervo e, se
 * aparecessem, seriam informação boa — não é a eles que a desconfiança se
 * aplica.
 */
const PAPEL_RECURSAL_NO_FIM =
  /\s*\(\s*(RECORRENTE|RECORRIDA|RECORRIDO|AGRAVANTE|AGRAVADA|AGRAVADO|EMBARGANTE|EMBARGADA|EMBARGADO|APELANTE|APELADA|APELADO)\s*\)\s*$/i;

/**
 * Sobra de pontuação na ponta — o ".O ESTADO DO PIAUÍ" do acervo.
 *
 * O PONTO SÓ SAI NA FRENTE. Atrás ele quase sempre é abreviação, e tirá-lo
 * estraga o nome: "HAPVIDA ASSISTENCIA MEDICA S.A." viraria "… S.A", e são
 * quatro partes do acervo com esse final. Apanhado simulando a limpeza contra
 * a produção antes de gravar.
 */
const SUJEIRA_NA_FRENTE = /^[\s.,;:\-–—]+/;
const SUJEIRA_ATRAS = /[\s,;:\-–—]+$/;

export function temPapelRecursalNoNome(nome: unknown): boolean {
  return PAPEL_RECURSAL_NO_FIM.test(String(nome ?? ''));
}

export function limparNomeDaParte(nome: unknown): string {
  return String(nome ?? '')
    .replace(ORDINAL_NO_COMECO, '')
    .replace(PAPEL_RECURSAL_NO_FIM, '')
    .replace(SUJEIRA_NA_FRENTE, '')
    .replace(SUJEIRA_ATRAS, '')
    .replace(/\s+/g, ' ')
    .trim();
}
