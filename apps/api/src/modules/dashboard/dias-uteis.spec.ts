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
