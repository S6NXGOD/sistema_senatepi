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
    for (const grau of ['G3', 'TST', 'STJ', 'STF']) {
      expect(faseDoProcesso({ instancias: [{ grau, baixada: false }], temMovimentoDeExecucao: false })).toBe('RECURSAL');
    }
  });

  it('grau em caixa baixa ou nulo não quebra a regra', () => {
    expect(faseDoProcesso({ instancias: [{ grau: 'g2', baixada: false }], temMovimentoDeExecucao: false })).toBe('RECURSAL');
    expect(faseDoProcesso({ instancias: [{ grau: null, baixada: false }], temMovimentoDeExecucao: false })).toBe('CONHECIMENTO');
  });
});
