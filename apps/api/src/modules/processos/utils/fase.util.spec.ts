import { faseDoProcesso } from './fase.util';

/**
 * A ordem de precedência é a única parte discutível da regra — por isso os
 * testes atacam justamente as combinações em que duas fases competem.
 */
describe('faseDoProcesso — em que pé está o processo', () => {
  const g1 = (baixada = false) => ({ grau: 'G1', baixada });
  const g2 = (baixada = false) => ({ grau: 'G2', baixada });

  it('todas as instâncias baixadas → ARQUIVADO', () => {
    expect(
      faseDoProcesso({ instancias: [g1(true), g2(true)], temMovimentoDeExecucao: true }),
    ).toBe('ARQUIVADO');
  });

  it('sem instância nenhuma (rascunho) → CONHECIMENTO, nunca ARQUIVADO', () => {
    expect(faseDoProcesso({ instancias: [], temMovimentoDeExecucao: false })).toBe('CONHECIMENTO');
  });

  it('1º grau vivo, sem ato de execução → CONHECIMENTO', () => {
    expect(faseDoProcesso({ instancias: [g1()], temMovimentoDeExecucao: false })).toBe('CONHECIMENTO');
  });

  it('1º grau vivo com execução iniciada → EXECUCAO', () => {
    expect(faseDoProcesso({ instancias: [g1()], temMovimentoDeExecucao: true })).toBe('EXECUCAO');
  });

  /**
   * O CASO REAL do 0000600-48.2023.5.22.0108 (TRT22): G2 com baixa definitiva e
   * G1 executando desde o trânsito em julgado. O que a equipe faz nele é
   * execução — e era exatamente o processo que o sistema dava como encerrado.
   */
  it('G2 baixado + G1 executando → EXECUCAO (a baixa do recurso não arquiva o processo)', () => {
    expect(
      faseDoProcesso({ instancias: [g1(), g2(true)], temMovimentoDeExecucao: true }),
    ).toBe('EXECUCAO');
  });

  it('recurso pendente vence a execução provisória — o acórdão pode derrubá-la', () => {
    expect(
      faseDoProcesso({ instancias: [g1(), g2()], temMovimentoDeExecucao: true }),
    ).toBe('RECURSAL');
  });

  it('turma recursal conta como recursal, apesar do grau baixo', () => {
    expect(
      faseDoProcesso({ instancias: [{ grau: 'TR', baixada: false }], temMovimentoDeExecucao: false }),
    ).toBe('RECURSAL');
  });

  it('tribunal superior conta como recursal', () => {
    for (const grau of ['G3', 'TST', 'STJ', 'STF', 'SUP']) {
      expect(faseDoProcesso({ instancias: [{ grau, baixada: false }], temMovimentoDeExecucao: false })).toBe('RECURSAL');
    }
  });

  /**
   * A REGRA QUE O RECURSO NO TST IMPÕE: enquanto o tribunal superior não
   * baixar, o processo não acabou — nem que 1º e 2º grau já estejam baixados.
   *
   * O grau do TST vem como "SUP" no DataJud (documento TST_SUP_<npu>), e é
   * assim que ele chega aqui.
   */
  it('recurso vivo no TST impede o arquivamento, com 1º e 2º grau baixados', () => {
    expect(
      faseDoProcesso({
        instancias: [
          { grau: 'G1', baixada: true },
          { grau: 'G2', baixada: true },
          { grau: 'SUP', baixada: false },
        ],
        temMovimentoDeExecucao: true,
      }),
    ).toBe('RECURSAL');
  });

  /** Caso real do 0001000-26.2022.5.22.0002: o TST também baixou (20/08/2025). */
  it('com o TST baixado junto dos demais, aí sim é arquivado', () => {
    expect(
      faseDoProcesso({
        instancias: [
          { grau: 'G1', baixada: true },
          { grau: 'G2', baixada: true },
          { grau: 'SUP', baixada: true },
        ],
        temMovimentoDeExecucao: true,
      }),
    ).toBe('ARQUIVADO');
  });

  it('grau em caixa baixa ou nulo não quebra a regra', () => {
    expect(faseDoProcesso({ instancias: [{ grau: 'g2', baixada: false }], temMovimentoDeExecucao: false })).toBe('RECURSAL');
    expect(faseDoProcesso({ instancias: [{ grau: null, baixada: false }], temMovimentoDeExecucao: false })).toBe('CONHECIMENTO');
  });
});

/**
 * PRÉ-PROCESSUAL — a fase que existe ANTES de haver processo.
 *
 * Vem antes de todas as outras na precedência, e a razão é mecânica: as demais
 * regras leem instâncias, e um caso sem NPU não tem nenhuma. Sem esta primeira
 * checagem ele cairia em CONHECIMENTO e se misturaria com processo que corre —
 * exatamente a confusão que a fase nova veio desfazer.
 */
describe('fase pré-processual', () => {
  it('sem número, é pré-processual', () => {
    expect(faseDoProcesso({ instancias: [], temMovimentoDeExecucao: false, semNumero: true }))
      .toBe('PRE_PROCESSUAL');
  });

  it('vence até o arquivamento e a execução', () => {
    expect(faseDoProcesso({
      instancias: [{ grau: 'G1', baixada: true }],
      temMovimentoDeExecucao: true,
      semNumero: true,
    })).toBe('PRE_PROCESSUAL');
  });

  /** Compatibilidade: quem já chamava sem o campo continua no comportamento antigo. */
  it('sem o campo, nada muda', () => {
    expect(faseDoProcesso({ instancias: [], temMovimentoDeExecucao: false }))
      .toBe('CONHECIMENTO');
  });

  it('ajuizado depois deixa de ser pré-processual', () => {
    expect(faseDoProcesso({
      instancias: [{ grau: 'G1', baixada: false }],
      temMovimentoDeExecucao: false,
      semNumero: false,
    })).toBe('CONHECIMENTO');
  });
});
