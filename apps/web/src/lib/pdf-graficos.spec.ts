import {
  agruparResto, clarear, escalaDoEixo, foraDaFontePadrao, paraAFontePadrao, passoDosRotulos,
  rotulosDosMeses, textoDaComparacao, variacao,
} from './pdf-graficos';

describe('o eixo dos gráficos', () => {
  it('arredonda para números que se leem de relance', () => {
    expect(escalaDoEixo(37)).toEqual({ max: 40, passos: [0, 10, 20, 30, 40] });
    expect(escalaDoEixo(7)).toEqual({ max: 8, passos: [0, 2, 4, 6, 8] });
    expect(escalaDoEixo(102)).toEqual({ max: 150, passos: [0, 50, 100, 150] });
  });

  /** Aqui só se conta coisa inteira: meio atendimento não existe. */
  it('nunca divide o eixo em frações', () => {
    expect(escalaDoEixo(3)).toEqual({ max: 3, passos: [0, 1, 2, 3] });
    expect(escalaDoEixo(1)).toEqual({ max: 1, passos: [0, 1] });
  });

  it('tudo zerado não quebra a conta', () => {
    expect(escalaDoEixo(0)).toEqual({ max: 1, passos: [0, 1] });
  });
});

describe('a comparação com o período anterior', () => {
  it('diz quanto mudou, com sinal e sem seta', () => {
    expect(variacao(112, 100)).toBe('+12%');
    expect(variacao(50, 100)).toBe('-50%');
    expect(variacao(34, 34)).toBe('igual');
  });

  /** De 2 para 3 é "+1": "+50%" sobre dois atendimentos soa como explosão. */
  it('base pequena sai em unidades, e não em porcentagem', () => {
    expect(variacao(3, 2)).toBe('+1');
    expect(variacao(0, 4)).toBe('-4');
    expect(variacao(5, 0)).toBe('+5');
  });

  it('diferença que arredonda para 0% não vira "igual"', () => {
    expect(variacao(1003, 1000)).toBe('+3');
  });

  it('a linha que vai embaixo do número', () => {
    expect(textoDaComparacao(1232, 1100)).toBe('antes 1.100 · +12%');
  });
});

describe('o que cabe no gráfico', () => {
  it('lista longa agrupa a cauda sem mudar o total', () => {
    const itens = [5, 4, 3, 2, 1].map((total, i) => ({ rotulo: `r${i}`, total, chave: 'x' }));
    const agrupado = agruparResto(itens, 3);
    expect(agrupado).toEqual([
      { rotulo: 'r0', total: 5 },
      { rotulo: 'r1', total: 4 },
      { rotulo: '3 outros', total: 6 },
    ]);
    expect(agrupado.reduce((s, i) => s + i.total, 0)).toBe(15);
    expect(agruparResto(itens, 5)).toHaveLength(5);
  });

  it('os meses levam o ano só quando atravessam a virada', () => {
    expect(rotulosDosMeses(['2026-08', '2026-09'])).toEqual(['ago', 'set']);
    expect(rotulosDosMeses(['2025-12', '2026-01'])).toEqual(['dez/25', 'jan/26']);
  });

  it('rótulo largo demais pula colunas, em vez de encostar no vizinho', () => {
    expect(passoDosRotulos(15, 9)).toBe(1);
    expect(passoDosRotulos(6, 9)).toBe(2);
  });

  it('a semana com menos uso sai mais clara', () => {
    expect(clarear([27, 127, 10], 1)).toEqual([27, 127, 10]);
    expect(clarear([27, 127, 10], 0)).toEqual([255, 255, 255]);
  });
});

describe('as letras que o PDF sabe desenhar', () => {
  it('acento, ponto do meio, travessão e aspas curvas passam', () => {
    expect(foraDaFontePadrao('Sentenças · “até agora” — ação')).toEqual([]);
  });

  it('seta, menos tipográfico e emoji são apontados', () => {
    expect(foraDaFontePadrao('subiu ↑ −3 🎉')).toEqual(['↑', '−', '🎉']);
  });

  /** O título e a observação são digitados: passam pelo mesmo filtro antes do papel. */
  it('o que a pessoa digita vira o parente mais próximo, ou some', () => {
    expect(paraAFontePadrao('Assembleia → 20/09 −3 🎉')).toBe('Assembleia - 20/09 -3 ');
  });
});
