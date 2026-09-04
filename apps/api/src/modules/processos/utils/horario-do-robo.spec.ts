import {
  noveDaManhaBR,
  proximoHorarioUtilBR,
  ehFimDeSemanaBR,
  OFFSET_BR_MS,
} from './data-br.util';

/**
 * A HORA EM QUE O ROBÔ AGENDA.
 *
 * Dois defeitos medidos na produção em 03/09/2026, e os dois só aparecem com o
 * relógio real:
 *
 * 1. `setHours(9, 0, 0, 0)` resolve no fuso do PROCESSO, que é configuração de
 *    ambiente. Na mesma tabela havia uma tarefa às 09:00 UTC (06:00 de
 *    Teresina) e quatro às 12:00 UTC (09:00 de Teresina).
 * 2. Rodando às 20h, o robô marcava "hoje às 9h" — a tarefa nascia com onze
 *    horas de atraso. QUATRO das cinco atividades do DJEN nasceram assim, e o
 *    alerta "4 atividades com horário vencido" da home era autogerado.
 */

/** Um instante a partir da hora de Teresina, para os testes lerem como gente. */
const brt = (iso: string) => new Date(new Date(`${iso}Z`).getTime() + OFFSET_BR_MS);
const horaBR = (d: Date) =>
  new Date(d.getTime() - OFFSET_BR_MS).toISOString().slice(11, 16);
const diaBR = (d: Date) => new Date(d.getTime() - OFFSET_BR_MS).toISOString().slice(0, 10);

describe('nove da manhã de Teresina', () => {
  it('é 12:00 em UTC, e não depende do fuso da máquina', () => {
    const d = noveDaManhaBR(brt('2026-09-03T20:15:00'));
    expect(d.toISOString()).toBe('2026-09-03T12:00:00.000Z');
    expect(horaBR(d)).toBe('09:00');
  });

  /** O instante das 23h de Teresina já é o dia seguinte em UTC. */
  it('não escorrega de dia perto da meia-noite', () => {
    expect(diaBR(noveDaManhaBR(brt('2026-09-03T23:50:00')))).toBe('2026-09-03');
    expect(diaBR(noveDaManhaBR(brt('2026-09-03T00:10:00')))).toBe('2026-09-03');
  });
});

describe('nenhuma tarefa nasce vencida', () => {
  it('mantém o horário quando ele ainda está por vir', () => {
    const agora = brt('2026-09-03T06:00:00');
    const d = proximoHorarioUtilBR(brt('2026-09-03T09:00:00'), agora);
    expect(diaBR(d)).toBe('2026-09-03');
    expect(horaBR(d)).toBe('09:00');
  });

  /** O caso real: robô rodando às 20h com o alvo às 9h do mesmo dia. */
  it('empurra para o dia seguinte quando o horário já passou', () => {
    const agora = brt('2026-09-03T20:15:00'); // quinta
    const d = proximoHorarioUtilBR(brt('2026-09-03T09:00:00'), agora);
    expect(diaBR(d)).toBe('2026-09-04'); // sexta
    expect(horaBR(d)).toBe('09:00');
    expect(d.getTime()).toBeGreaterThan(agora.getTime());
  });

  it('pula o fim de semana', () => {
    // Sexta 03/09 é o dia útil; 04 e 05/09 de 2026 caem em sábado e domingo?
    // Não se apoia no calendário de cabeça: força um alvo de sábado.
    const sabado = brt('2026-09-05T09:00:00');
    expect(ehFimDeSemanaBR(sabado)).toBe(true);
    const d = proximoHorarioUtilBR(sabado, brt('2026-09-04T20:00:00'));
    expect(ehFimDeSemanaBR(d)).toBe(false);
    expect(horaBR(d)).toBe('09:00');
  });

  /**
   * A garantia que sustenta o nome da função: o resultado é SEMPRE futuro.
   * Sem ela, a tarefa entraria na agenda já na lista de atrasadas.
   */
  it('o resultado nunca fica no passado, em nenhuma hora do dia', () => {
    for (const hora of ['00', '06', '09', '12', '18', '20', '23']) {
      const agora = brt(`2026-09-03T${hora}:30:00`);
      const d = proximoHorarioUtilBR(brt('2026-09-03T09:00:00'), agora);
      expect(d.getTime()).toBeGreaterThan(agora.getTime());
    }
  });

  /** Alvo lá na frente continua lá na frente — a função só empurra, nunca puxa. */
  it('não antecipa um horário futuro', () => {
    const agora = brt('2026-09-03T20:15:00');
    const d = proximoHorarioUtilBR(brt('2026-09-10T09:00:00'), agora);
    expect(diaBR(d)).toBe('2026-09-10');
  });
});
