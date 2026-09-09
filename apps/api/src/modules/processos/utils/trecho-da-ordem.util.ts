/**
 * O TRECHO DA ORDEM — a prévia que faz a decisão durar um segundo.
 *
 * A caixa de entrada pergunta ao advogado "isto é seu?". A pergunta só é barata
 * se ele puder responder sem abrir nada, e para isso a tela precisa mostrar a
 * frase certa: nem o teor inteiro (2.476 caracteres no caso médio — isso é
 * pedir leitura), nem o rótulo da providência (isso é pedir fé).
 *
 * TRÊS PADRÕES, DO MAIS INFORMATIVO AO MENOS — e os três saíram de simular
 * contra a produção, não de imaginar:
 *
 *  1. `INTIME-SE A RECLAMADA…` — diz QUEM deve agir, que é a pergunta inteira.
 *  2. `Fica V. Sa. intimado…` — é como o TRT22 escreve na maioria dos atos.
 *  3. `RECEBO os embargos…`, `DEFIRO`, `HOMOLOGO` — o verbo da decisão. Não diz
 *     de quem é o prazo, mas diz o que aconteceu, e isso já basta para alguém
 *     reconhecer o próprio caso.
 *
 * O ERRO QUE A SIMULAÇÃO PEGOU
 * A primeira versão tinha um só padrão, com o intervalo escrito como `[^.;:]` —
 * e "V. Sa." tem dois pontos. Resultado: **34 das 40 propostas** ficavam sem
 * prévia, e a caixa mostraria o começo do teor, que em 83% dos casos são 302
 * caracteres de "PODER JUDICIÁRIO JUSTIÇA DO TRABALHO…". A funcionalidade
 * inteira dependia de um caractere na classe negada.
 *
 * Devolve `null` quando nenhum padrão casa. Aí a tela mostra o corpo do ato SEM
 * o timbre — `separarTimbre`, que o lado web já tem e já testa. Uma regra, um
 * dono: não existe terceira cópia da lógica do timbre aqui.
 */
const PADROES_DE_ORDEM: RegExp[] = [
  // Quebra de linha fora do intervalo: a ordem termina no fim do parágrafo.
  /(INTIME[- ]?SE|INTIMEM[- ]?SE|NOTIFIQUE[- ]?SE|CITE[- ]?SE)[^;:\n]{0,170}/i,
  // O intervalo aceita PONTO de propósito — ver o comentário acima.
  /FICA[M]?\s[^;:\n]{0,24}INTIMAD[OA]S?(\(A\))?[^;:\n]{0,150}/i,
  /\b(RECEBO|DEFIRO|INDEFIRO|HOMOLOGO|JULGO|DETERMINO|CONHECO|CONHEÇO)\b[^;:\n]{0,160}/i,
];

/** Recorte mínimo para informar. Duas palavras não ajudam ninguém a decidir. */
const MINIMO_UTIL = 20;

export function trechoDaOrdem(texto: string): string | null {
  const t = (texto || '').replace(/\s+/g, ' ');
  for (const re of PADROES_DE_ORDEM) {
    const m = re.exec(t);
    if (!m) continue;
    const trecho = m[0].trim();
    if (trecho.length > MINIMO_UTIL) return trecho;
  }
  return null;
}
