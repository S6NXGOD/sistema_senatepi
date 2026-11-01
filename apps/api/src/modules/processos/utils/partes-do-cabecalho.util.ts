/**
 * QUEM ESTÁ DE CADA LADO, LIDO NO CABEÇALHO DO ATO.
 *
 * O Diário publica UMA comunicação POR DESTINATÁRIO, e só recebemos as cópias
 * endereçadas à nossa OAB. Num processo em que só o sindicato foi intimado,
 * `destinatarios` traz um nome só — e a ficha abre com um polo vazio.
 *
 * Foi o que o dono viu no 0753756-36.2022.8.18.0000 (dissídio coletivo de
 * greve CONTRA o sindicato): "Polo passivo — SENATEPI" preenchido, "Polo ativo
 * — quem pede" em branco. Não foi falha de leitura: quem pede nunca veio. As
 * duas publicações daquele processo são as duas cópias endereçadas aos nossos
 * advogados, e nenhuma delas cita o suscitante.
 *
 * SÓ QUE O PRÓPRIO ATO DIZ. O tribunal imprime o cabeçalho antes do teor:
 *
 *   "PROCESSO Nº: 0805944-21.2026.8.18.0176 CLASSE: PROCEDIMENTO DO JUIZADO
 *    ESPECIAL CÍVEL (436) ASSUNTO: [Direito de Imagem]
 *    AUTOR: CARLOS ALBERTO AMORIM DE SOUSA ANDRADE
 *    REU: ERICK RICCELY PEREIRA DO O, SINDICATO DOS ENFERMEIROS (...)"
 *
 * Medido nas 2.537 publicações do acervo em 31/10/2026: **78% trazem os dois
 * polos no cabeçalho**, e em 121 delas o cabeçalho nomeia justamente o lado
 * que a lista de destinatários não tem. É informação que já está no banco e
 * que hoje se joga fora.
 *
 * ISTO NÃO ESCREVE PARTE NENHUMA NO CADASTRO — devolve o que o ato diz, para
 * a tela CITAR e a pessoa decidir com um clique. A razão é a de sempre nesta
 * base: um nome que o tribunal escreveu junto com outro ("REU: FULANO,
 * SINDICATO DOS ENFERMEIROS, AUXILIARES E TECNICOS...") não dá para separar
 * pela vírgula, porque a vírgula também está DENTRO do nome. Gravar o palpite
 * seria um chute com cara de fato — o erro que esta base já pagou quando um
 * `else` de ternário escreveu o MPT como autor de um processo.
 */

/** Até onde o cabeçalho vai. Depois disto começa o teor, e lá "AUTOR" é prosa. */
const TAMANHO_DO_CABECALHO = 900;

/**
 * Os rótulos de polo, e de que lado cada um fica.
 *
 * RECORRENTE/RECORRIDO E AGRAVANTE/AGRAVADO FICAM DE FORA, pela mesma razão
 * que já está escrita em `de-quem-e-a-ordem.util`: são posição RECURSAL, não
 * polo da ação. Num recurso da empresa contra nós, o sindicato AUTOR é o
 * RECORRIDO — mapeá-los pelo polo trocaria os dois lados da ficha.
 */
const ROTULOS: { re: RegExp; polo: 'A' | 'P' }[] = [
  { re: /\bPOLO\s+ATIVO\s*:/g, polo: 'A' },
  { re: /\bPOLO\s+PASSIVO\s*:/g, polo: 'P' },
  { re: /\bAUTOR(?:A|ES|AS)?\s*:/g, polo: 'A' },
  { re: /\bR[EÉ]US?\s*:/g, polo: 'P' },
  { re: /\bRECLAMANTES?\s*:/g, polo: 'A' },
  { re: /\bRECLAMAD[AO]S?\s*:/g, polo: 'P' },
  { re: /\bEXEQUENTES?\s*:/g, polo: 'A' },
  { re: /\bEXECUTAD[AO]S?\s*:/g, polo: 'P' },
  { re: /\bREQUERENTES?\s*:/g, polo: 'A' },
  { re: /\bREQUERID[AO]S?\s*:/g, polo: 'P' },
  { re: /\bIMPETRANTES?\s*:/g, polo: 'A' },
  { re: /\bIMPETRAD[AO]S?\s*:/g, polo: 'P' },
  { re: /\bSUSCITANTES?\s*:/g, polo: 'A' },
  { re: /\bSUSCITAD[AO]S?\s*:/g, polo: 'P' },
  { re: /\bEMBARGANTES?\s*:/g, polo: 'A' },
  { re: /\bEMBARGAD[AO]S?\s*:/g, polo: 'P' },
  /*
    CONSIGNAÇÃO EM PAGAMENTO — quem consigna é o AUTOR.

    Faltava, e não era detalhe: os dois únicos processos de consignação do
    acervo (15 publicações) são exatamente os dois em que a ficha tem os polos
    trocados. O ato escreve, com todas as letras, "CONSIGNANTE: MUNICIPIO DE
    COCAL  CONSIGNATÁRIO: SINDICATO (...) E OUTROS (4)" — o município move, os
    sindicatos respondem — e a ficha diz que o autor somos nós.

    Varri os 2.537 textos atrás de outros rótulos de parte que eu ignorasse:
    estes dois eram os únicos. LITISCONSORTE, ASSISTENTE, DENUNCIADO e
    TERCEIRO INTERESSADO não aparecem em nenhuma publicação do acervo.
  */
  { re: /\bCONSIGNANTES?\s*:/g, polo: 'A' },
  { re: /\bCONSIGNAT[AÁ]RI[AO]S?\s*:/g, polo: 'P' },
];

/**
 * O que ENCERRA o nome, quando não vem outro rótulo depois.
 *
 * O cabeçalho acaba e o teor começa sem aviso. Sem estes cortes, o "nome" do
 * réu seguiria por dentro do despacho inteiro.
 *
 * `DESTINATÁRIO` E `REPRESENTANTE` ESTÃO AQUI por medição, não por teoria: o
 * TRF1 escreve "POLO PASSIVO: MUNICIPIO DE JOAQUIM PIRES e outros
 * Destinatários: SINDICATO DOS ENFERMEIROS (...)" e, sem o corte, o réu do
 * processo saía com o nome do próprio sindicato grudado no fim. "e outros"
 * FICA de propósito — é o ato avisando que a lista não acabou, e quem lê
 * precisa dessa ressalva.
 */
const FIM_DO_NOME =
  /\b(ADVOGAD[AO]|PROCURADOR|OAB|DEFENSOR|PERIT[AO]|TESTEMUNHA|DESTINAT[AÁ]RIOS?|REPRESENTANTES?|CARTA D[EO]|MANDADO D[EO]|OF[IÍ]CIO|INTIMA[CÇ][AÃ]O|CITA[CÇ][AÃ]O|NOTIFICA[CÇ][AÃ]O|AUDI[EÊ]NCIA|PER[IÍ]CIA|FICA[MR]?\b|DESPACHO|DECIS[AÃ]O|SENTEN[CÇ]A|AC[OÓ]RD[AÃ]O|CERTID[AÃ]O|EDITAL|ATO ORDINAT[OÓ]RIO|VISTOS|PODER JUDICI[AÁ]RIO|CENTRO JUDICI[AÁ]RIO|CEJUSC|E-?MAIL|TEL\.|JUSTI[CÇ]A D|TRIBUNAL|ASSUNTO|CLASSE|PROCESSO|[OÓ]RG[AÃ]O|VALOR DA CAUSA|DATA DE|FINALIDADE|PRAZO|TIPO D[EO]|N[UÚ]MERO)\b/i;

/** Um nome de parte não passa disto; o que passa é teor vazando. */
const MAXIMO_DO_NOME = 180;
/** Abaixo disto não é nome de gente nem de empresa — é sobra de corte. */
const MINIMO_DO_NOME = 4;

export interface ParteDoCabecalho {
  /** 'A' ou 'P', no mesmo alfabeto que o DJEN usa em `destinatarios`. */
  polo: 'A' | 'P';
  /** O trecho como o tribunal escreveu — pode conter mais de um nome. */
  nome: string;
  /** O rótulo que o ato usou ("AUTOR", "SUSCITANTE"), para a tela poder citar. */
  rotulo: string;
}

/** Tira o lixo das pontas sem mexer no miolo: o nome é do tribunal, não nosso. */
function limpar(bruto: string): string {
  return bruto
    .replace(/\s+/g, ' ')
    .replace(/^[\s:,;.‐-―-]+/, '')
    .replace(/[\s:,;.‐-―-]+$/, '')
    .trim();
}

/**
 * O que o cabeçalho do ato diz sobre cada polo.
 *
 * Devolve no máximo um trecho por polo — o PRIMEIRO rótulo daquele lado. Um
 * cabeçalho que repete "RÉU:" três vezes está listando três réus, e juntá-los
 * numa string só seria pior que mostrar o primeiro e deixar a pessoa abrir o
 * ato. Lista vazia quando o cabeçalho não nomeia ninguém — e isso acontece em
 * 22% das publicações do acervo.
 */
export function lerPartesDoCabecalho(texto: string | null | undefined): ParteDoCabecalho[] {
  const cabecalho = String(texto ?? '')
    .replace(/\s+/g, ' ')
    .slice(0, TAMANHO_DO_CABECALHO);
  if (!cabecalho) return [];

  // 1. Todas as marcas de rótulo, na ordem em que aparecem no cabeçalho.
  const marcas: { inicio: number; fim: number; polo: 'A' | 'P'; rotulo: string }[] = [];
  for (const { re, polo } of ROTULOS) {
    re.lastIndex = 0;
    for (const m of cabecalho.matchAll(re)) {
      marcas.push({
        inicio: m.index ?? 0,
        fim: (m.index ?? 0) + m[0].length,
        polo,
        rotulo: m[0].replace(/\s*:$/, '').trim(),
      });
    }
  }
  if (!marcas.length) return [];
  marcas.sort((a, b) => a.inicio - b.inicio);

  /*
    2. O NOME VAI ATÉ O PRÓXIMO RÓTULO.

    "POLO ATIVO:" e "AUTOR:" podem casar perto um do outro, e uma marca que
    começa DENTRO da anterior é a mesma coisa lida duas vezes — descartá-la
    evita que o nome de uma linha vire dois pedaços.
  */
  const achados: ParteDoCabecalho[] = [];
  const jaTemOPolo = new Set<'A' | 'P'>();
  for (let i = 0; i < marcas.length; i++) {
    const marca = marcas[i];
    if (i > 0 && marca.inicio < marcas[i - 1].fim) continue;
    if (jaTemOPolo.has(marca.polo)) continue;

    const proxima = marcas.slice(i + 1).find((x) => x.inicio >= marca.fim);
    const ateRotulo = proxima ? proxima.inicio : cabecalho.length;
    let span = cabecalho.slice(marca.fim, Math.min(ateRotulo, marca.fim + MAXIMO_DO_NOME));

    // 3. E até onde o cabeçalho deixa de ser cabeçalho.
    const corte = FIM_DO_NOME.exec(span);
    if (corte) span = span.slice(0, corte.index);

    const nome = limpar(span);
    // Sem letra não é nome: é número de processo, data ou código de classe.
    if (nome.length < MINIMO_DO_NOME || !/[A-Za-zÀ-ÿ]{3}/.test(nome)) continue;

    jaTemOPolo.add(marca.polo);
    achados.push({ polo: marca.polo, nome, rotulo: marca.rotulo });
  }
  return achados;
}

/**
 * O LADO QUE FALTA — o que a tela de importação precisa saber.
 *
 * Recebe os polos que os destinatários já cobriram e devolve só o que ficou
 * vazio. Quando os dois vieram do Diário não há nada a citar: o que o ato diz
 * no cabeçalho já está na ficha, e repetir seria barulho.
 */
export function completarPolosQueFaltam(
  texto: string | null | undefined,
  polosQueJaTemos: Iterable<string | null | undefined>,
): ParteDoCabecalho[] {
  const temos = new Set<string>();
  for (const p of polosQueJaTemos) {
    const v = String(p ?? '')
      .trim()
      .toUpperCase();
    if (v === 'A' || v === 'P') temos.add(v);
  }
  if (temos.size >= 2) return [];
  return lerPartesDoCabecalho(texto).filter((x) => !temos.has(x.polo));
}
