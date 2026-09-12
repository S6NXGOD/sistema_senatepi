import {
  ANOS_NA_SERIE, anosDaSerie, resultadoDoCodigo, rotuloDaComarca, serieDeAjuizadas,
  serieDeSentencas, umaPorProcesso,
} from './relatorio.util';

describe('as contas do relatório', () => {
  /** O desfecho é o que o tribunal carimbou; código desconhecido não vira resultado. */
  it('traduz só os três carimbos de julgamento', () => {
    expect(resultadoDoCodigo(219)).toBe('PROCEDENTE');
    expect(resultadoDoCodigo(221)).toBe('PARCIAL');
    expect(resultadoDoCodigo(220)).toBe('IMPROCEDENTE');
    // Provimento de recurso tem outro código e não é sentença.
    expect(resultadoDoCodigo(237)).toBeNull();
    expect(resultadoDoCodigo(null)).toBeNull();
  });

  it('a série tem seis anos e termina no ano corrente', () => {
    expect(ANOS_NA_SERIE).toBe(6);
    expect(anosDaSerie(2026)).toEqual([2021, 2022, 2023, 2024, 2025, 2026]);
  });

  /** O ano sem sentença aparece como zero — sumir com ele contaria outra história. */
  it('preenche os anos sem sentença com zero', () => {
    const serie = serieDeSentencas(
      [
        { ano: 2025, codigo: 219, processos: 9 },
        { ano: 2025, codigo: 221, processos: 20 },
        { ano: 2025, codigo: 220, processos: 5 },
        { ano: 2021, codigo: 219, processos: 1 },
      ],
      anosDaSerie(2026),
    );
    expect(serie).toHaveLength(6);
    expect(serie.find((a) => a.ano === 2025)).toEqual({
      ano: 2025, procedentes: 9, parciais: 20, improcedentes: 5,
    });
    expect(serie.find((a) => a.ano === 2023)).toEqual({
      ano: 2023, procedentes: 0, parciais: 0, improcedentes: 0,
    });
  });

  it('ignora ano fora da série e código que não é julgamento', () => {
    const serie = serieDeSentencas(
      [
        { ano: 2019, codigo: 219, processos: 3 },
        { ano: 2024, codigo: 999, processos: 7 },
      ],
      anosDaSerie(2026),
    );
    expect(serie.reduce((t, a) => t + a.procedentes + a.parciais + a.improcedentes, 0)).toBe(0);
  });

  it('ações ajuizadas por ano, com zero onde não houve', () => {
    expect(serieDeAjuizadas([{ ano: 2026, processos: 36 }], [2025, 2026])).toEqual([
      { ano: 2025, processos: 0 },
      { ano: 2026, processos: 36 },
    ]);
  });

  /** Embargos e sentença refeita: o processo aparece uma vez, com o carimbo mais novo. */
  it('uma linha por processo, a primeira da lista (a mais recente)', () => {
    const lista = umaPorProcesso([
      { processoId: 'a', resultado: 'PROCEDENTE' },
      { processoId: 'b', resultado: 'IMPROCEDENTE' },
      { processoId: 'a', resultado: 'IMPROCEDENTE' },
    ]);
    expect(lista).toEqual([
      { processoId: 'a', resultado: 'PROCEDENTE' },
      { processoId: 'b', resultado: 'IMPROCEDENTE' },
    ]);
  });

  it('a UF só aparece fora do estado da casa', () => {
    expect(rotuloDaComarca('Teresina', 'PI', 'PI')).toBe('Teresina');
    expect(rotuloDaComarca('Brasília', 'df', 'PI')).toBe('Brasília (DF)');
  });
});
