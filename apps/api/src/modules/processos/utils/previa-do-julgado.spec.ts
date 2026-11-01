import { trechoDaOrdem } from './trecho-da-ordem.util';

/**
 * A PRÉVIA DE UM JULGADO É O DISPOSITIVO — 22/09/2026.
 *
 * A caixa de entrada pergunta ao advogado "isto é seu?" e a prévia é a frase
 * que responde sem abrir nada. Nos atos curtos, os três padrões de
 * `trecho-da-ordem` acertam. Num acórdão, eles acham o verbo errado: procuram
 * no texto INTEIRO, e o texto inteiro de um julgado é a história do processo.
 *
 * MEDIDO no acórdão de 48.864 caracteres que virou tarefa indevida — a prévia
 * saía *"conheço do recurso ordinário. 2 - MÉRITO AÇÃO DE CONSIGNAÇÃO…"*, um
 * pedaço do relatório, quando o que importava eram dez palavras do fim.
 *
 * E o ganho não é só nesse: comparado nas 172 publicações longas da produção,
 *
 *   "Intimem-se. Teresina - PI, datada e assinada"  →  "JULGO IMPROCEDENTES os pedidos"
 *   "Fica V. Sa. intimado para tomar ciência…"      →  "NEGO PROVIMENTO ao recurso da reclamada"
 *   (sem prévia nenhuma)                            →  "nego provimento ao agravo de instrumento"
 */

const RELATORIO = (
  'RELATÓRIO. Trata-se de recurso ordinário. O juízo de origem, ao apreciar o pedido, ' +
  'determinou: intimem-se as partes para ciência. A parte recorrente sustenta que a ' +
  'sentença deve ser reformada, alegando violação aos arts. 578 e 591 da CLT. '
).repeat(24);

describe('a prévia de um julgado longo', () => {
  it('mostra o dispositivo, não o verbo perdido no relatório', () => {
    const acordao = `${RELATORIO}Ante o exposto, NEGO PROVIMENTO ao recurso ordinário da reclamada.`;
    const previa = trechoDaOrdem(acordao)!;
    expect(previa).toContain('NEGO PROVIMENTO');
    expect(previa).not.toContain('intimem-se');
  });

  /** A última marca: acórdão com voto vencido traz "ACORDAM" no meio. */
  it('com voto divergente, mostra o dispositivo final', () => {
    const acordao =
      `${RELATORIO}ACORDAM os Ministros, vencido o relator, em julgar procedente. ` +
      'Isto posto, ACORDAM em negar provimento ao recurso, por unanimidade.';
    const previa = trechoDaOrdem(acordao)!;
    expect(previa).toContain('negar provimento');
    expect(previa).not.toContain('vencido o relator');
  });

  /**
   * O ACENTO SOBREVIVE. A busca da marca é feita sem acento e sem caixa, mas o
   * recorte sai do texto ORIGINAL — a prévia vai para a tela, e "Subseção" com
   * acento é o que a pessoa lê.
   */
  it('devolve o texto como ele é, com acento e caixa', () => {
    const acordao = `${RELATORIO}Ante o exposto, ACORDAM os Ministros da Subseção II em negar provimento.`;
    expect(trechoDaOrdem(acordao)).toContain('Subseção');
  });

  /** Uma frase, não um parágrafo: quem quiser o resto abre a publicação. */
  it('a prévia não vira parede de texto', () => {
    const acordao = `${RELATORIO}Ante o exposto, nego provimento. ${'Fundamento adicional. '.repeat(60)}`;
    expect(trechoDaOrdem(acordao)!.length).toBeLessThanOrEqual(200);
  });
});

describe('o que a mudança NÃO pode estragar', () => {
  /**
   * O ATO CURTO CONTINUA COM OS TRÊS PADRÕES — é a esmagadora maioria, e ali
   * "INTIME-SE A RECLAMADA" é exatamente a frase que responde "isto é seu?".
   */
  it('intimação curta continua usando os padrões de sempre', () => {
    const curta =
      'PODER JUDICIÁRIO. Intimem-se as partes para, em 10 dias, manifestarem se têm ' +
      'interesse na produção de outras provas.';
    const previa = trechoDaOrdem(curta)!;
    expect(previa).toMatch(/^Intimem-se/);
  });

  it('"Fica V. Sa. intimado" continua casando, com o ponto no meio', () => {
    const curta = 'Fica V. Sa. intimado para tomar ciência da decisão proferida nos autos.';
    expect(trechoDaOrdem(curta)).toContain('Fica V. Sa. intimado');
  });

  /**
   * TEXTO LONGO SEM DISPOSITIVO cai nos padrões, como antes. Perder a prévia
   * seria trocar um defeito por outro: 95 das 172 longas não têm "INTIME-SE"
   * no dispositivo, e aplicar o corte ANTES dos padrões as deixaria mudas.
   */
  it('longo sem marca de dispositivo continua nos padrões', () => {
    const longo = `${'Considerando os autos e as provas produzidas. '.repeat(200)}Intime-se a reclamada para pagamento.`;
    expect(trechoDaOrdem(longo)).toContain('Intime-se a reclamada');
  });

  it('sem nada reconhecível, continua devolvendo null', () => {
    expect(trechoDaOrdem('Certidão de publicação no diário oficial.')).toBeNull();
    expect(trechoDaOrdem('')).toBeNull();
  });
});

/**
 * O AVISO DE PRAXE NÃO É A ORDEM.
 *
 * "Fica V. Sa. intimado para tomar ciência do Despacho ID 7d684b3" abre quase
 * todo ato do TRT. Ele casava com o padrão e, sendo o primeiro no texto,
 * levava o recorte inteiro — 58% das 1.952 publicações do acervo paravam aí,
 * e 43 delas viraram tarefa ou proposta na agenda de alguém.
 *
 * Caso real (0000764-11.2021.5.22.0002, agenda da Dra. Morgana): a tarefa
 * citava "Recebo o Agravo de Petição interposto pela…", cortado exatamente
 * antes da única linha que interessava a ela.
 */
describe('o recorte pula o "tomar ciência"', () => {
  const ATO =
    'Fica V. Sa. intimado para tomar ciência da Decisão ID 5de7bfe proferida nos autos. ' +
    'DESPACHO DE ADMISSIBILIDADE DE RECURSO Recebo o Agravo de Petição interposto pela parte ' +
    'reclamada, eis que tempestivo. A parte reclamante, por sua vez, fica devidamente intimada ' +
    'para apresentar impugnação em oito dias. Transcorrido o prazo, subam-se os autos ao E. TRT.';

  it('cita o que o juízo mandou, não o aviso de leitura', () => {
    const t = trechoDaOrdem(ATO)!;
    expect(t).toContain('impugnação em oito dias');
    expect(t).not.toContain('tomar ciência');
  });

  /*
    E NUNCA FICA SEM NADA: se o que vem depois do aviso também for só aviso, o
    aviso volta. Recorte fraco é melhor que tarefa sem citação do ato — foi a
    ausência dessa citação que o dono apontou em 29/10/2026.
  */
  it('sem ordem depois dele, o aviso de praxe volta', () => {
    const so = 'Fica V. Sa. intimado para tomar ciência do Despacho ID 2fee85c proferido nos autos.';
    expect(trechoDaOrdem(so)).toContain('tomar ciência');
  });

  it('ato que já começa pela ordem não muda', () => {
    const direto =
      'INTIME-SE o sindicato autor para, no prazo de 15 (quinze) dias, emendar a petição inicial.';
    expect(trechoDaOrdem(direto)).toContain('emendar a petição inicial');
  });

  it('o dispositivo do julgado longo continua tendo precedência', () => {
    const longo = `${'x'.repeat(6000)} DISPOSITIVO Ante o exposto, nego provimento ao recurso ordinário.`;
    expect(trechoDaOrdem(longo)).toContain('nego provimento');
  });
});
