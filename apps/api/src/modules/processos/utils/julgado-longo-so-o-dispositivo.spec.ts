import {
  classificarProvidencia,
  extrairPrazoDias,
  trechoQueDecide,
} from './providencia.util';

/**
 * UM ACÓRDÃO NÃO É UMA INTIMAÇÃO — 22/09/2026.
 *
 * O CASO. O dono perguntou: *"Essa atividade 'Analisar sentença' que está para
 * hoje para a Dra. Morgana realmente é para o nosso lado?"*
 *
 * O processo ERA nosso: TST-ROT 724-10.2017.5.10.0000, ação rescisória da
 * FASUBRA, e o SENATEPI é um dos treze litisconsortes no polo PASSIVO — a OAB
 * dela está citada no ato. Mas a tarefa estava errada nas duas afirmações que
 * fazia, e as duas pelo mesmo motivo.
 *
 * O ato tem **48.864 caracteres**. Medido no texto real:
 *
 *   "SENTENCA PROFERIDA" ...... 14% do texto — a sentença de 2014 que a
 *                               FASUBRA queria rescindir, citada no relatório;
 *   "PRAZO DE 15 DIAS" ........ 21% — prazo dado à FASUBRA anos atrás para
 *                               emendar a petição inicial;
 *   "ISTO POSTO" .............. 99% — e ali está o que vale.
 *
 * O dispositivo: *"ACORDAM (...) conhecer do recurso ordinário e, no mérito,
 * negar-lhe provimento"*. Ou seja: a decisão foi FAVORÁVEL ao nosso lado e não
 * pedia nada de ninguém. A agenda dizia "prazo vence hoje".
 *
 * A DIFERENÇA: na intimação, o texto inteiro é a ordem — e ler tudo está certo
 * (a média do acervo é 3.064 caracteres). No julgado, o texto é uma HISTÓRIA e
 * só o fim é ordem. Ler o relatório como comando é ler o passado como se fosse
 * hoje.
 *
 * Medido no acervo: o corte entra em **172 de 2.395** publicações (7%).
 */

/** O dispositivo real do acórdão, como veio do DJEN. */
const DISPOSITIVO =
  'Ante o exposto, nego provimento ao recurso ordinário.ISTO POSTOACORDAM os Ministros da ' +
  'Subseção II Especializada em Dissídios Individuais do Tribunal Superior do Trabalho, por ' +
  'unanimidade, conhecer do recurso ordinário e, no mérito, negar-lhe provimento.Brasília, 15 ' +
  'de setembro de 2026.Firmado por assinatura digital (MP 2.200-2/2001)MARIA HELENA MALLMANN' +
  'Ministra Relatora';

/** O relatório: narra a sentença de 2014 e um prazo de 2017. É história. */
const RELATORIO = (
  'RELATÓRIO. Trata-se de ação rescisória ajuizada pela FASUBRA visando a desconstituição da ' +
  'sentença proferida nos autos do processo nº 0000917-09.2014.5.10.0007, ação de consignação ' +
  'em pagamento. O relator, indeferindo o pedido de tutela de urgência, abriu o prazo de 15 ' +
  'dias úteis para emenda à petição inicial (fls. 4.043/4.044). Interposto novo agravo, a ' +
  'autora sustentou violação aos arts. 578, 589, 590 e 591 da CLT. '
  // O parêntese importa: `.repeat` preso só à última string deixaria o texto
  // abaixo dos 5.000 e o corte nem entraria — o teste passaria sem testar nada.
).repeat(14);

const ACORDAO = `${RELATORIO}${DISPOSITIVO}`;

describe('o que um julgado longo manda fazer', () => {
  it('o ato reproduz o tamanho do caso real (julgado longo)', () => {
    expect(ACORDAO.length).toBeGreaterThan(5_000);
  });

  it('o recorte devolve o dispositivo, e só ele', () => {
    const norte = trechoQueDecide(ACORDAO.toUpperCase());
    expect(norte).toContain('NEGAR-LHE PROVIMENTO');
    expect(norte).not.toContain('PRAZO DE 15');
    expect(norte).not.toContain('SENTENÇA PROFERIDA'.toUpperCase());
    expect(norte.length).toBeLessThan(500);
  });

  /**
   * O ERRO Nº 1: a sentença citada no relatório virava "Analisar sentença".
   * O comentário de `RE_SENTENCA` já previa isto ("acórdão fala da sentença o
   * tempo todo"), e a regra apertada de 14/09 não bastou para um texto que
   * repete a expressão seis vezes ao contar a história.
   */
  it('deixa de virar "Analisar sentença" por causa do relatório', () => {
    expect(classificarProvidencia(ACORDAO).providencia).not.toBe('ANALISAR_SENTENCA');
  });

  /**
   * O ERRO Nº 2, e o mais caro: um prazo de 2017 virou "vence hoje" na agenda
   * de uma advogada. Prazo errado para MENOS custa uma conferência; prazo
   * inventado custa confiança na agenda inteira.
   */
  it('deixa de inventar prazo a partir do relatório', () => {
    expect(classificarProvidencia(ACORDAO).prazoMencionadoDias).toBeNull();
  });

  /** E o que sobra é o certo: houve julgamento, cabe decidir sobre recorrer. */
  it('classifica pelo que o dispositivo diz', () => {
    expect(classificarProvidencia(ACORDAO).providencia).toBe('AVALIAR_RECURSO');
  });
});

describe('o que o corte NÃO pode estragar', () => {
  /**
   * A INTIMAÇÃO CURTA CONTINUA LIDA INTEIRA. É a esmagadora maioria — média de
   * 3.064 caracteres — e ali o prazo é de verdade. As três outras atividades
   * abertas do acervo nasceram de atos de 782 a 865 caracteres.
   */
  it('intimação curta não é recortada, nem perde o prazo', () => {
    const curta =
      'Fica o sindicato autor intimado para, no prazo de 5 dias, manifestar-se sobre os ' +
      'documentos juntados. Ante o exposto, defiro a juntada.';
    expect(trechoQueDecide(curta.toUpperCase())).toHaveLength(curta.length);
    expect(classificarProvidencia(curta).prazoMencionadoDias).toBe(5);
  });

  /** Texto longo SEM marca de dispositivo continua inteiro: perder é pior. */
  it('ato longo sem dispositivo continua lido por inteiro', () => {
    const longo = 'Intimacao para ciencia do ato, no prazo de 10 dias. '.repeat(150);
    expect(trechoQueDecide(longo.toUpperCase())).toHaveLength(longo.length);
    expect(extrairPrazoDias(longo.toUpperCase())).toBe(10);
  });

  /**
   * O PRAZO QUE ESTÁ NO DISPOSITIVO CONTINUA VALENDO — é o caso em que o
   * julgado de fato manda alguém fazer algo, e perdê-lo seria trocar um defeito
   * por outro pior.
   */
  it('prazo dentro do dispositivo sobrevive ao corte', () => {
    const comOrdem = `${RELATORIO}Ante o exposto, dou provimento e concedo o prazo de 8 dias para o cumprimento.`;
    expect(classificarProvidencia(comOrdem).prazoMencionadoDias).toBe(8);
  });

  /**
   * A ÚLTIMA MARCA, NÃO A PRIMEIRA. Um acórdão com voto divergente traz
   * "ACORDAM" no meio (no caso real, a 66%) e o dispositivo de verdade depois
   * (a 99%). Pegar a primeira devolveria o voto vencido.
   */
  it('com voto divergente, vale a última marca', () => {
    const comDivergente =
      `${RELATORIO}ACORDAM os Ministros, vencido o relator, em julgar improcedente no prazo de 30 dias. ` +
      'Voto divergente do Ministro X. ' +
      'Isto posto, ACORDAM em negar provimento ao recurso ordinário, por unanimidade.';
    const norte = trechoQueDecide(comDivergente.toUpperCase());
    expect(norte).toContain('NEGAR PROVIMENTO');
    expect(norte).not.toContain('30 DIAS');
  });
});
