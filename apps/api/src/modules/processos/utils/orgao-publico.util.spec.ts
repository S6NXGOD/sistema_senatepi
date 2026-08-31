import { pareceOrgaoPublico, tipoCorrigido } from './orgao-publico.util';

/**
 * DEZOITO ENTES PÚBLICOS CADASTRADOS COMO EMPRESA.
 *
 * Produção, 31/08/2026. "ESTADO DO PIAUI", "MUN. DE ALTO LONGÁ", "UNIÃO
 * FEDERAL" — todos como pessoa jurídica comum. A consequência não era estética:
 * a área jurídica do processo depende de haver ou não ente público no polo
 * passivo, e a dedução nunca disparava.
 */
describe('reconhece ente público', () => {
  it.each([
    'MUNICIPIO DE CORRENTE',
    'MUNICÍPIO DE PARNAIBA-PI',
    'MUN. DE ALTO LONGÁ',
    'MUN. DE CAP. DE CAMPOS',
    'ESTADO DO PIAUI',
    'Estado do Piauí',
    'UNIÃO FEDERAL',
    'PREFEITURA MUNICIPAL DE TERESINA',
    'SECRETARIA DE ESTADO DA SAÚDE DO PIAUÍ',
    'FUNDAÇÃO MUNICIPAL DE SAÚDE DE TERESINA',
  ])('%s', (nome) => {
    expect(pareceOrgaoPublico(nome)).toBe(true);
  });

  /**
   * O QUE ELA NÃO PODE ADIVINHAR.
   *
   * "HOSPITAL SÃO PAULO" é privado e "HOSPITAL GETÚLIO VARGAS" é estadual — o
   * nome não distingue. Palpite ali trocaria a área jurídica de processos
   * inteiros, e o rótulo continuaria plausível o bastante para ninguém notar.
   */
  it.each([
    'HOSPITAL SÃO PAULO',
    'HOSPITAL GETÚLIO VARGAS',
    'MATERNIDADE DONA EVANGELINA ROSA',
    'INSTITUTO DE DOENÇAS TROPICAIS NATAN PORTELLA',
    'UNIMED TERESINA COOPERATIVA DE TRABALHO MEDICO',
    'PRORRENAL - CLINICA NEFROLOGIA LTDA - ME',
  ])('não promove "%s"', (nome) => {
    expect(pareceOrgaoPublico(nome)).toBe(false);
  });

  /** A âncora é o INÍCIO do nome: conter "município" não é ser um. */
  it('sindicato de servidores municipais não vira município', () => {
    expect(pareceOrgaoPublico('SINDICATO DOS SERVIDORES DO MUNICÍPIO DE TERESINA')).toBe(false);
  });

  it('nome vazio não é órgão', () => {
    expect(pareceOrgaoPublico('')).toBe(false);
    expect(pareceOrgaoPublico(null)).toBe(false);
  });
});

describe('correção de tipo', () => {
  it('empresa com nome de ente vira órgão público', () => {
    expect(tipoCorrigido('MUNICIPIO DE NAZARIA', 'JURIDICA')).toBe('ORGAO_PUBLICO');
  });

  it('quem já é órgão público fica como está', () => {
    expect(tipoCorrigido('MUNICIPIO DE NAZARIA', 'ORGAO_PUBLICO')).toBeNull();
  });

  /** Transformar gente em órgão é um estrago grande para um ganho nenhum. */
  it('pessoa física nunca é promovida', () => {
    expect(tipoCorrigido('MUNICIPIO DE NAZARIA', 'FISICA')).toBeNull();
  });

  it('empresa comum não é tocada', () => {
    expect(tipoCorrigido('HAPVIDA', 'JURIDICA')).toBeNull();
  });
});
