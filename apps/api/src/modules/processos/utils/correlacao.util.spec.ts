import {
  aDecisaoDoDiarioAtravessa,
  correlacionar,
  DECISOES_DE_RELOGIO,
  DECISOES_DO_TEOR,
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

  describe('janela: 5 dias antes do ato, 3 depois', () => {
    /** Ato na sexta, publicação na segunda — o caso que a janela existe para cobrir. */
    it('aceita 3 dias de diferença', () => {
      expect(correlacionar([pub('c1', '2026-08-03')], [mov('m1', '2026-07-31')])).toHaveLength(1);
    });

    it('recusa 4 dias depois', () => {
      expect(correlacionar([pub('c1', '2026-08-04')], [mov('m1', '2026-07-31')])).toHaveLength(0);
    });

    /**
     * O CASO DOS 153 (17/09/2026).
     *
     * O DJEN publica o teor em D+0; o DataJud registra o mesmo ato com mediana
     * de 62 dias de atraso. Das 294 movimentações de publicação/intimação dos
     * últimos 60 dias, 153 têm o teor até CINCO DIAS ANTES do andamento — e 106
     * dessas viraram tarefa cega com o texto já gravado no banco.
     *
     * A regra antiga recusava tudo que fosse anterior ao ato, e este mesmo teste
     * afirmava a recusa. O arquivo guarda o erro: o número inverteu a regra.
     */
    it('aceita a publicação de 5 dias ANTES do ato — o teor chega primeiro', () => {
      const pares = correlacionar([pub('c1', '2026-08-01')], [mov('m1', '2026-08-06')]);
      expect(pares).toEqual([{ comunicacaoId: 'c1', movimentacaoId: 'm1', deltaDias: -5 }]);
    });

    it('aceita a publicação da véspera', () => {
      expect(correlacionar([pub('c1', '2026-08-02')], [mov('m1', '2026-08-03')])).toHaveLength(1);
    });

    /**
     * A cauda fica de fora: são 26 das 294, e esticar mais começaria a juntar
     * ato com ato. Num processo movimentado, a intimação de segunda e a de
     * sexta são fatos diferentes, e par errado é pior que par nenhum.
     */
    it('recusa 6 dias antes', () => {
      expect(correlacionar([pub('c1', '2026-07-31')], [mov('m1', '2026-08-06')])).toHaveLength(0);
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

    /**
     * Com a janela dos dois lados, "menor distância" passou a ser em MÓDULO: o
     * ato do dia 10 fica com o diário do dia 11, e não com o do dia 6.
     */
    it('a distância vale em módulo — o diário do dia seguinte ganha do de cinco dias antes', () => {
      const pares = correlacionar(
        [pub('c1', '2026-08-11')],
        [mov('m1', '2026-08-10'), mov('m2', '2026-08-16')],
      );
      expect(pares).toEqual([{ comunicacaoId: 'c1', movimentacaoId: 'm1', deltaDias: 1 }]);
    });

    /**
     * Mesma distância dos dois lados: vence a publicação que saiu DEPOIS, que é
     * a ordem em que o juízo pratica e só então divulga. Sem este degrau o
     * desempate seria o id, ou seja, sorteio.
     */
    it('empate de distância: prefere a publicação posterior ao ato', () => {
      const pares = correlacionar(
        [pub('antes', '2026-08-09'), pub('depois', '2026-08-11')],
        [mov('m1', '2026-08-10')],
      );
      expect(pares).toEqual([{ comunicacaoId: 'depois', movimentacaoId: 'm1', deltaDias: 1 }]);
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

    /**
     * O DEFEITO QUE O TERCEIRO PARÂMETRO CONSERTA (17/09/2026).
     *
     * O conjunto de "já tomadas" saía do próprio array de entrada, e os três
     * chamadores pedem ao banco só as publicações SEM par. O conjunto era
     * sempre vazio, e a publicação desta noite podia reapontar o andamento que
     * a publicação da semana passada já descreve — sem o lote da vez saber.
     */
    it('o andamento que o BANCO já sabe pareado não entra na disputa', () => {
      const soDoLote = correlacionar([pub('c2', '2026-08-04')], [mov('m1', '2026-08-03')]);
      expect(soDoLote).toHaveLength(1);

      const comOBanco = correlacionar([pub('c2', '2026-08-04')], [mov('m1', '2026-08-03')], ['m1']);
      expect(comOBanco).toHaveLength(0);
    });

    it('sobrando outro andamento, a publicação pega o que está livre', () => {
      const pares = correlacionar(
        [pub('c2', '2026-08-04')],
        [mov('m1', '2026-08-03'), mov('m2', '2026-08-04')],
        ['m1'],
      );
      expect(pares).toEqual([{ comunicacaoId: 'c2', movimentacaoId: 'm2', deltaDias: 0 }]);
    });
  });
});

/**
 * QUE DECISÃO DO DIÁRIO PODE ATRAVESSAR PARA O ANDAMENTO PAREADO.
 *
 * A linha é a natureza da decisão: o que foi julgado LENDO O TEOR vale para o
 * fato e atravessa; o que foi medido no RELÓGIO fala de quando a publicação
 * chegou a nós, e propagá-lo calaria o único lado que ainda poderia avisar.
 */
describe('a decisão que atravessa', () => {
  it.each(DECISOES_DO_TEOR)('%s atravessa — foi lida no texto do ato', (decisao) => {
    expect(aDecisaoDoDiarioAtravessa(decisao)).toBe(true);
  });

  /**
   * As duas de relógio são 2.310 das 2.380 publicações do acervo (1.419
   * NOTICIA_VELHA e 891 FORA_DA_JANELA). Propagá-las seria apagar o selo âmbar
   * de quase todo o acervo — que é exatamente o erro de 17/09 que esta frente
   * veio desfazer, só que em escala.
   */
  it.each(DECISOES_DE_RELOGIO)('%s NUNCA atravessa — é decisão de relógio', (decisao) => {
    expect(aDecisaoDoDiarioAtravessa(decisao)).toBe(false);
  });

  /** Lista branca: o motivo novo que ninguém pensou não carimba nada. */
  it('motivo desconhecido, nulo ou vazio não atravessa', () => {
    expect(aDecisaoDoDiarioAtravessa('MOTIVO_QUE_ALGUEM_INVENTAR')).toBe(false);
    expect(aDecisaoDoDiarioAtravessa(null)).toBe(false);
    expect(aDecisaoDoDiarioAtravessa('')).toBe(false);
  });

  /** A dispensa de relógio não pode entrar na lista por descuido de edição. */
  it('as duas listas não se cruzam', () => {
    for (const relogio of DECISOES_DE_RELOGIO) {
      expect(DECISOES_DO_TEOR as readonly string[]).not.toContain(relogio);
    }
  });
});
