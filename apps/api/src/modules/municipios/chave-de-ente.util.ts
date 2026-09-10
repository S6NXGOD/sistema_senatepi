/**
 * A CHAVE DE TEXTO DE UM MUNICÍPIO — e por que ela tem nome próprio.
 *
 * Já existem DUAS `normalizarNome` neste repositório, com a mesma assinatura e
 * regras opostas: uma separa palavras, a outra COLA o nome. Trocá-las quebrou a
 * busca de partes em silêncio. Esta função não se chama `normalizar` nada: ela
 * responde a uma pergunta só — "que texto representa este município?" — e é
 * usada nos dois lados da comparação, no catálogo e no cadastro.
 *
 * `chaveDeEnte` é CANÔNICA: tira acento, baixa a caixa e transforma
 * pontuação em espaço. Nada mais. É ela que grava `nomeNormalizado` no catálogo,
 * então ela não pode inventar nada.
 *
 * A LIMPEZA DE ENTRADA SUJA é outra função, `chavesDoTexto`, e a separação
 * custou dois defeitos para ficar clara:
 *
 *  1. A primeira versão cortava o sufixo de UF com uma classe de caractere
 *     escrita dentro de template literal. O `\s` virou a letra "s", a classe
 *     virou `[s-]`, e "altos-pi" saía como "alto" — município que não existe,
 *     casamento perdido em silêncio.
 *
 *  2. Corrigido o escape, o corte passou a mutilar nome OFICIAL: **Sento Sé**,
 *     na Bahia (código 2930204), termina em "Sé", que é a sigla de Sergipe.
 *     Virava "sento". Conferido no catálogo inteiro: é o único caso em 5.571 —
 *     e um único caso já basta, porque quem mora lá simplesmente sumiria.
 *
 * A lição das duas é a mesma: cortar sufixo é uma HIPÓTESE sobre o que a pessoa
 * digitou, não um fato sobre o nome. Hipótese se testa depois da leitura
 * literal, nunca antes.
 */

/** As 27 siglas, para reconhecer o sufixo grudado no nome. */
const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

/**
 * O sufixo já sobre o texto NORMALIZADO — por isso só precisa do espaço, sem
 * classe de caractere e sem escape nenhum. Ver o defeito nº 1 no cabeçalho.
 */
const SUFIXO_UF = new RegExp(' (' + UFS.join('|') + ')$', 'i');

/** Tira acento e baixa a caixa — o primeiro passo dos dois lados. */
function semAcento(valor: string): string {
  return valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** Pontuação e apóstrofo viram espaço; espaços colapsam. */
function soPalavras(valor: string): string {
  return valor.replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * A CHAVE CANÔNICA. "Parnaíba" e "PARNAIBA" dão a mesma; "Sento Sé" dá
 * "sento se", inteirinho; "Teresina-PI" dá "teresina pi", porque é isso que o
 * texto diz — quem decide que o "pi" ali é a UF é `chavesDoTexto`.
 */
export function chaveDeEnte(valor: string | null | undefined): string {
  if (!valor) return '';
  return soPalavras(semAcento(valor));
}

/**
 * AS LEITURAS POSSÍVEIS de um texto de cidade digitado à mão, em ordem de
 * confiança.
 *
 * A primeira é sempre a leitura LITERAL — é ela que salva Sento Sé. A segunda só
 * existe quando o texto termina com algo que parece sigla de estado, e vem
 * acompanhada da UF que aquele sufixo sugere.
 *
 * Quem consome tenta na ordem e para no primeiro que casar com o catálogo.
 */
export function chavesDoTexto(
  valor: string | null | undefined,
): Array<{ chave: string; ufSugerida: string | null }> {
  const chave = chaveDeEnte(valor);
  if (!chave) return [];
  const leituras = [{ chave, ufSugerida: null as string | null }];
  const m = SUFIXO_UF.exec(chave);
  if (m) {
    const semSufixo = chave.replace(SUFIXO_UF, '').trim();
    if (semSufixo) leituras.push({ chave: semSufixo, ufSugerida: m[1].toUpperCase() });
  }
  return leituras;
}

/**
 * A SIGLA DA UF que dá para provar a partir de um texto.
 *
 * Aceita "PI", "pi", "Piauí" e "PIAUI"; recusa qualquer outra coisa devolvendo
 * `null`. Recusar é o comportamento certo: o cadastro tem "Teresina/PL" e
 * "TERESINA/MA", e adivinhar o que a pessoa quis dizer produziria uma ligação
 * errada com cara de certa.
 */
const POR_EXTENSO: Record<string, string> = {
  acre: 'AC', alagoas: 'AL', amapa: 'AP', amazonas: 'AM', bahia: 'BA',
  ceara: 'CE', 'distrito federal': 'DF', 'espirito santo': 'ES', goias: 'GO',
  maranhao: 'MA', 'mato grosso': 'MT', 'mato grosso do sul': 'MS',
  'minas gerais': 'MG', para: 'PA', paraiba: 'PB', parana: 'PR',
  pernambuco: 'PE', piaui: 'PI', 'rio de janeiro': 'RJ',
  'rio grande do norte': 'RN', 'rio grande do sul': 'RS', rondonia: 'RO',
  roraima: 'RR', 'santa catarina': 'SC', 'sao paulo': 'SP', sergipe: 'SE',
  tocantins: 'TO',
};

export function siglaDeUF(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const limpo = chaveDeEnte(valor);
  if (limpo.length === 2 && UFS.includes(limpo.toUpperCase())) return limpo.toUpperCase();
  return POR_EXTENSO[limpo] ?? null;
}

/**
 * Um código do IBGE tem 7 dígitos e começa pela região (1 a 5).
 *
 * O DataJud grava `5149` em dois processos — código interno de serventia, não
 * de município. Consultado no Tesouro, um código inválido devolve HTTP 200 com
 * os dados de OUTRO ente: o descarte tem de acontecer antes da consulta.
 */
export function pareceCodigoIBGE(codigo: number | null | undefined): boolean {
  return (
    typeof codigo === 'number' &&
    Number.isInteger(codigo) &&
    codigo >= 1_100_000 &&
    codigo <= 5_399_999
  );
}
