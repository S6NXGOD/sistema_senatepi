import { nomeDoCaso } from './nome-do-caso.util';

/**
 * O NOME DO CASO NO CARTÃO DA AGENDA.
 *
 * O criador de pauta usava `processo.filiado?.nomeCompleto ?? 'filiado'`.
 * Como nunca tinha rodado, ninguém viu que `processos.filiado_id` está nulo
 * em 177 dos 204 processos: 87% dos cartões diriam "Audiência inicial —
 * filiado". Estes testes são a escada que substitui aquele `??`.
 */

const SINDICATO = { institucional: true };

describe('nomeDoCaso', () => {
  it('usa o filiado do processo quando ele existe', () => {
    expect(
      nomeDoCaso({
        numeroCNJ: '00008959520265220103',
        filiado: { nomeCompleto: 'Maria das Graças Sousa' },
        partes: [{ nome: 'OUTRA COISA', polo: 'PASSIVO' }],
      }),
    ).toBe('Maria das Graças Sousa');
  });

  it('usa a parte ligada a um filiado quando o atalho do processo está vazio', () => {
    expect(
      nomeDoCaso({
        numeroCNJ: '00008959520265220103',
        filiado: null,
        partes: [
          { nome: 'MARIA DAS GRACAS S.', polo: 'ATIVO', filiadoId: 'f1', filiado: { nomeCompleto: 'Maria das Graças Sousa' } },
          { nome: 'CLÍNICA X LTDA', polo: 'PASSIVO' },
        ],
      }),
    ).toBe('Maria das Graças Sousa');
  });

  /**
   * AÇÃO INSTITUCIONAL: o sindicato é parte e quem nomeia o caso é o OUTRO
   * lado. "Audiência inicial — Estado do Piauí" é como a equipe fala do caso.
   * O título não afirma papel nenhum: afirmar papel a partir de polo é o erro
   * que já pôs a própria filiada na coluna "réu" do painel.
   */
  it('com o sindicato no polo ativo, o nome é o do polo passivo', () => {
    expect(
      nomeDoCaso({
        numeroCNJ: '08119078920248180140',
        filiado: null,
        partes: [
          { nome: 'SINDICATO DOS ENFERMEIROS DO PIAUÍ', polo: 'ATIVO', parteExterna: SINDICATO },
          { nome: 'ESTADO DO PIAUÍ', polo: 'PASSIVO' },
        ],
      }),
    ).toBe('ESTADO DO PIAUÍ');
  });

  /** E quando a ação é CONTRA o sindicato, o nome é o do polo ativo. */
  it('com o sindicato no polo passivo, o nome é o do polo ativo', () => {
    expect(
      nomeDoCaso({
        numeroCNJ: '08119078920248180140',
        filiado: null,
        partes: [
          { nome: 'ANTÔNIO DE SOUSA', polo: 'ATIVO' },
          { nome: 'SINDICATO DOS ENFERMEIROS DO PIAUÍ', polo: 'PASSIVO', parteExterna: SINDICATO },
        ],
      }),
    ).toBe('ANTÔNIO DE SOUSA');
  });

  it('sem o sindicato entre as partes, vale a parte do polo ativo', () => {
    expect(
      nomeDoCaso({
        numeroCNJ: '00008959520265220103',
        filiado: null,
        partes: [
          { nome: 'HAPVIDA ASSISTÊNCIA MÉDICA LTDA', polo: 'PASSIVO' },
          { nome: 'KARLA DANIELLE ROCHA', polo: 'ATIVO' },
        ],
      }),
    ).toBe('KARLA DANIELLE ROCHA');
  });

  /** "1. ESTADO DO PIAUÍ (AGRAVANTE)" vem assim do cadastro; o cartão não. */
  it('tira o número da lista e o papel entre parênteses', () => {
    expect(
      nomeDoCaso({
        numeroCNJ: '00135633220158180140',
        filiado: null,
        partes: [{ nome: '1. ESTADO DO PIAUÍ (AGRAVANTE)', polo: 'ATIVO' }],
      }),
    ).toBe('ESTADO DO PIAUÍ');
  });

  it('corta o nome gigante — é cartão de agenda, não petição', () => {
    const gigante = 'ASSOCIAÇÃO BENEFICENTE DE AMPARO AO TRABALHADOR RURAL DO MUNICÍPIO DE SÃO JOÃO';
    const r = nomeDoCaso({ numeroCNJ: null, filiado: null, partes: [{ nome: gigante, polo: 'ATIVO' }] });
    expect(r.length).toBeLessThanOrEqual(56);
    expect(r.endsWith('…')).toBe(true);
  });

  /**
   * SÓ O SINDICATO NAS PARTES — 5 processos da produção. Não há "outro lado";
   * o número é a única identificação honesta, e vai FORMATADO.
   */
  it('quando só o sindicato é parte, cai no número formatado', () => {
    expect(
      nomeDoCaso({
        numeroCNJ: '10119984420194014000',
        filiado: null,
        partes: [{ nome: 'SINDICATO DOS ENFERMEIROS DO PIAUÍ', polo: 'PASSIVO', parteExterna: SINDICATO }],
      }),
    ).toBe('1011998-44.2019.4.01.4000');
  });

  it('sem partes e sem número, diz a verdade sobre o pré-processual', () => {
    expect(nomeDoCaso({ numeroCNJ: null, filiado: null, partes: [] })).toBe('processo sem número');
  });

  /** Nunca devolve string vazia: nome em branco no cadastro não apaga o cartão. */
  it('ignora parte com nome em branco', () => {
    expect(
      nomeDoCaso({
        numeroCNJ: '10119984420194014000',
        filiado: { nomeCompleto: '   ' },
        partes: [{ nome: '  ', polo: 'ATIVO' }],
      }),
    ).toBe('1011998-44.2019.4.01.4000');
  });
});
