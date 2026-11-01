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

/**
 * O FECHO DO ANÚNCIO — a prévia acaba numa frase, não no meio de uma palavra.
 *
 * O recorte era o pedaço cru da regex, cortado no caractere 170. Na produção
 * de 29/10/2026 isso saía assim:
 *
 *   "...sob pena de multa no valor de R$ 5.000,00. TERESINA/PI, 23 de"
 *
 * Duas coisas erradas numa linha só: a ASSINATURA do juízo entrou na prévia
 * (cidade e data não dizem nada sobre a ordem) e a frase termina em "23 de".
 *
 * Três cortes, nesta ordem:
 *  1. a assinatura — "TERESINA/PI, 23 de outubro de 2026" e variantes;
 *  2. a última frase inteira, quando sobra prévia suficiente depois dela;
 *  3. a última palavra inteira, com reticências, quando não houve frase.
 */
const RE_ASSINATURA_DO_JUIZO =
  /\s*[A-ZÀ-Ú][A-ZÀ-ÚÀ-Ü .]{2,28}\s?[-/]\s?[A-Z]{2},\s*\d{1,2}\s+de\s+\p{L}+.*$/iu;

/** Abreviações que terminam em ponto e NÃO fecham a frase num despacho. */
const RE_ABREVIACAO = /\b(art|arts|inc|incs|al|par|§|n|no|nº|fl|fls|id|cf|cc|clt|cpc|cpp|ltda|me|epp|dr|dra|sr|sra|v|exmo|proc)\.$/i;

/** O último ponto que realmente fecha uma frase, ou -1. */
function acharFimDeFrase(t: string): number {
  for (let i = t.lastIndexOf('. '); i > 0; i = t.lastIndexOf('. ', i - 1)) {
    if (!RE_ABREVIACAO.test(t.slice(0, i + 1))) return i;
  }
  return -1;
}

export function fecharTrecho(bruto: string): string {
  let t = bruto.replace(RE_ASSINATURA_DO_JUIZO, '').trim();

  /*
    A ÚLTIMA FRASE INTEIRA — mas só se o que sobrar ainda informar. Cortar
    "Intime-se o reclamado para apresentar os documentos, no prazo de 5 dias"
    no primeiro ponto deixaria duas palavras, e duas palavras não ajudam
    ninguém: por isso o corte só vale acima de 60% do que havia.

    E NEM TODO PONTO FECHA FRASE. "apresentem quesitos complementares (art.
    465, § 1º" foi cortado em "(art." na primeira versão — o ponto da
    abreviação parecia fim de frase. A lista cobre as que o despacho usa.
  */
  const ponto = acharFimDeFrase(t);
  if (ponto > 0 && ponto >= t.length * 0.6) t = t.slice(0, ponto + 1);

  // Cortado no meio de uma palavra? Volta até o espaço e assume as reticências.
  if (!/[.!?]$/.test(t)) {
    const espaco = t.lastIndexOf(' ');
    if (espaco > MINIMO_UTIL) t = `${t.slice(0, espaco).replace(/[,;:\s]+$/, '')}…`;
  }
  return t.trim();
}

/**
 * "FICA V. SA. INTIMADO PARA TOMAR CIÊNCIA DO DESPACHO ID 7d684b3" — e daí?
 *
 * É o cabeçalho de praxe de todo ato do TRT: avisa que existe algo para ler e
 * não manda fazer coisa nenhuma. Ele casa com o segundo padrão de ordem e,
 * sendo o primeiro a aparecer no texto, ficava com o recorte inteiro — gastando
 * os 150 caracteres no aviso e no ID do documento, enquanto o DESPACHO logo
 * atrás dizia o que o juízo determinou.
 *
 * Medido em 31/10/2026 sobre as 1.952 publicações com recorte: **1.128 (58%)**
 * eram só isto, e 43 delas viraram tarefa ou proposta na agenda de alguém. O
 * caso que apareceu na conferência: "Recebo o Agravo de Petição interposto
 * pela…" — cortado exatamente antes de "A parte reclamante fica intimada para
 * apresentar impugnação em oito dias", que era a única linha que interessava.
 */
const SO_TOMAR_CIENCIA =
  /^FICA[M]?\s.{0,30}INTIMAD[OA]S?(\(A\))?\s+(PARA\s+)?(TOMAR\s+)?CI[EÊ]NCIA/i;

export function trechoDaOrdem(texto: string): string | null {
  /*
    O DISPOSITIVO TAMBÉM PASSA PELO FECHO. Ele saía cru — e terminava em
    "deverá o MUNICÍPIO DE JOAQUIM PIRES/PI " no caso real de 29/10/2026,
    com espaço no fim e sem reticência nenhuma dizendo que havia mais.
  */
  const dispositivo = dispositivoDoJulgado(texto || '');
  if (dispositivo) return fecharTrecho(dispositivo);

  const t = (texto || '').replace(/\s+/g, ' ');
  const achar = (onde: string): { trecho: string; fim: number } | null => {
    for (const re of PADROES_DE_ORDEM) {
      const m = re.exec(onde);
      if (!m) continue;
      const trecho = fecharTrecho(m[0].trim());
      if (trecho.length > MINIMO_UTIL) return { trecho, fim: (m.index ?? 0) + m[0].length };
    }
    return null;
  };

  const primeiro = achar(t);
  if (!primeiro) return null;
  if (!SO_TOMAR_CIENCIA.test(primeiro.trecho)) return primeiro.trecho;

  /*
    O AVISO DE PRAXE FICA DE RESERVA, NUNCA SE PERDE.

    Procura-se a ordem de verdade DEPOIS dele; se o que vem atrás também for
    só ciência (ou não houver nada), volta o primeiro. Um recorte fraco é
    melhor que recorte nenhum — sem ele a tarefa não cita o ato, e foi a
    ausência dessa citação que o dono apontou em 29/10/2026.
  */
  const depois = achar(t.slice(primeiro.fim));
  if (depois && !SO_TOMAR_CIENCIA.test(depois.trecho)) return depois.trecho;
  return primeiro.trecho;
}
