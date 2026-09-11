import { formatarDataBR } from '../processos/utils/data-br.util';

/**
 * O QUE UM PERCENTUAL DECLARADO SIGNIFICA — e quando ele não significa nada.
 *
 * O SICONFI publica o que o MUNICÍPIO declarou. Ele confere a aritmética, não a
 * verdade: se a prefeitura informar uma folha maior que a própria receita, a API
 * devolve o percentual absurdo com a mesma cara de dado bom.
 *
 * MEDIDO EM 10/09/2026, nos 58 municípios do universo do SENATEPI que
 * publicaram o RGF: TRÊS declararam despesa de pessoal acima de 100% da receita
 * corrente líquida — Esperantina 360,24%, Redenção do Gurguéia 326,88% e Castelo
 * do Piauí 243,94%. São 5% da base. Conferido na origem: Esperantina declarou
 * R$ 112.109.827,61 de folha em doze meses contra uma RCL de R$ 31.120.559,07,
 * com um mês isolado (`MR-4`) três vezes maior que os outros onze — erro de
 * digitação no preenchimento, não colapso fiscal.
 *
 * POR QUE ISTO É REGRA DE PRODUTO, E NÃO DETALHE. O sindicato leva este número
 * para a mesa. Chegar afirmando que o município gasta 360% da receita com
 * pessoal seria desmentido no mesmo minuto, e junto com a afirmação errada cai a
 * credibilidade dos números certos. Um dado que não se pode defender é pior que
 * dado nenhum.
 *
 * O QUE SE FAZ COM ELE: guarda-se o valor exato como veio — reescrever a
 * declaração de um ente público seria falsificá-la —, e a leitura o classifica
 * como INCONSISTENTE. A tela mostra que a declaração não fecha, com os dois
 * números que provam isso, em vez de mostrar um indicador. Saber que o RGF
 * daquele município é imprestável também é informação útil: significa que a
 * prefeitura não pode usá-lo como argumento.
 */

export type SituacaoFiscal =
  /** Abaixo do limite de alerta (90% do teto). Nada a dizer. */
  | 'REGULAR'
  /** Passou do alerta, ainda abaixo do prudencial. */
  | 'ALERTA'
  /**
   * Passou do limite prudencial (95% do teto). O art. 22, parágrafo único, da
   * LRF proíbe conceder aumento, criar cargo e contratar enquanto durar.
   */
  | 'PRUDENCIAL'
  /** Passou do teto legal (54% da RCL no Executivo municipal). */
  | 'ACIMA_DO_TETO'
  /** A declaração não fecha — ver o cabeçalho deste arquivo. */
  | 'INCONSISTENTE'
  /**
   * PERGUNTAMOS E O ENTE NÃO PUBLICOU o relatório no período. É uma
   * irregularidade DELE — e um argumento, não uma lacuna nossa.
   */
  | 'SEM_DADO'
  /**
   * AINDA NÃO PERGUNTAMOS. Tarefa nossa, não falha do ente.
   *
   * Os dois casos são indistinguíveis no banco — em ambos falta a linha de
   * indicador. A ficha do Governo do Piauí chegou a afirmar "o município não
   * publicou" sobre um ente que não é município e que tinha publicado 37,00%.
   * Confundir os dois é o sistema acusando alguém no lugar de admitir o
   * próprio atraso.
   */
  | 'NAO_CONSULTADO';

/**
 * Acima disto a declaração é aritmeticamente impossível de sustentar: gastar
 * mais com folha do que toda a receita corrente líquida do ano.
 *
 * O corte é 100 e não 60 de propósito. Estourar o teto de 54% acontece de
 * verdade e com frequência — na mesma medição, Altos (56,52%), Barras (54,25%)
 * e Campo Maior (54,22%) estão acima do teto e são declarações plausíveis, que
 * o sindicato PRECISA ver. Um corte apertado esconderia justamente os casos
 * reais que interessam.
 */
export const PERCENTUAL_IMPOSSIVEL = 100;

export interface LeituraPessoal {
  percentualRcl: number | null;
  limiteMaximo: number | null;
  limitePrudencial: number | null;
  limiteAlerta: number | null;
}

/**
 * A situação de um município, a partir dos limites que a PRÓPRIA API informou.
 *
 * Os limites não estão cravados em 54 / 51,3 / 48,6 porque eles mudam conforme
 * a esfera e o poder — o Legislativo municipal tem 6%, o Executivo 54%. Um
 * número chumbado no código classificaria errado no dia em que o módulo passasse
 * a ler câmara municipal, e o erro seria silencioso.
 */
export function situacaoFiscal(
  l: LeituraPessoal | null | undefined,
  /** Quando o Tesouro foi perguntado. Nulo = nunca. Ver `NAO_CONSULTADO`. */
  consultadoEm?: Date | null,
): SituacaoFiscal {
  const pct = l?.percentualRcl;
  if (pct === null || pct === undefined) {
    return consultadoEm ? 'SEM_DADO' : 'NAO_CONSULTADO';
  }
  if (pct > PERCENTUAL_IMPOSSIVEL) return 'INCONSISTENTE';
  if (l?.limiteMaximo != null && pct >= l.limiteMaximo) return 'ACIMA_DO_TETO';
  if (l?.limitePrudencial != null && pct >= l.limitePrudencial) return 'PRUDENCIAL';
  if (l?.limiteAlerta != null && pct >= l.limiteAlerta) return 'ALERTA';
  return 'REGULAR';
}

/**
 * A CONSEQUÊNCIA PRÁTICA, em uma frase — é isto que vai para a tela, e não a
 * sigla. Quem abre a ficha do município antes de uma negociação precisa da
 * resposta ("pode ou não pode conceder aumento?"), não da classificação.
 */
/*
  AS EXCEÇÕES DO ART. 22 NÃO SÃO RODAPÉ — são o argumento do sindicato.

  A frase anterior dizia "proibido de conceder aumento, criar cargo e contratar
  — exceto reposição em saúde, educação e segurança". Estava incompleta do jeito
  mais caro: o inciso I do parágrafo único ressalva a REVISÃO GERAL ANUAL (art.
  37, X, da Constituição) e o que decorre de sentença judicial ou de lei. É
  exatamente o que a prefeitura omite quando diz "estou no prudencial, não posso
  dar nada" — e a tela repetia a omissão.
*/
export function oQueIssoSignifica(s: SituacaoFiscal): string {
  switch (s) {
    case 'ACIMA_DO_TETO':
      return 'Acima do teto da Lei de Responsabilidade Fiscal: valem todas as proibições do limite prudencial — com as mesmas exceções, como a revisão geral anual — e o ente ainda tem prazo para eliminar o excesso, sob pena de perder transferências voluntárias e crédito.';
    case 'PRUDENCIAL':
      return 'Acima do limite prudencial: pelo art. 22, parágrafo único, da LRF, o ente está proibido de conceder aumento ou reajuste, criar cargo, alterar carreira com aumento de despesa e contratar. Continuam permitidos a revisão geral anual (art. 37, X, da Constituição), o que decorre de sentença judicial ou de lei, e a reposição de aposentados e falecidos em saúde, educação e segurança.';
    case 'ALERTA':
      return 'No limite de alerta: passou de 90% do teto. Pelos limites, ainda pode conceder aumento, mas o Tribunal de Contas já é obrigado a alertar formalmente o ente.';
    /*
      "PELOS LIMITES", E NÃO "A LRF NÃO IMPEDE". A frase antiga era falsa para o
      Governo do Piauí em setembro de 2026, com o percentual certo (37%): nos
      180 dias antes do fim do mandato o art. 21 torna nulo o aumento, dentro
      ou fora dos limites. Ver `avisoDoCalendario`.
    */
    case 'REGULAR':
      return 'Dentro dos limites de despesa da Lei de Responsabilidade Fiscal (art. 22) — não há impedimento por esses limites para conceder aumento. No fim do mandato e em ano de eleição valem outras regras, e a ficha avisa quando for o caso.';
    case 'INCONSISTENTE':
      return 'A declaração enviada ao Tesouro não fecha: a despesa com pessoal informada supera a receita do período. O número não serve de argumento para nenhum dos dois lados enquanto o município não retificar.';
    case 'SEM_DADO':
      return 'Este ente não publicou o Relatório de Gestão Fiscal no período consultado — deixar de publicar é, por si, uma irregularidade prevista na Lei de Responsabilidade Fiscal.';
    case 'NAO_CONSULTADO':
    default:
      return 'Os indicadores deste ente ainda não foram buscados no Tesouro Nacional — não é falha do ente. A consulta da madrugada passa por onde o sindicato atua e pelos municípios do estado; quem pode editar também pode buscar na hora, por esta ficha.';
  }
}

/** Ordem de gravidade, para ordenar uma lista pelo que pede atenção primeiro. */
export const PESO_SITUACAO: Record<SituacaoFiscal, number> = {
  ACIMA_DO_TETO: 0,
  PRUDENCIAL: 1,
  ALERTA: 2,
  INCONSISTENTE: 3,
  REGULAR: 4,
  SEM_DADO: 5,
  NAO_CONSULTADO: 6,
};

/** Situações em que o percentual é um número que se pode levar à mesa. */
const COM_NUMERO_VALIDO: SituacaoFiscal[] = ['REGULAR', 'ALERTA', 'PRUDENCIAL', 'ACIMA_DO_TETO'];

export interface Folga {
  /** Em reais, nos mesmos 12 meses do relatório. Negativo = passou do prudencial. */
  valor: number;
  /** Quanto a folha pode crescer (ou teria de cair), em % dela mesma. */
  percentualDaFolha: number;
}

/**
 * A FOLGA ATÉ O LIMITE PRUDENCIAL — quanto a folha pode crescer antes de a lei
 * proibir aumento.
 *
 * ATÉ O PRUDENCIAL, E NÃO ATÉ O TETO. O relatório em PDF chamava de "cabe
 * ainda" a distância até o teto de 54%, e isso exagerava a folga justamente
 * onde ela importa: a partir de 51,3% (95% do teto) o aumento já está proibido.
 * Um município em 50% tinha "4 pontos de folga" no papel e 1,3 na lei.
 *
 * A CONTA USA A RAZÃO DOS PERCENTUAIS PUBLICADOS, não a receita. `prudencial ÷
 * percentual − 1` é o quanto a mesma folha pode crescer com a mesma receita.
 * Conferido na produção: nos 51 entes com os dois números, despesa ÷ RCL bate
 * com o percentual publicado até a segunda casa — então o valor em reais sai da
 * mesma base que o selo.
 *
 * O QUE ELA NÃO É: dinheiro em caixa. É espaço legal. E como a receita dos
 * últimos 12 meses fica parada na conta, e a receita costuma crescer, a folga
 * real tende a ser maior que esta.
 */
export function folgaAtePrudencial(
  l: { percentualRcl: number | null; limitePrudencial: number | null; despesaPessoal: number | null },
  s: SituacaoFiscal,
): Folga | null {
  if (!COM_NUMERO_VALIDO.includes(s)) return null;
  const { percentualRcl: pct, limitePrudencial: pru, despesaPessoal: desp } = l;
  if (pct == null || pru == null || desp == null || pct <= 0 || desp <= 0) return null;
  const fator = pru / pct - 1;
  return { valor: desp * fator, percentualDaFolha: fator * 100 };
}

/**
 * A MEDIANA, e não a média: três municípios declararam mais de 200% da receita
 * em folha (erro de preenchimento). A média de 55 com um desses dentro sobe
 * cinco pontos; a mediana não se mexe. E mesmo assim eles ficam fora — quem
 * chama passa só percentuais de declaração que fecha.
 */
export function mediana(valores: number[]): number | null {
  const v = valores.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const meio = Math.floor(v.length / 2);
  return v.length % 2 ? v[meio] : (v[meio - 1] + v[meio]) / 2;
}

/** Declaração que fecha, com número — a única que entra numa comparação. */
export function comparavel(l: LeituraPessoal | null | undefined): boolean {
  if (!l || l.percentualRcl == null) return false;
  return COM_NUMERO_VALIDO.includes(situacaoFiscal(l, new Date(0)));
}

// ------------------------------------------------------------ o calendário

/**
 * O CALENDÁRIO DO FIM DE MANDATO — o que os limites do art. 22 não dizem.
 *
 * A ficha do Governo do Piauí dizia "SIM — a LRF não impede" em setembro de
 * 2026, com o percentual certo (37%, dentro do limite). Estava errada, porque
 * dois dispositivos valem POR CIMA dos limites:
 *
 *  - LRF, art. 21, II (redação da LC 173/2020): é NULO o ato de que resulte
 *    aumento da despesa com pessoal nos 180 dias anteriores ao final do
 *    mandato do titular do Poder.
 *  - Lei 9.504/97, art. 73, VIII: dos 180 dias antes da eleição até a posse,
 *    a revisão geral não pode exceder a recomposição da perda do poder
 *    aquisitivo ao longo do ano da eleição.
 *
 * As datas não se calculam, se consultam: a partir da eleição de 2026, os
 * governadores tomam posse em 6 de janeiro (EC 111/2021); os prefeitos, em 1º
 * de janeiro. A tabela é escrita à mão, com dois ciclos à frente, e um teste
 * reprova quando ela estiver para acabar.
 *
 * Meia-noite de Teresina é 03:00 UTC — `Date.UTC`, sem ler o relógio do
 * processo (ver o teste de fuso do servidor).
 */
const DIA_MS = 86_400_000;
const meiaNoiteBR = (ano: number, mes: number, dia: number) => Date.UTC(ano, mes - 1, dia, 3);

export const CICLOS_ELEITORAIS: Record<'E' | 'M', Array<{ eleicao: number; posse: number }>> = {
  E: [
    { eleicao: meiaNoiteBR(2026, 10, 4), posse: meiaNoiteBR(2027, 1, 6) },
    { eleicao: meiaNoiteBR(2030, 10, 6), posse: meiaNoiteBR(2031, 1, 6) },
  ],
  M: [
    { eleicao: meiaNoiteBR(2028, 10, 1), posse: meiaNoiteBR(2029, 1, 1) },
    { eleicao: meiaNoiteBR(2032, 10, 3), posse: meiaNoiteBR(2033, 1, 1) },
  ],
};

export interface AvisoDoCalendario {
  /** Dentro dos 180 dias do art. 21: aumento concedido agora é nulo. */
  fimDeMandato: boolean;
  posse: Date;
  texto: string;
}

export function avisoDoCalendario(esfera: string, agora: Date): AvisoDoCalendario | null {
  if (esfera !== 'E' && esfera !== 'M') return null;
  const t = agora.getTime();
  for (const c of CICLOS_ELEITORAIS[esfera]) {
    const inicioEleitoral = c.eleicao - 180 * DIA_MS;
    const inicioArt21 = c.posse - 180 * DIA_MS;
    if (t < inicioEleitoral || t >= c.posse) continue;
    const posse = formatarDataBR(new Date(c.posse));
    const desde = formatarDataBR(new Date(inicioArt21));
    const quem = esfera === 'E' ? 'do novo governo' : 'da nova gestão';
    const fimDeMandato = t >= inicioArt21;
    return {
      fimDeMandato,
      posse: new Date(c.posse),
      texto: fimDeMandato
        ? `Fim de mandato: de ${desde} até a posse ${quem} (${posse}), a LRF (art. 21, II) torna nulo o ato que aumente a despesa com pessoal — mesmo dentro dos limites. E, por ser ano de eleição, a revisão geral não pode passar da inflação do ano (Lei 9.504/97, art. 73, VIII).`
        : `Ano de eleição: até a posse ${quem} (${posse}), a revisão geral não pode passar da inflação do ano (Lei 9.504/97, art. 73, VIII). A partir de ${desde}, a LRF (art. 21, II) também torna nulo o ato que aumente a despesa com pessoal.`,
    };
  }
  return null;
}
