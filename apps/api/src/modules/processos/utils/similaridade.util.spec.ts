import { partesParecidas, palavrasSignificativas, ruidoDeCidades } from './similaridade.util';

/** O cadastro REAL da produção em 07/08/2026 — inclusive a duplicata que existe. */
const CADASTRO = [
  { id: '1', nome: 'FEPSERH', documento: null },
  { id: '2', nome: 'FUNDAÇÃO MUNICIPAL DE SAÚDE DE TERESINA', documento: null },
  { id: '3', nome: 'HOSPITAL DE URGÊNCIA DE TERESINA', documento: null },
  { id: '4', nome: 'HOSPITAL GETÚLIO VARGAS', documento: null },
  { id: '5', nome: 'HOSPITAL UNIVERSITÁRIO DA UFPI', documento: null },
  { id: '6', nome: 'INSTITUTO DE DOENÇAS TROPICAIS NATAN PORTELLA', documento: null },
  { id: '7', nome: 'MATERNIDADE DONA EVANGELINA ROSA', documento: null },
  { id: '8', nome: 'PRONTOCARE', documento: null },
  { id: '9', nome: 'PRONTOCARE CLINICA E ATENDIMENTOS LTDA', documento: '09181717000151' },
  { id: '10', nome: 'SECRETARIA DE ESTADO DA SAÚDE DO PIAUÍ', documento: null },
];

const nomes = (r: ReturnType<typeof partesParecidas>) => r.map((x) => x.parte.nome);

describe('partesParecidas — evitar cadastrar o mesmo réu duas vezes', () => {
  /**
   * O CASO QUE ACONTECEU DE VERDADE: a busca por `contains` não encontra
   * "PRONTOCARE" quando se digita a razão social completa, e foi assim que os
   * dois cadastros nasceram.
   */
  it('digitar a razão social completa encontra o nome curto já cadastrado', () => {
    const r = partesParecidas('PRONTOCARE CLINICA E ATENDIMENTOS LTDA', null, CADASTRO);
    expect(nomes(r)).toContain('PRONTOCARE');
  });

  it('digitar o nome curto encontra a razão social completa', () => {
    const r = partesParecidas('Prontocare', null, CADASTRO);
    expect(nomes(r)).toContain('PRONTOCARE CLINICA E ATENDIMENTOS LTDA');
  });

  it('CNPJ igual é indício definitivo, mesmo com nome diferente', () => {
    const r = partesParecidas('CLINICA NOVA', '09.181.717/0001-51', CADASTRO);
    expect(r[0].motivo).toBe('MESMO_DOCUMENTO');
    expect(r[0].parte.nome).toBe('PRONTOCARE CLINICA E ATENDIMENTOS LTDA');
  });

  it('acento, caixa e pontuação não atrapalham', () => {
    expect(nomes(partesParecidas('prontocare clínica & atendimentos ltda.', null, CADASTRO)))
      .toContain('PRONTOCARE');
  });

  /**
   * O RISCO OPOSTO, e o mais perigoso: avisar demais. Se "HOSPITAL" contasse
   * como indício, todo hospital novo apontaria para os três já cadastrados — e
   * em duas semanas ninguém mais leria o aviso.
   */
  it('não confunde hospitais diferentes só porque ambos são "HOSPITAL"', () => {
    const r = partesParecidas('HOSPITAL SÃO MARCOS', null, CADASTRO);
    expect(r).toEqual([]);
  });

  it('não confunde secretaria com fundação por causa de "DE SAÚDE"', () => {
    const r = partesParecidas('SECRETARIA MUNICIPAL DE SAÚDE DE PARNAÍBA', null, CADASTRO);
    expect(nomes(r)).not.toContain('FUNDAÇÃO MUNICIPAL DE SAÚDE DE TERESINA');
  });

  it('empresa realmente nova não gera aviso nenhum', () => {
    expect(partesParecidas('LABORATÓRIO ALFA DIAGNÓSTICOS', null, CADASTRO)).toEqual([]);
  });

  it('nome só com palavras genéricas não aponta nada', () => {
    expect(partesParecidas('CLINICA LTDA', null, CADASTRO)).toEqual([]);
  });

  it('texto curto demais não dispara', () => {
    expect(partesParecidas('PR', null, CADASTRO)).toEqual([]);
  });

  it('nome idêntico é o indício mais forte depois do documento', () => {
    const r = partesParecidas('fepserh', null, CADASTRO);
    expect(r[0].motivo).toBe('MESMO_NOME');
  });

  it('respeita o limite pedido', () => {
    const muitos = Array.from({ length: 20 }, (_, i) => ({
      id: String(i), nome: `PRONTOCARE UNIDADE ${i}`, documento: null,
    }));
    expect(partesParecidas('PRONTOCARE', null, muitos, 3)).toHaveLength(3);
  });
});

/**
 * TOPÔNIMO NÃO É INDÍCIO — a regressão que a varredura de duplicatas revelou.
 *
 * Enquanto a comparação só rodava AO DIGITAR, isto passava: a pessoa está
 * olhando o nome e descarta o falso positivo em um segundo. Quando o mesmo
 * código passou a alimentar uma FILA DE LIMPEZA do cadastro inteiro, os dois
 * únicos resultados eram falsos — e fila que erra duas em duas ninguém abre
 * de novo.
 *
 * Medido no cadastro real em 21/08/2026, antes da correção:
 *   "HOSPITAL DE URGÊNCIA DE TERESINA"      ~ "FUNDAÇÃO MUNICIPAL DE SAÚDE DE TERESINA"
 *   "SECRETARIA DE ESTADO DA SAÚDE DO PIAUÍ" ~ "SINDICATO ... DO ESTADO DO PIAUÍ"
 * Em cada par a única palavra em comum era o lugar.
 */
describe('lugar não identifica organização', () => {
  const cidades = ruidoDeCidades([{ cidade: 'Teresina' }, { cidade: 'Teresina' }]);

  it('nome de UF nunca conta como indício', () => {
    expect(palavrasSignificativas('SECRETARIA DE ESTADO DA SAÚDE DO PIAUÍ')).toEqual([]);
    expect(palavrasSignificativas('HOSPITAL DE SÃO PAULO')).toEqual([]);
  });

  it('cidade do próprio cadastro vira ruído', () => {
    expect(palavrasSignificativas('HOSPITAL DE URGÊNCIA DE TERESINA')).toEqual(['urgencia', 'teresina']);
    expect(palavrasSignificativas('HOSPITAL DE URGÊNCIA DE TERESINA', cidades)).toEqual(['urgencia']);
  });

  it.each([
    ['HOSPITAL DE URGÊNCIA DE TERESINA', 'FUNDAÇÃO MUNICIPAL DE SAÚDE DE TERESINA'],
    ['SECRETARIA DE ESTADO DA SAÚDE DO PIAUÍ', 'SINDICATO DOS ENFERMEIROS E TÉCNICOS DE ENFERMAGEM DO ESTADO DO PIAUÍ'],
  ])('"%s" NÃO é apontado como duplicata de "%s"', (a, b) => {
    const r = partesParecidas(a, null, [{ id: 'x', nome: b, documento: null }], 3, cidades);
    expect(r).toEqual([]);
  });

  /**
   * E o verdadeiro positivo tem de continuar passando — é o caso que motivou a
   * comparação existir, e apertar o filtro demais o mataria junto.
   */
  it('ainda acha "PRONTOCARE" dentro de "PRONTOCARE CLINICA E ATENDIMENTOS LTDA"', () => {
    const r = partesParecidas(
      'PRONTOCARE CLINICA E ATENDIMENTOS LTDA',
      null,
      [{ id: 'x', nome: 'PRONTOCARE', documento: null }],
      3,
      cidades,
    );
    expect(r).toHaveLength(1);
    expect(r[0].motivo).toBe('CONTIDO');
  });

  /** O documento continua sendo indício definitivo, sem depender de nome. */
  it('mesmo CNPJ vale mesmo com nomes sem nada em comum', () => {
    const r = partesParecidas(
      'HOSPITAL DE URGÊNCIA DE TERESINA',
      '11222333000181',
      [{ id: 'x', nome: 'FUNDAÇÃO MUNICIPAL DE SAÚDE', documento: '11222333000181' }],
      3,
      cidades,
    );
    expect(r[0]?.motivo).toBe('MESMO_DOCUMENTO');
  });
});

/**
 * O BURACO QUE O RUÍDO DE RAMO ABRE — e por que ele é tapado FORA daqui.
 *
 * Relatado no uso: digitando "Município" no cadastro de uma parte nova, o aviso
 * dizia "nenhum cadastro parecido — pode criar", enquanto a aba "Do cadastro",
 * ao lado, listava o MUNICÍPIO DE PALMEIRAIS. Dois algoritmos, duas respostas,
 * e quem digita não tem como saber disso: parece falha.
 *
 * A comparação por palavra está CERTA em ficar muda: `municipio` é ruído de
 * ramo (senão toda prefeitura seria duplicata das outras), então não sobra
 * palavra significativa nenhuma e não há indício a apontar.
 *
 * O complemento é por SUBSTRING e vive em `PartesExternasService.parecidas`,
 * com motivo próprio (`CONTEM`) — deliberadamente fora desta função, que é
 * usada também pela fila de limpeza, onde substring viraria ruído.
 */
describe('nome só de palavras genéricas', () => {
  const cadastro = [
    { id: '1', nome: 'MUNICÍPIO DE PALMEIRAIS -PI', documento: null },
    { id: '2', nome: 'FUNDAÇÃO MUNICIPAL DE SAÚDE DE TERESINA', documento: null },
  ];

  it('"Município" não gera indício por palavra — e isso é o certo', () => {
    expect(palavrasSignificativas('Município')).toEqual([]);
    expect(partesParecidas('Município', null, cadastro, 5)).toEqual([]);
  });

  /** Se isto passar a casar, duas prefeituras diferentes viram duplicata. */
  it('duas prefeituras diferentes NÃO são apontadas uma pela outra', () => {
    const r = partesParecidas(
      'MUNICÍPIO DE AGRICOLÂNDIA',
      null,
      [{ id: 'x', nome: 'MUNICÍPIO DE PALMEIRAIS -PI', documento: null }],
      5,
    );
    expect(r).toEqual([]);
  });
});
