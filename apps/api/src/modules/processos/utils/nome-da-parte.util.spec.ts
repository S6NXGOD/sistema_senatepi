import { limparNomeDaParte, temPapelRecursalNoNome } from './nome-da-parte.util';

/**
 * Todos os nomes abaixo são da produção (31/10/2026). Três deles estavam
 * GRAVADOS assim na ficha, e os três no polo errado — ao lado do sindicato,
 * como se o adversário fosse nosso litisconsorte.
 */
describe('o nome da parte, sem o que é do ato', () => {
  it.each([
    ['1. MUNICÍPIO DE PALMEIRA DO PIAUÍ (RECORRENTE)', 'MUNICÍPIO DE PALMEIRA DO PIAUÍ'],
    ['1. ESTADO DO PIAUÍ (AGRAVANTE)', 'ESTADO DO PIAUÍ'],
    ['1. MUNICIPIO DE PARNAIBA (AGRAVANTE)', 'MUNICIPIO DE PARNAIBA'],
    [
      '2. SINDICATO DOS ENFERMEIROS, AUXILIARES E TECNICOS EM ENFERMAGEM DO ESTADO DO PIAUI - SENATEPI (RECORRIDO)',
      'SINDICATO DOS ENFERMEIROS, AUXILIARES E TECNICOS EM ENFERMAGEM DO ESTADO DO PIAUI - SENATEPI',
    ],
    ['.O ESTADO DO PIAUÍ', 'O ESTADO DO PIAUÍ'],
    ['3) MUNICIPIO DE COCAL', 'MUNICIPIO DE COCAL'],
  ])('limpa %s', (bruto, limpo) => {
    expect(limparNomeDaParte(bruto)).toBe(limpo);
  });

  /*
    E NÃO TIRA PARÊNTESE QUE É DO NOME. Os dois estão no acervo, e cortar ali
    deixaria o nome pela metade.
  */
  it.each(['UNIÃO FEDERAL (AGU)', 'SINDICATO DOS SERVIDORES PÚBLICOS FEDERAIS (SINDSEP-DF)'])(
    'preserva a sigla de %s',
    (nome) => {
      expect(limparNomeDaParte(nome)).toBe(nome);
    },
  );

  /*
    O PONTO ATRÁS É ABREVIAÇÃO, não sujeira. Quatro partes do acervo terminam
    em "S.A." e a primeira versão as devolvia como "S.A".
  */
  it.each([
    'HAPVIDA ASSISTENCIA MEDICA S.A.',
    'ULTRA SOM SERVICOS MEDICOS S.A.',
    'Fundação Municipal de Saúde.',
  ])('preserva o ponto de abreviação em %s', (nome) => {
    expect(limparNomeDaParte(nome)).toBe(nome);
  });

  it('nome já limpo passa igual', () => {
    expect(limparNomeDaParte('HAPVIDA ASSISTENCIA MEDICA LTDA')).toBe('HAPVIDA ASSISTENCIA MEDICA LTDA');
    expect(limparNomeDaParte(null)).toBe('');
  });

  /*
    O NÚMERO DENTRO DO NOME NÃO SAI — só o ordinal da LISTA, que vem colado no
    começo e seguido de ponto ou parêntese.
  */
  it('não come número que faz parte do nome', () => {
    expect(limparNomeDaParte('CLINICA 2000 LTDA')).toBe('CLINICA 2000 LTDA');
    expect(limparNomeDaParte('24 HORAS SERVICOS MEDICOS')).toBe('24 HORAS SERVICOS MEDICOS');
  });
});

/**
 * O PAPEL ESCRITO NO NOME É UM AVISO, NÃO SÓ SUJEIRA.
 *
 * Nas 10 publicações do acervo em que o tribunal rotula assim, o polo
 * publicado discorda do polo da ficha em 10 de 10. É sinal mais forte que a
 * classe do ato e pega o que a classe não pega: o agravo publicado por dentro
 * de uma ação autuada em 2º grau.
 */
describe('o papel recursal no nome', () => {
  it.each([
    '1. ESTADO DO PIAUÍ (AGRAVANTE)',
    'MUNICÍPIO X (RECORRENTE)',
    'EMPRESA Y (AGRAVADO)',
    'FULANO (EMBARGANTE)',
    'BELTRANO (APELADA)',
  ])('%s acusa recurso', (nome) => {
    expect(temPapelRecursalNoNome(nome)).toBe(true);
  });

  it.each([
    'UNIÃO FEDERAL (AGU)',
    'HAPVIDA ASSISTENCIA MEDICA LTDA',
    'MUNICIPIO DE COCAL',
    'SINDICATO DOS SERVIDORES PÚBLICOS FEDERAIS (SINDSEP-DF)',
  ])('%s não acusa nada', (nome) => {
    expect(temPapelRecursalNoNome(nome)).toBe(false);
  });

  /* AUTOR e RÉU entre parênteses seriam informação boa — não é a eles que a
     desconfiança se aplica, e por isso não entram na lista. */
  it('papel da AÇÃO entre parênteses não acusa recurso', () => {
    expect(temPapelRecursalNoNome('MUNICIPIO DE COCAL (AUTOR)')).toBe(false);
  });
});
