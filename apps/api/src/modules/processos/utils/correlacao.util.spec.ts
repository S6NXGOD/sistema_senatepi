import {
  correlacionar,
  type ComunicacaoCorrelacionavel,
  type MovimentacaoCorrelacionavel,
} from './correlacao.util';

/** Movimentação de intimação (classifica como PRAZO no classificador do DataJud). */
function mov(
  id: string,
  data: string,
  descricao = 'Expedição de documento',
  extras: Partial<MovimentacaoCorrelacionavel> = {},
): MovimentacaoCorrelacionavel {
  return {
    id,
    dataMovimento: new Date(`${data}T12:00:00-03:00`),
    descricao,
    detalhe: 'Intimação',
    conteudo: null,
    codigoMovimento: 60,
    compromissoId: null,
    ...extras,
  };
}

function pub(
  id: string,
  data: string,
  extras: Partial<ComunicacaoCorrelacionavel> = {},
): ComunicacaoCorrelacionavel {
  return {
    id,
    dataDisponibilizacao: new Date(`${data}T00:00:00Z`),
    movimentacaoId: null,
    ehPauta: false,
    ...extras,
  };
}

describe('correlacionar — qual publicação descreve qual movimentação', () => {
  it('sem publicações, não há par', () => {
    expect(correlacionar([], [mov('m1', '2026-08-03')])).toEqual([]);
  });

  it('sem movimentações, não há par (o DJEN chegou primeiro)', () => {
    expect(correlacionar([pub('c1', '2026-08-04')], [])).toEqual([]);
  });

  it('pareia o ato de ontem com a publicação de hoje', () => {
    const pares = correlacionar([pub('c1', '2026-08-04')], [mov('m1', '2026-08-03')]);
    expect(pares).toEqual([{ comunicacaoId: 'c1', movimentacaoId: 'm1', deltaDias: 1 }]);
  });

  it('pareia ato e publicação no mesmo dia', () => {
    const pares = correlacionar([pub('c1', '2026-08-03')], [mov('m1', '2026-08-03')]);
    expect(pares[0]?.deltaDias).toBe(0);
  });

  describe('janela de 3 dias', () => {
    /** Ato na sexta, publicação na segunda — o caso que a janela existe para cobrir. */
    it('aceita 3 dias de diferença', () => {
      expect(correlacionar([pub('c1', '2026-08-03')], [mov('m1', '2026-07-31')])).toHaveLength(1);
    });

    it('recusa 4 dias', () => {
      expect(correlacionar([pub('c1', '2026-08-04')], [mov('m1', '2026-07-31')])).toHaveLength(0);
    });

    /**
     * A publicação SAI DEPOIS do ato. Uma publicação anterior ao movimento
     * descreve outra coisa — parear seria inventar uma relação.
     */
    it('recusa publicação ANTERIOR ao movimento', () => {
      expect(correlacionar([pub('c1', '2026-08-01')], [mov('m1', '2026-08-03')])).toHaveLength(0);
    });
  });

  describe('só atos que abrem prazo', () => {
    it('não pareia com movimentação irrelevante', () => {
      const remessa = mov('m1', '2026-08-03', 'Remessa', { detalhe: null, codigoMovimento: 123 });
      expect(correlacionar([pub('c1', '2026-08-04')], [remessa])).toHaveLength(0);
    });

    /**
     * Caso especial: quando os DOIS lados falam de pauta, o par vale. O texto do
     * DJEN traz a data com muito mais frequência que o rótulo do DataJud, e
     * deixá-los soltos criaria uma audiência pelo radar e uma preparação pelo
     * DJEN.
     */
    it('pareia designação de audiência quando a publicação também é pauta', () => {
      const designacao = mov('m1', '2026-08-03', 'Audiência designada para 15/09/2026', {
        detalhe: null,
        codigoMovimento: 11025,
      });
      expect(
        correlacionar([pub('c1', '2026-08-04', { ehPauta: true })], [designacao]),
      ).toHaveLength(1);
      // Publicação comum não absorve a designação: quem cuida dela é o radar.
      expect(
        correlacionar([pub('c1', '2026-08-04', { ehPauta: false })], [designacao]),
      ).toHaveLength(0);
    });
  });

  describe('atribuição um-para-um', () => {
    it('entre duas candidatas, vence a de menor distância', () => {
      const pares = correlacionar(
        [pub('c1', '2026-08-04')],
        [mov('m1', '2026-08-01'), mov('m2', '2026-08-03')],
      );
      expect(pares).toHaveLength(1);
      expect(pares[0].movimentacaoId).toBe('m2');
    });

    it('duas publicações não disputam a mesma movimentação', () => {
      const pares = correlacionar(
        [pub('c1', '2026-08-04'), pub('c2', '2026-08-04')],
        [mov('m1', '2026-08-03')],
      );
      expect(pares).toHaveLength(1);
    });

    it('cada publicação pega a sua quando há duas de cada', () => {
      const pares = correlacionar(
        [pub('c1', '2026-08-01'), pub('c2', '2026-08-04')],
        [mov('m1', '2026-08-01'), mov('m2', '2026-08-04')],
      );
      expect(pares).toHaveLength(2);
      expect(pares.find((p) => p.comunicacaoId === 'c1')?.movimentacaoId).toBe('m1');
      expect(pares.find((p) => p.comunicacaoId === 'c2')?.movimentacaoId).toBe('m2');
    });

    /** Determinismo: reexecutar sobre os mesmos dados dá os mesmos pares. */
    it('empate resolve por id, de forma estável', () => {
      const a = correlacionar([pub('c1', '2026-08-04')], [mov('m1', '2026-08-03'), mov('m2', '2026-08-03')]);
      const b = correlacionar([pub('c1', '2026-08-04')], [mov('m2', '2026-08-03'), mov('m1', '2026-08-03')]);
      expect(a[0].movimentacaoId).toBe('m1');
      expect(b[0].movimentacaoId).toBe('m1');
    });
  });

  describe('o que já está pareado fica de fora', () => {
    it('publicação já pareada não entra na disputa', () => {
      const pares = correlacionar(
        [pub('c1', '2026-08-04', { movimentacaoId: 'm9' })],
        [mov('m1', '2026-08-03')],
      );
      expect(pares).toHaveLength(0);
    });

    it('movimentação já reivindicada por outra publicação não é repareada', () => {
      const pares = correlacionar(
        [pub('c1', '2026-08-04', { movimentacaoId: 'm1' }), pub('c2', '2026-08-04')],
        [mov('m1', '2026-08-03')],
      );
      expect(pares).toHaveLength(0);
    });

    /**
     * Movimentação que JÁ virou atividade continua elegível: é o cenário A, em
     * que a publicação enriquece a tarefa existente em vez de criar outra.
     */
    it('movimentação que já gerou atividade CONTINUA elegível', () => {
      const pares = correlacionar(
        [pub('c1', '2026-08-04')],
        [mov('m1', '2026-08-03', 'Expedição de documento', { compromissoId: 'comp-1' })],
      );
      expect(pares).toHaveLength(1);
    });
  });
});
