import { paraComparar } from './ultima-movimentacao.util';

/**
 * *"Na listagem, diz que a última movimentação do processo foi ontem. Mas fui
 * ver e teve publicação do DJEN hoje."* — 24/09/2026.
 *
 * O caso real, medido na produção no processo 0001381-91.2023.5.22.0101:
 *
 *   publicação no Diário .... `data_disponibilizacao = 2026-09-24` (`@db.Date`)
 *   o Prisma entrega ........ `2026-09-24T00:00:00.000Z`
 *   em Teresina (UTC−3) ..... 23/09 às 21h  ← a coluna escrevia "ontem"
 *
 * O mesmo engano quebrava a escolha do "mais novo": meia-noite UTC do dia D
 * fica ANTES de uma nota escrita no dia D−1 às 22h de Teresina.
 */

/** Como o Prisma entrega uma coluna `@db.Date`. */
const diario = (dia: string) => ({ data: new Date(`${dia}T00:00:00.000Z`), diaPuro: true });

/** Um instante de verdade, escrito em hora de Teresina. */
const instante = (iso: string) => ({ data: new Date(iso), diaPuro: false });

describe('a data pura disputa como o fim do seu dia em Teresina', () => {
  it('a publicação de hoje ganha do andamento de ontem à tarde', () => {
    expect(paraComparar(diario('2026-09-24'))).toBeGreaterThan(
      paraComparar(instante('2026-09-23T18:00:00.000Z')), // 23/09 15h em Teresina
    );
  });

  /**
   * O CASO QUE A COMPARAÇÃO ANTIGA PERDIA. 23/09 às 22h de Teresina é
   * `2026-09-24T01:00:00Z` — DEPOIS da meia-noite UTC do dia 24. A nota de
   * ontem à noite vencia a publicação de hoje.
   */
  it('e ganha também da nota escrita ontem às 22h', () => {
    expect(paraComparar(diario('2026-09-24'))).toBeGreaterThan(
      paraComparar(instante('2026-09-24T01:00:00.000Z')),
    );
  });

  /**
   * NO MESMO DIA, A PUBLICAÇÃO VENCE — de propósito. Ela é o ato que corre
   * prazo; o andamento burocrático do mesmo dia não muda o que a equipe tem de
   * fazer. E como o Diário não informa a hora, qualquer outra escolha seria
   * inventar uma.
   */
  it('no mesmo dia, a publicação vence o que tem hora', () => {
    expect(paraComparar(diario('2026-09-24'))).toBeGreaterThan(
      paraComparar(instante('2026-09-24T23:59:00.000Z')), // 24/09 20h59 em Teresina
    );
  });

  it('mas não invade o dia seguinte', () => {
    expect(paraComparar(diario('2026-09-24'))).toBeLessThan(
      paraComparar(instante('2026-09-25T03:00:00.000Z')), // 25/09 00h em Teresina
    );
  });

  it('a publicação mais nova ganha da mais velha', () => {
    expect(paraComparar(diario('2026-09-24'))).toBeGreaterThan(
      paraComparar(diario('2026-09-03')),
    );
  });

  /** Instante contra instante: nada muda, é o valor dele mesmo. */
  it('entre instantes, a comparação continua sendo a de sempre', () => {
    const a = instante('2026-09-24T10:00:00.000Z');
    const b = instante('2026-09-24T11:00:00.000Z');
    expect(paraComparar(a)).toBe(a.data.getTime());
    expect(paraComparar(b)).toBeGreaterThan(paraComparar(a));
  });

  /**
   * A CONTA NÃO LÊ O RELÓGIO. O contêiner roda em UTC e a máquina de quem
   * desenvolve, não — um teste que dependesse do fuso do processo passaria aqui
   * e falharia na CI, ou pior, o contrário.
   */
  it('não depende do fuso de quem roda', () => {
    const esperado = new Date('2026-09-25T02:59:59.999Z').getTime();
    expect(paraComparar(diario('2026-09-24'))).toBe(esperado);
  });
});
