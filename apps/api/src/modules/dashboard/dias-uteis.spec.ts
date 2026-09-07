import { diasUteisEntre } from './dias-uteis';

/**
 * O DIÁRIO NÃO CIRCULA NO FIM DE SEMANA — e o painel media o silêncio em horas.
 *
 * Conferido nas 1.408 publicações da produção: NENHUMA tem data de
 * disponibilização de sábado ou domingo (segunda 339, terça 201, quarta 322,
 * quinta 271, sexta 275). Com corte em 48h, todo domingo à noite a home
 * acusava a integração de silenciosa — enquanto o próprio texto do aviso dizia
 * que "fim de semana explica silêncio curto". A tela se contradizia toda semana.
 */
describe('dias úteis entre duas datas', () => {
  const d = (iso: string) => new Date(`${iso}T12:00:00-03:00`);

  /** O caso exato do print: sexta à noite → domingo à noite. */
  it('sexta para domingo dá zero — foi o falso alarme de todo fim de semana', () => {
    expect(diasUteisEntre(d('2026-09-04'), d('2026-09-06'))).toBe(0);
  });

  it('sexta para segunda dá um', () => {
    expect(diasUteisEntre(d('2026-09-04'), d('2026-09-07'))).toBe(1);
  });

  /** Dois dias ÚTEIS sem publicação: aí sim vale estranhar. */
  it('segunda para quarta dá dois', () => {
    expect(diasUteisEntre(d('2026-09-07'), d('2026-09-09'))).toBe(2);
  });

  it('uma semana cheia dá cinco', () => {
    expect(diasUteisEntre(d('2026-09-07'), d('2026-09-14'))).toBe(5);
  });

  it('o mesmo dia dá zero', () => {
    expect(diasUteisEntre(d('2026-09-08'), d('2026-09-08'))).toBe(0);
  });

  /** Relógio andando para trás não vira número negativo. */
  it('data futura dá zero em vez de negativo', () => {
    expect(diasUteisEntre(d('2026-09-10'), d('2026-09-08'))).toBe(0);
  });

  /** Sábado para domingo: nenhum expediente no meio. */
  it('sábado para domingo dá zero', () => {
    expect(diasUteisEntre(d('2026-09-05'), d('2026-09-06'))).toBe(0);
  });

  /**
   * O TESTE QUE FALTAVA — e sem ele o defeito viajou para a produção.
   *
   * Todos os casos acima usam meio-dia, longe da virada do dia em qualquer
   * fuso plausível. A conta era feita com `getDate()`/`getDay()`, que leem o
   * fuso do PROCESSO: no contêiner do Railway, que roda em UTC, o dia virava
   * às 21h de Brasília. Das 21h à meia-noite a função devolvia um dia a mais
   * e a faixa disparava uma noite inteira antes da hora.
   *
   * Aqui isto passava despercebido porque a máquina de desenvolvimento também
   * é UTC-3. É por isso que o caso abaixo força o horário: último sucesso na
   * segunda às 5h (o horário real do cron do DJEN) e "agora" na terça às 22h.
   * Passou UM dia útil — e um dia útil não pode virar dois por causa do fuso
   * em que o servidor foi hospedado.
   */
  it('conta o dia daqui, e não o dia do contêiner', () => {
    const segundaCedo = new Date('2026-09-07T05:00:00-03:00');
    const tercaANoite = new Date('2026-09-08T22:00:00-03:00');
    expect(diasUteisEntre(segundaCedo, tercaANoite)).toBe(1);
  });

  /** A mesma armadilha do outro lado da virada: 23h30 de sexta ainda é sexta. */
  it('a virada do dia é à meia-noite de Brasília, não às 21h', () => {
    const sextaQuaseMeiaNoite = new Date('2026-09-04T23:30:00-03:00');
    const domingoANoite = new Date('2026-09-06T23:30:00-03:00');
    expect(diasUteisEntre(sextaQuaseMeiaNoite, domingoANoite)).toBe(0);

    const segundaANoite = new Date('2026-09-07T23:30:00-03:00');
    expect(diasUteisEntre(sextaQuaseMeiaNoite, segundaANoite)).toBe(1);
  });

  /**
   * Conta DIAS de calendário, e não blocos de 24h: o que interessa é quantos
   * dias de expediente passaram. Sexta 23h → segunda 01h é um dia útil
   * (a segunda), ainda que sejam só 26 horas de relógio.
   */
  it('conta o dia de expediente, não a volta do relógio', () => {
    const sextaTarde = new Date('2026-09-04T23:00:00-03:00');
    const segundaCedo = new Date('2026-09-07T01:00:00-03:00');
    expect(diasUteisEntre(sextaTarde, segundaCedo)).toBe(1);
  });
});
