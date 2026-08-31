import { desde } from './dossie';

/**
 * "25/08/2026 · há 7 dias" — DE 25 A 31 VÃO SEIS.
 *
 * Visto na listagem de processos em 31/08/2026. A célula imprime a DATA (de
 * calendário) e, ao lado, o rótulo relativo. O rótulo era calculado como
 * `Math.round((agora - data) / 86.400.000)` — tempo decorrido. O andamento
 * estava carimbado às 06h; das 06h do dia 25 às 22h do dia 31 são 6,67 dias,
 * que arredondam para 7.
 *
 * Dois relógios na mesma linha. O erro é de um dia só, e é justamente o tipo
 * que corrói a confiança na tela inteira: quem confere na mão descobre que a
 * conta não fecha e passa a duvidar também dos números que estão certos.
 */
function em(iso: string, agora: string): string {
  jest.useFakeTimers().setSystemTime(new Date(agora));
  try {
    return desde(iso);
  } finally {
    jest.useRealTimers();
  }
}

describe('desde() conta dias de calendário', () => {
  /** O caso exato da tela, com a hora que o produziu. */
  it('25/08 06:00 visto em 31/08 22:00 é "há 6 dias", não 7', () => {
    expect(em('2026-08-25T06:00:00-03:00', '2026-08-31T22:00:00-03:00')).toBe('há 6 dias');
  });

  /** A hora do dia não pode mudar a resposta — só a data importa. */
  it.each(['00:30', '06:00', '12:00', '23:45'])('a hora %s não altera a contagem', (hora) => {
    expect(em(`2026-08-25T${hora}:00-03:00`, '2026-08-31T22:00:00-03:00')).toBe('há 6 dias');
  });

  it('mesmo dia é "hoje", qualquer que seja a hora', () => {
    expect(em('2026-08-31T00:10:00-03:00', '2026-08-31T22:00:00-03:00')).toBe('hoje');
    expect(em('2026-08-31T21:59:00-03:00', '2026-08-31T22:00:00-03:00')).toBe('hoje');
  });

  /**
   * O outro lado do mesmo defeito: um fato de ontem às 23h estava a uma hora de
   * distância, e o cronômetro dizia "hoje". Aconteceu de verdade em qualquer
   * virada de meia-noite.
   */
  it('ontem às 23h é "ontem", mesmo faltando uma hora', () => {
    expect(em('2026-08-30T23:00:00-03:00', '2026-08-31T00:00:30-03:00')).toBe('ontem');
  });

  it('amanhã cedo é "amanhã", mesmo faltando poucas horas', () => {
    expect(em('2026-09-01T09:00:00-03:00', '2026-08-31T22:00:00-03:00')).toBe('amanhã');
  });

  it('futuro em dias', () => {
    expect(em('2026-09-10T09:00:00-03:00', '2026-08-31T22:00:00-03:00')).toBe('em 10 dias');
  });

  it('vira meses depois de 30 dias', () => {
    expect(em('2026-06-30T09:00:00-03:00', '2026-08-31T12:00:00-03:00')).toBe('há 2 meses');
  });

  it('vira anos depois de 12 meses', () => {
    expect(em('2024-08-31T09:00:00-03:00', '2026-08-31T12:00:00-03:00')).toBe('há 2 anos');
  });

  it('sem data devolve travessão', () => {
    expect(desde(null)).toBe('—');
    expect(desde(undefined)).toBe('—');
  });
});
