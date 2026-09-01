import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { cronometroEsquecido, duracaoEntre, HORAS_ATE_CRONOMETRO_ESQUECIDO } from './agenda';

const iso = (s: string) => `2026-08-31T${s}-03:00`;

/**
 * "CONCLUÍDA EM 2H40" — o card passou a dizer quanto a atividade levou.
 *
 * Medido na produção de 31/08/2026, nas 25 atividades concluídas: as durações
 * reais vão de 13 minutos a 2,7 horas — consulta jurídica, ofício, reunião.
 * São números que cabem numa linha e que dizem alguma coisa.
 */
describe('duração entre iniciar e concluir', () => {
  it.each([
    ['13:00:00', '13:00:40', 'menos de 1 min'],
    ['13:00:00', '13:23:00', '23min'],
    ['13:00:00', '13:59:00', '59min'],
    ['13:00:00', '15:00:00', '2h'],
    ['13:00:00', '15:42:00', '2h42'],
    ['13:00:00', '13:45:00', '45min'],
    // O caso mais longo da produção.
    ['09:00:00', '11:42:00', '2h42'],
  ])('%s → %s vira "%s"', (i, f, esperado) => {
    expect(duracaoEntre(iso(i), iso(f))).toBe(esperado);
  });

  /** Minuto que arredonda para 60 viraria "1h60" — o pior tipo de bug de vitrine. */
  it('59min30s vira "2h", não "1h60"', () => {
    expect(duracaoEntre(iso('13:00:00'), iso('14:59:40'))).toBe('2h');
  });

  it('zero-padding no minuto: 2h05, não 2h5', () => {
    expect(duracaoEntre(iso('13:00:00'), iso('15:05:00'))).toBe('2h05');
  });

  it.each([
    ['2026-08-31T09:00:00-03:00', '2026-09-01T09:00:00-03:00', '1 dia'],
    ['2026-08-31T09:00:00-03:00', '2026-09-01T12:00:00-03:00', '1d 3h'],
    ['2026-08-31T09:00:00-03:00', '2026-09-03T09:00:00-03:00', '3 dias'],
  ])('mais de um dia: %s → %s vira "%s"', (i, f, esperado) => {
    expect(duracaoEntre(i, f)).toBe(esperado);
  });

  /**
   * A fronteira dos dois formatos. 23h59m50s ainda cai no ramo de HORAS, e o
   * minuto arredonda para 60 — o que produziria "23h60" sem o ajuste. Sai
   * "24h", que é legível; o que não pode sair é "23h60" nem "0d 24h".
   */
  it('a virada para 24h não produz "23h60" nem "0d 24h"', () => {
    const r = duracaoEntre('2026-08-31T00:00:00-03:00', '2026-08-31T23:59:50-03:00');
    expect(r).toBe('24h');
    expect(r).not.toMatch(/60/);
    expect(r).not.toMatch(/^0d/);
  });

  /** E logo depois da fronteira o formato de dias assume, sem "0d". */
  it('24h01 vira "1 dia"', () => {
    expect(duracaoEntre('2026-08-31T00:00:00-03:00', '2026-09-01T00:01:00-03:00')).toBe('1 dia');
  });
});

/**
 * O QUE ELA SE RECUSA A CALCULAR — e é aqui que a funcionalidade se sustenta.
 *
 * Das 25 concluídas na produção, NOVE nunca foram iniciadas. Para essas, a
 * única duração calculável seria da criação até a conclusão: uma tarefa aberta
 * há três semanas e resolvida em dez minutos apareceria como "concluída em 23
 * dias". Um número errado é pior que nenhum — o primeiro é lido e usado.
 */
describe('quando não há o que medir', () => {
  it.each([
    ['sem início', null, iso('13:00:00')],
    ['sem fim', iso('13:00:00'), null],
    ['sem nada', null, null],
    ['início indefinido', undefined, iso('13:00:00')],
  ])('%s devolve null', (_rotulo, i, f) => {
    expect(duracaoEntre(i, f)).toBeNull();
  });

  /** Dado torto existe. "Concluída em -4h" seria a única coisa memorável da tela. */
  it('fim antes do início devolve null, não duração negativa', () => {
    expect(duracaoEntre(iso('15:00:00'), iso('13:00:00'))).toBeNull();
  });

  it('data ilegível devolve null', () => {
    expect(duracaoEntre('nao e data', iso('13:00:00'))).toBeNull();
  });
});

/**
 * O CRONÔMETRO QUE VIROU A NOITE.
 *
 * As duas atividades em andamento na produção contavam há 12,8h e 12,6h, ambas
 * previstas para durar UMA hora — 11,4h e 12,7h além do término previsto.
 * Ninguém passou meio dia numa consulta de uma hora: alguém esqueceu de clicar
 * em "Concluir", e o cronômetro verde e pulsante seguia dizendo que estava
 * tudo bem.
 */
describe('cronômetro esquecido', () => {
  const agora = new Date('2026-08-31T21:45:00-03:00').getTime();

  /**
   * PASSAR DO PREVISTO É NORMAL, e por isso não serve de alerta: das 25
   * concluídas, 12 passaram até uma hora do horário previsto e 5 passaram de
   * uma a quatro. Acender ali seria acender em quase todas.
   */
  it.each([
    ['terminou agora', '21:45:00'],
    ['1h além do previsto', '20:45:00'],
    ['4h além do previsto', '17:45:00'],
    ['exatamente no limite', '15:45:00'],
  ])('%s continua verde', (_rotulo, fim) => {
    expect(cronometroEsquecido(iso(fim), agora)).toBe(false);
  });

  it.each([
    ['os dois casos reais da produção', '14:20:00'],
    ['reunião prevista para as 13h', '13:00:00'],
    ['virou o dia', '2026-08-30T18:00:00-03:00'],
  ])('%s acende o aviso', (_rotulo, fim) => {
    expect(cronometroEsquecido(fim.includes('T') ? fim : iso(fim), agora)).toBe(true);
  });

  it('sem horário previsto, não acusa nada', () => {
    expect(cronometroEsquecido(null, agora)).toBe(false);
    expect(cronometroEsquecido(undefined, agora)).toBe(false);
  });

  it('a régua é de 6 horas, e está declarada', () => {
    expect(HORAS_ATE_CRONOMETRO_ESQUECIDO).toBe(6);
  });
});

/**
 * O cronômetro existia DUAS VEZES, copiado no card e na gaveta. Duas cópias
 * divergem na primeira correção: ao acrescentar o aviso, o card avisaria e a
 * gaveta continuaria verde e muda sobre a mesma atividade.
 */
describe('um cronômetro só', () => {
  const RAIZ = path.resolve(__dirname, '..');
  const card = readFileSync(path.join(RAIZ, 'components/agenda/compromisso-card.tsx'), 'utf8');
  const gaveta = readFileSync(path.join(RAIZ, 'components/agenda/compromisso-drawer.tsx'), 'utf8');

  it('nenhum dos dois declara o seu próprio', () => {
    expect(card).not.toContain('function Cronometro(');
    expect(gaveta).not.toContain('function Cronometro(');
  });

  it('os dois importam o compartilhado', () => {
    for (const [nome, src] of [['card', card], ['gaveta', gaveta]] as const) {
      expect(`${nome}: ${src.includes("from '@/components/agenda/cronometro'")}`)
        .toBe(`${nome}: true`);
    }
  });

  /** E os dois passam o horário previsto — sem ele o aviso nunca acende. */
  it('os dois passam `fimPrevisto`', () => {
    for (const [nome, src] of [['card', card], ['gaveta', gaveta]] as const) {
      expect(`${nome}: ${/<Cronometro[^>]*fimPrevisto=\{c\.fim\}/.test(src)}`).toBe(`${nome}: true`);
    }
  });

  it('os dois mostram a duração da atividade concluída', () => {
    for (const [nome, src] of [['card', card], ['gaveta', gaveta]] as const) {
      expect(`${nome}: ${src.includes('duracaoEntre(c.iniciadoEm, c.concluidoEm)')}`)
        .toBe(`${nome}: true`);
    }
  });
});
