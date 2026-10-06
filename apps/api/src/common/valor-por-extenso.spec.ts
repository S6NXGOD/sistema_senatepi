import { valorPorExtenso } from './valor-por-extenso.util';

/**
 * O VALOR POR EXTENSO — testado caso a caso porque é a parte do recibo que
 * ninguém confere depois.
 *
 * Um algarismo errado numa tela qualquer é um bug; num recibo entregue a um
 * filiado é um documento errado circulando, e a segunda via vai sair igual.
 */
describe('valorPorExtenso', () => {
  it('os valores que o sindicato realmente emite', () => {
    // As quatro parcelas pagas na produção somam R$ 396,60 — 99,15 cada.
    expect(valorPorExtenso('99.15')).toBe('noventa e nove reais e quinze centavos');
    expect(valorPorExtenso('244.44')).toBe('duzentos e quarenta e quatro reais e quarenta e quatro centavos');
    expect(valorPorExtenso('5000.00')).toBe('cinco mil reais');
  });

  it('singular e plural do real', () => {
    expect(valorPorExtenso('1.00')).toBe('um real');
    expect(valorPorExtenso('2.00')).toBe('dois reais');
  });

  /** O plural do centavo NÃO acompanha o do real. */
  it('singular e plural do centavo, independentes', () => {
    expect(valorPorExtenso('1.01')).toBe('um real e um centavo');
    expect(valorPorExtenso('2.01')).toBe('dois reais e um centavo');
    expect(valorPorExtenso('1.02')).toBe('um real e dois centavos');
  });

  /** Só centavos não diz "zero reais e ..." — diz o que é. */
  it('valor abaixo de um real', () => {
    expect(valorPorExtenso('0.50')).toBe('cinquenta centavos');
    expect(valorPorExtenso('0.01')).toBe('um centavo');
  });

  it('zero', () => {
    expect(valorPorExtenso('0.00')).toBe('zero reais');
  });

  /** "cem" é exato; com resto vira "cento e ...". */
  it('cem e cento', () => {
    expect(valorPorExtenso('100.00')).toBe('cem reais');
    expect(valorPorExtenso('101.00')).toBe('cento e um reais');
    expect(valorPorExtenso('180.00')).toBe('cento e oitenta reais');
  });

  /** Mil não leva "um" na frente. */
  it('mil, sem "um mil"', () => {
    expect(valorPorExtenso('1000.00')).toBe('mil reais');
    expect(valorPorExtenso('2000.00')).toBe('dois mil reais');
  });

  /**
   * A NORMA DO "E": liga com "e" quando o resto é menor que cem ou é centena
   * redonda; com vírgula quando não.
   */
  it('o "e" antes da última parte segue a norma', () => {
    expect(valorPorExtenso('1200.00')).toBe('mil e duzentos reais');
    expect(valorPorExtenso('1050.00')).toBe('mil e cinquenta reais');
  });

  /**
   * O "DE" ANTES DA MOEDA. "um milhão reais" não existe em português: escala
   * redonda de milhão/bilhão pede "de reais". Com resto, não pede — "um milhão
   * e quinhentos mil reais".
   */
  it('milhão e bilhão, com o "de" onde ele é obrigatório', () => {
    expect(valorPorExtenso('1000000.00')).toBe('um milhão de reais');
    expect(valorPorExtenso('2000000.00')).toBe('dois milhões de reais');
    expect(valorPorExtenso('1500000.00')).toBe('um milhão e quinhentos mil reais');
    expect(valorPorExtenso('2500000.00')).toBe('dois milhões e quinhentos mil reais');
  });

  /**
   * A VÍRGULA ENTRE GRUPOS, e a exceção do "mil" sozinho — que é como gente
   * escreve no papel.
   */
  it('separa os grupos como se escreve num recibo', () => {
    expect(valorPorExtenso('1234.00')).toBe('mil duzentos e trinta e quatro reais');
    expect(valorPorExtenso('1234567.00')).toBe(
      'um milhão, duzentos e trinta e quatro mil, quinhentos e sessenta e sete reais',
    );
    expect(valorPorExtenso('100500.00')).toBe('cem mil e quinhentos reais');
  });

  /**
   * CENTAVO NÃO SE PERDE EM ARREDONDAMENTO. `1.07 * 100` dá
   * 107.00000000000001 em ponto flutuante — fazer a conta assim arredonda para
   * menos num caso e para mais noutro, e o recibo passa a divergir do caixa.
   * Os centavos saem do TEXTO.
   */
  it('não perde centavo por ponto flutuante', () => {
    expect(valorPorExtenso('1.07')).toBe('um real e sete centavos');
    expect(valorPorExtenso('0.29')).toBe('vinte e nove centavos');
    expect(valorPorExtenso('8.10')).toBe('oito reais e dez centavos');
  });

  /** O Prisma devolve Decimal, que vira string; número também tem de servir. */
  it('aceita número e string', () => {
    expect(valorPorExtenso(99.15)).toBe(valorPorExtenso('99.15'));
    expect(valorPorExtenso(1)).toBe('um real');
  });

  /** Um centavo com um dígito só na string ("1.5") é cinquenta centavos. */
  it('um dígito depois da vírgula é dezena de centavo', () => {
    expect(valorPorExtenso('1.5')).toBe('um real e cinquenta centavos');
  });

  it('teens e dezenas compostas', () => {
    expect(valorPorExtenso('15.00')).toBe('quinze reais');
    expect(valorPorExtenso('17.00')).toBe('dezessete reais');
    expect(valorPorExtenso('21.00')).toBe('vinte e um reais');
    expect(valorPorExtenso('99.00')).toBe('noventa e nove reais');
  });
});
