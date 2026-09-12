import { idadeEmAnosBR, inicioDoMesBR, mesBR, somarDiasUteisEmCalendario } from './data-br.util';

/**
 * OS QUATRO QUE SOBRARAM DA VARREDURA DE FUSO.
 *
 * Depois de corrigir `diasUteisEntre` e o `setHours(9)` do encaminhamento,
 * restavam quatro pontos lendo o relógio do processo. Nenhum grave sozinho;
 * todos errados no ar, porque o contêiner roda em UTC e esta máquina em UTC-3.
 *
 * A suíte da API roda com `TZ=UTC` fixado no `jest.config` — é o fuso da
 * produção. Estes casos usam 22h e 23h de Brasília de propósito: é a faixa em
 * que o servidor já virou o dia e a tela ainda não.
 */
describe('o mês começa à meia-noite daqui', () => {
  /** 22h do dia 31 em Brasília já é dia 1º em UTC. */
  it('a virada do mês não acontece às 21h', () => {
    const ultimaNoiteDeAgosto = new Date('2026-08-31T22:00:00-03:00');
    expect(mesBR(ultimaNoiteDeAgosto)).toBe('2026-08');

    const primeiroDeSetembro = new Date('2026-09-01T00:30:00-03:00');
    expect(mesBR(primeiroDeSetembro)).toBe('2026-09');
  });

  /**
   * O "novos no mês" do painel começava a contar às 21h do último dia do mês
   * anterior — e levava junto quem se filiou na virada.
   */
  it('o primeiro dia do mês é meia-noite de Brasília, não 21h', () => {
    const inicio = inicioDoMesBR(new Date('2026-09-15T12:00:00-03:00'));
    expect(inicio.toISOString()).toBe('2026-09-01T03:00:00.000Z'); // 00:00 daqui
    expect(mesBR(inicio)).toBe('2026-09');
  });

  /** O gráfico pede seis meses: o atual mais cinco atrás. */
  it('conta meses para trás sem estourar o ano', () => {
    const base = new Date('2026-02-10T12:00:00-03:00');
    expect(mesBR(inicioDoMesBR(base, 5))).toBe('2025-09');
    expect(mesBR(inicioDoMesBR(base, 0))).toBe('2026-02');
  });

  /** Uma data às 23h de Brasília do dia 30 pertence ao mês do dia 30. */
  it('o último instante do mês ainda é do mês', () => {
    expect(mesBR(new Date('2026-06-30T23:59:00-03:00'))).toBe('2026-06');
  });
});

/**
 * IDADE — o caso do aniversário de amanhã.
 *
 * `referencia.getDate()` em UTC, às 22h de Brasília, já é o dia seguinte: quem
 * completa anos amanhã aparecia um ano mais velho hoje à noite. O cartão de
 * aniversariantes da home é exatamente onde isso apareceria.
 */
describe('idade em anos completos', () => {
  const nascimento = new Date('1990-09-08T00:00:00-03:00');

  it('na véspera à noite ainda não fez aniversário', () => {
    const vesperaTarde = new Date('2026-09-07T22:00:00-03:00');
    expect(idadeEmAnosBR(nascimento, vesperaTarde)).toBe(35);
  });

  it('no dia, desde a primeira hora, já fez', () => {
    expect(idadeEmAnosBR(nascimento, new Date('2026-09-08T00:10:00-03:00'))).toBe(36);
    expect(idadeEmAnosBR(nascimento, new Date('2026-09-08T23:50:00-03:00'))).toBe(36);
  });

  it('no dia seguinte continua a mesma', () => {
    expect(idadeEmAnosBR(nascimento, new Date('2026-09-09T09:00:00-03:00'))).toBe(36);
  });

  /** Nascido em 29/02: sem ano bissexto o aniversário cai em 01/03. */
  it('29 de fevereiro não vira idade negativa nem pula um ano', () => {
    const bissexto = new Date('2000-02-29T00:00:00-03:00');
    expect(idadeEmAnosBR(bissexto, new Date('2026-02-28T22:00:00-03:00'))).toBe(25);
    expect(idadeEmAnosBR(bissexto, new Date('2026-03-01T09:00:00-03:00'))).toBe(26);
  });
});

/**
 * DIAS ÚTEIS PARA TRÁS — o sinal que passava batido.
 *
 * O laço era `while (restantes > 0)`: com número negativo ele não rodava e a
 * função devolvia o dia base, sem erro e sem aviso. Quem pedia "dois dias úteis
 * ANTES" recebia o próprio dia.
 *
 * Isso queimou a tarefa "Preparar audiência", criada em 12/09/2026 justamente
 * para dar antecedência a quem vai atuar: ela nascia no dia da pauta — ou não
 * nascia, quando a audiência era de manhã e a guarda de "nunca no passado" a
 * descartava. Era a única antecedência que a maioria das pautas teria.
 */
describe('somarDiasUteisEmCalendario anda nos dois sentidos', () => {
  const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
  const so = (d: Date) => d.toISOString().slice(0, 10);

  it('para frente, pulando o fim de semana', () => {
    // Sexta 11/09/2026 + 1 útil = segunda 14.
    expect(so(somarDiasUteisEmCalendario(dia('2026-09-11'), 1))).toBe('2026-09-14');
    expect(so(somarDiasUteisEmCalendario(dia('2026-09-11'), 3))).toBe('2026-09-16');
  });

  it('para TRÁS, pulando o fim de semana', () => {
    // Quarta 16/09/2026 − 2 úteis = segunda 14.
    expect(so(somarDiasUteisEmCalendario(dia('2026-09-16'), -2))).toBe('2026-09-14');
    // Segunda 14 − 2 úteis atravessa o fim de semana e cai na quinta 10.
    expect(so(somarDiasUteisEmCalendario(dia('2026-09-14'), -2))).toBe('2026-09-10');
    // Terça 15 − 1 útil = segunda 14.
    expect(so(somarDiasUteisEmCalendario(dia('2026-09-15'), -1))).toBe('2026-09-14');
  });

  it('nunca cai em sábado ou domingo, para nenhum dos lados', () => {
    for (let base = 1; base <= 28; base++) {
      for (const n of [-3, -2, -1, 1, 2, 3]) {
        const d = somarDiasUteisEmCalendario(dia(`2026-09-${String(base).padStart(2, '0')}`), n);
        expect([0, 6]).not.toContain(d.getUTCDay());
      }
    }
  });

  it('zero não anda', () => {
    expect(so(somarDiasUteisEmCalendario(dia('2026-09-13'), 0))).toBe('2026-09-13');
  });
});
