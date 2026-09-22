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
