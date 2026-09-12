import { nomeComparavel, partesParecidas, ruidoDeCidades, siglaDoNome } from './similaridade.util';

/**
 * AS DUPLICATAS QUE A VARREDURA NÃO VIA — medidas na produção em 12/09/2026.
 *
 * "HOSPITAL SÃO PAULO" e "HOSPITAL SAO PAULO LTDA" diferiam só no LTDA, e todas
 * as palavras dos dois são ruído. "FMS/THE" (com o CNPJ da Fundação Municipal de
 * Saúde) e "Fundação Municipal de Saúde." não dividiam uma palavra sequer.
 */
describe('o nome inteiro', () => {
  it('"LTDA", conectivo e acento não separam o mesmo nome', () => {
    expect(nomeComparavel('HOSPITAL SÃO PAULO')).toBe(nomeComparavel('HOSPITAL SAO PAULO LTDA'));
    const r = partesParecidas(
      'HOSPITAL SÃO PAULO',
      null,
      [{ id: 'x', nome: 'HOSPITAL SAO PAULO LTDA', documento: null }],
      3,
    );
    expect(r[0]?.motivo).toBe('MESMO_NOME');
  });

  it('a sigla de UF no fim também não separa', () => {
    const r = partesParecidas(
      'MUNICÍPIO DE PALMEIRAIS',
      null,
      [{ id: 'x', nome: 'MUNICÍPIO DE PALMEIRAIS -PI', documento: null }],
      3,
    );
    expect(r[0]?.motivo).toBe('MESMO_NOME');
  });

  it('espaço, hífen e apóstrofo também não separam: "PRONTO-CARE" é a "PRONTOCARE"', () => {
    expect(
      partesParecidas('PRONTO-CARE LTDA', null, [{ id: 'x', nome: 'PRONTOCARE', documento: null }], 3)[0]?.motivo,
    ).toBe('MESMO_NOME');
    expect(partesParecidas("ITA'COR", null, [{ id: 'x', nome: 'ITACOR', documento: null }], 3)[0]?.motivo).toBe(
      'MESMO_NOME',
    );
  });

  /** Colar só vale para nome de verdade: duas siglas curtas não viram a mesma. */
  it('siglas curtas coladas não viram o mesmo nome', () => {
    expect(partesParecidas('H T I', null, [{ id: 'x', nome: 'HTI', documento: null }], 3)).toEqual([]);
  });

  it('nomes que só dividem ramo e lugar continuam distintos', () => {
    expect(
      partesParecidas('HOSPITAL SÃO MARCOS', null, [{ id: 'x', nome: 'HOSPITAL SAO PAULO LTDA', documento: null }], 3),
    ).toEqual([]);
    expect(
      partesParecidas('MUNICÍPIO DE AGRICOLÂNDIA', null, [{ id: 'x', nome: 'MUNICÍPIO DE PALMEIRAIS -PI', documento: null }], 3),
    ).toEqual([]);
  });
});

describe('a sigla de um é o nome do outro', () => {
  const cidades = ruidoDeCidades([{ cidade: 'Teresina' }, { cidade: 'Parnaíba' }]);

  it('a sigla sai sem forma societária, conectivo e lugar', () => {
    expect(siglaDoNome('FUNDAÇÃO MUNICIPAL DE SAÚDE')).toBe('fms');
    expect(siglaDoNome('HOSPITAL UNIMED TERESINA S/S LTDA', cidades)).toBe('hu');
  });

  it('"FMS" e "Fundação Municipal de Saúde", na mesma cidade, são apontadas', () => {
    const r = partesParecidas(
      'Fundação Municipal de Saúde.',
      null,
      [{ id: 'x', nome: 'FMS/THE', nomeFantasia: 'FMS Teresina', cidade: 'Teresina', documento: '05522917000170' }],
      3,
      cidades,
      'Teresina',
    );
    expect(r[0]?.motivo).toBe('SIGLA');
  });

  it('e no sentido contrário também', () => {
    const r = partesParecidas(
      'FMS/THE',
      null,
      [{ id: 'x', nome: 'Fundação Municipal de Saúde.', cidade: 'TERESINA', documento: null }],
      3,
      cidades,
      'Teresina',
    );
    expect(r[0]?.motivo).toBe('SIGLA');
  });

  /** Sigla repete de cidade em cidade — toda prefeitura tem uma "SMS". */
  it('a mesma sigla em cidades diferentes não é indício', () => {
    const r = partesParecidas(
      'SECRETARIA MUNICIPAL DE SAÚDE',
      null,
      [{ id: 'x', nome: 'SMS', cidade: 'Parnaíba', documento: null }],
      3,
      cidades,
      'Teresina',
    );
    expect(r).toEqual([]);
  });

  it('sem a cidade dos dois lados, a sigla fica muda', () => {
    expect(
      partesParecidas('SECRETARIA MUNICIPAL DE SAÚDE', null, [{ id: 'x', nome: 'SMS', documento: null }], 3),
    ).toEqual([]);
  });

  /** O lugar não entra na sigla: senão "HOSPITAL UNIMED TERESINA" viraria o HUT. */
  it('não confunde o HUT com o Hospital Unimed de Teresina', () => {
    const r = partesParecidas(
      'HOSPITAL UNIMED TERESINA S/S LTDA',
      null,
      [{ id: 'x', nome: 'HOSPITAL DE URGÊNCIA DE TERESINA', nomeFantasia: 'HUT', cidade: 'Teresina', documento: null }],
      3,
      cidades,
      'Teresina',
    );
    expect(r).toEqual([]);
  });
});
