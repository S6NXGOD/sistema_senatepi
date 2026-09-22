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
import { MARCAS_DE_DISPOSITIVO } from './providencia.util';

const PADROES_DE_ORDEM: RegExp[] = [
  // Quebra de linha fora do intervalo: a ordem termina no fim do parágrafo.
  /(INTIME[- ]?SE|INTIMEM[- ]?SE|NOTIFIQUE[- ]?SE|CITE[- ]?SE)[^;:\n]{0,170}/i,
  // O intervalo aceita PONTO de propósito — ver o comentário acima.
  /FICA[M]?\s[^;:\n]{0,24}INTIMAD[OA]S?(\(A\))?[^;:\n]{0,150}/i,
  /\b(RECEBO|DEFIRO|INDEFIRO|HOMOLOGO|JULGO|DETERMINO|CONHECO|CONHEÇO)\b[^;:\n]{0,160}/i,
];

/** Recorte mínimo para informar. Duas palavras não ajudam ninguém a decidir. */
const MINIMO_UTIL = 20;

/**
 * As mesmas marcas e o mesmo corte do classificador — ver `providencia.util`.
 *
 * Duplicar a LISTA aqui seria a segunda implementação da mesma regra. O que se
 * repete é só o nome: as marcas vêm de lá.
 */
const MIN_JULGADO = 5_000;

/** Teto da prévia: a decisão cabe numa frase; o resto o advogado abre. */
const MAX_DA_PREVIA = 200;

/**
 * NUM JULGADO LONGO, A PRÉVIA É O DISPOSITIVO — 22/09/2026.
 *
 * Os três padrões acima procuram o verbo no texto INTEIRO, e num acórdão isso
 * acha o verbo errado. Medido no acórdão de 48.864 caracteres que virou tarefa
 * indevida: a prévia saía *"conheço do recurso ordinário. 2 - MÉRITO AÇÃO DE
 * CONSIGNAÇÃO..."* — um pedaço do relatório. E o que a pessoa precisava ler
 * eram as dez palavras do fim: *"negar-lhe provimento"*.
 *
 * Comparado nas 172 publicações longas da produção, o ganho é grosseiro:
 *
 *   hoje                                          → dispositivo
 *   "Intimem-se. Teresina - PI, datada e assinada" → "JULGO IMPROCEDENTES os pedidos"
 *   "Fica V. Sa. intimado para tomar ciência…"     → "NEGO PROVIMENTO ao recurso da reclamada"
 *   (sem prévia nenhuma)                           → "nego provimento ao agravo de instrumento"
 *
 * O QUE EU NÃO FIZ, e por quê: aplicar o corte ANTES dos padrões faria 95 das
 * 172 ficarem SEM prévia — o dispositivo raramente contém "INTIME-SE" ou "FICA
 * INTIMADO". Por isso o dispositivo não filtra os padrões; ele os SUBSTITUI,
 * e só no julgado longo.
 */
function dispositivoDoJulgado(texto: string): string | null {
  if (texto.length < MIN_JULGADO) return null;

  const norm = texto
    .normalize('NFD')
    // Os diacríticos combinantes, escritos por código: colados na regex eles
    // ficam invisíveis no editor e o próximo a mexer apaga sem ver.
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase();
  /*
    O índice do texto normalizado vale no ORIGINAL porque NFD expande o
    acentuado em base+diacrítico e a remoção devolve ao tamanho de antes. A
    guarda existe para o dia em que alguma normalização a mais quebrar isso —
    sem ela, o recorte sairia deslocado e ninguém veria o erro.
  */
  if (norm.length !== texto.length) return null;

  let corte = -1;
  for (const marca of MARCAS_DE_DISPOSITIVO) {
    const i = norm.lastIndexOf(marca);
    if (i > corte) corte = i;
  }
  if (corte < 0) return null;

  const fim = texto.slice(corte).replace(/\s+/g, ' ').trim();
  return fim.length > MINIMO_UTIL ? fim.slice(0, MAX_DA_PREVIA) : null;
}

export function trechoDaOrdem(texto: string): string | null {
  const dispositivo = dispositivoDoJulgado(texto || '');
  if (dispositivo) return dispositivo;

  const t = (texto || '').replace(/\s+/g, ' ');
  for (const re of PADROES_DE_ORDEM) {
    const m = re.exec(t);
    if (!m) continue;
    const trecho = m[0].trim();
    if (trecho.length > MINIMO_UTIL) return trecho;
  }
  return null;
}
