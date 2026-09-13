import { REPETICOES_PARA_MOSTRAR, chaveDoAssuntoOutro, outrosDoAssunto } from './relatorio.util';

/**
 * "EM OUTRO: APOSENTADORIA (4), PLANO DE SAÚDE (2); 3 COM TEXTO ÚNICO".
 *
 * O que a diretoria precisa é saber qual categoria falta — e o sinal disso é a
 * repetição. Texto único não sai com nome: no papel ele pode identificar uma
 * pessoa.
 */
describe('o que há dentro de "Outro"', () => {
  const outro = (assuntoOutro: string | null) => ({ assunto: 'OUTRO', assuntoOutro });

  it('agrupa sem acento, sem caixa e sem espaço sobrando', () => {
    expect(chaveDoAssuntoOutro('  Plano   de SAÚDE ')).toBe('plano de saude');
    expect(chaveDoAssuntoOutro('Aposentadoria')).toBe(chaveDoAssuntoOutro('aposentadória'));
  });

  /** A `normalizarNome` do editor cola as palavras; esta não pode colar. */
  it('não cola as palavras', () => {
    expect(chaveDoAssuntoOutro('plano de saúde')).not.toBe(chaveDoAssuntoOutro('planodesaude'));
  });

  it('só os textos que se repetem saem com nome; os outros viram um número', () => {
    const r = outrosDoAssunto([
      outro('Aposentadoria'),
      outro('aposentadoria'),
      outro('APOSENTADÓRIA '),
      outro('Aposentadoria'),
      outro('Plano de saúde'),
      outro('plano  de saude'),
      outro('demissão da Maria da UBS'),
      outro('Férias'),
      outro('Auxílio creche'),
    ]);
    expect(REPETICOES_PARA_MOSTRAR).toBe(2);
    expect(r.outrosAssuntos).toEqual([
      { texto: 'Aposentadoria', total: 4 },
      { texto: 'plano de saude', total: 2 },
    ]);
    expect(r.outrosUnicos).toBe(3);
    expect(JSON.stringify(r)).not.toContain('Maria');
  });

  it('o rótulo é a grafia mais usada; no empate, a primeira em ordem alfabética', () => {
    const r = outrosDoAssunto([outro('Plano de Saúde'), outro('plano de saúde')]);
    expect(r.outrosAssuntos).toEqual([{ texto: 'plano de saúde', total: 2 }]);
  });

  it('ignora o que não é "Outro" e o "Outro" sem texto', () => {
    const r = outrosDoAssunto([
      { assunto: 'REMUNERACAO', assuntoOutro: 'aposentadoria' },
      { assunto: 'REMUNERACAO', assuntoOutro: 'aposentadoria' },
      outro(null),
      outro('   '),
      { assunto: null, assuntoOutro: null },
    ]);
    expect(r).toEqual({ outrosAssuntos: [], outrosUnicos: 0 });
  });

  it('a mesma entrada dá sempre a mesma saída, em qualquer ordem', () => {
    const itens = [outro('b'), outro('a'), outro('B'), outro('A'), outro('c')];
    expect(outrosDoAssunto(itens)).toEqual(outrosDoAssunto([...itens].reverse()));
  });
});
