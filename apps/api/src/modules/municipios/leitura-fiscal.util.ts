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
export function oQueIssoSignifica(s: SituacaoFiscal): string {
  switch (s) {
    case 'ACIMA_DO_TETO':
      return 'Acima do teto da Lei de Responsabilidade Fiscal: além da proibição de conceder aumento, o município tem prazo para recompor a folha e fica sujeito a restrições de transferência voluntária e de crédito.';
    case 'PRUDENCIAL':
      return 'Acima do limite prudencial: pelo art. 22, parágrafo único, da LRF, o município está proibido de conceder aumento, criar cargo, alterar estrutura de carreira e contratar — exceto reposição em saúde, educação e segurança.';
    case 'ALERTA':
      return 'No limite de alerta: passou de 90% do teto. Ainda pode conceder aumento, mas o Tribunal de Contas já é obrigado a alertar formalmente o município.';
    case 'REGULAR':
      return 'Dentro dos limites da Lei de Responsabilidade Fiscal — não há impedimento fiscal para conceder aumento.';
    case 'INCONSISTENTE':
      return 'A declaração enviada ao Tesouro não fecha: a despesa com pessoal informada supera a receita do período. O número não serve de argumento para nenhum dos dois lados enquanto o município não retificar.';
    case 'SEM_DADO':
      return 'Este ente não publicou o Relatório de Gestão Fiscal no período consultado — deixar de publicar é, por si, uma irregularidade prevista na Lei de Responsabilidade Fiscal.';
    case 'NAO_CONSULTADO':
    default:
      return 'Os indicadores deste ente ainda não foram buscados no Tesouro Nacional. Use "Atualizar do Tesouro" — não é falha do ente.';
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
