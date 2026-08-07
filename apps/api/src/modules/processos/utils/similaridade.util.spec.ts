import { partesParecidas } from './similaridade.util';

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
