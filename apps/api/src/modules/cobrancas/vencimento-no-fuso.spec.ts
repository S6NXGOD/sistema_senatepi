import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { diaDeCalendarioBR, inicioDoDiaBR } from '../processos/utils/data-br.util';

/**
 * O ROBÔ DE VENCIMENTOS MARCAVA A PARCELA COMO VENCIDA ÀS 21:00 DO DIA DELA.
 *
 * Medido na produção em 07/09/2026: das 3 parcelas com status VENCIDO, as 3
 * foram carimbadas às 21:00 do PRÓPRIO dia do vencimento (05/09, 05/09, 20/08).
 * Não é amostra — é a população inteira.
 *
 * Duas causas somadas, e nenhuma das duas sozinha explicava:
 *  1. `@Cron(EVERY_DAY_AT_MIDNIGHT)` sem fuso = meia-noite do PROCESSO, e o
 *     contêiner roda em UTC → disparo às 21:00 de Teresina, do dia anterior;
 *  2. `hojeUTC()` virava o dia no mesmo instante, então a consulta concordava
 *     com o disparo errado e nada parecia fora do lugar.
 *
 * Este arquivo trava as duas.
 */
const CRON = readFileSync(join(__dirname, 'cobrancas-cron.service.ts'), 'utf8');
const SERVICO = readFileSync(join(__dirname, 'cobrancas.service.ts'), 'utf8');

/** Uma parcela que vence hoje, como o Postgres guarda uma coluna `date`. */
const venceEm = (dia: string) => new Date(`${dia}T00:00:00.000Z`);

describe('o dia do vencimento em Teresina', () => {
  /**
   * 00:00 UTC do dia 6 é 21:00 do dia 5 em Teresina. Quem vence dia 5 AINDA
   * TEM TRÊS HORAS — e é exatamente aqui que o robô disparava.
   */
  it('às 21:00 de Teresina, a parcela de hoje ainda não venceu', () => {
    const instante = new Date('2026-09-06T00:00:00.000Z');
    const hoje = diaDeCalendarioBR(instante);

    expect(venceEm('2026-09-05') < hoje).toBe(false); // vence hoje: fica PENDENTE
    expect(venceEm('2026-09-04') < hoje).toBe(true); // venceu ontem: VENCIDO
  });

  /** E à meia-noite de Teresina (03:00 UTC) ela vence, sem atraso nenhum. */
  it('à meia-noite de Teresina, a de ontem vence', () => {
    const instante = new Date('2026-09-06T03:00:00.000Z');
    const hoje = diaDeCalendarioBR(instante);

    expect(venceEm('2026-09-05') < hoje).toBe(true);
    expect(venceEm('2026-09-06') < hoje).toBe(false);
  });

  /**
   * A ARMADILHA QUE FICA PARA O PRÓXIMO: as duas funções têm nomes parecidos e
   * respostas diferentes. Contra coluna `date`, `inicioDoDiaBR` erra por três
   * horas — porque devolve 03:00, e 00:00 < 03:00.
   */
  it('inicioDoDiaBR não serve para coluna date, e é por isso que são duas', () => {
    const instante = new Date('2026-09-06T12:00:00.000Z');

    expect(venceEm('2026-09-06') < inicioDoDiaBR(instante)).toBe(true); // erra
    expect(venceEm('2026-09-06') < diaDeCalendarioBR(instante)).toBe(false); // acerta
  });

  /** Virada de mês: o painel mostrava outubro nas últimas 3h de setembro. */
  it('o mês do painel também é o brasileiro', () => {
    const ultimasHorasDeSetembro = new Date('2026-10-01T00:00:00.000Z');
    expect(diaDeCalendarioBR(ultimasHorasDeSetembro).getUTCMonth()).toBe(8); // setembro
  });
});

describe('o agendamento do robô de vencimentos', () => {
  it('dispara na meia-noite de Teresina, não na do servidor', () => {
    expect(CRON).toContain("timeZone: 'America/Fortaleza'");
  });

  /**
   * Fuso no cron sem fuso na consulta continuaria errado — as duas juntas.
   *
   * As asserções negativas olham o CÓDIGO, não o texto: a primeira versão delas
   * batia no comentário que explica o bug e reprovava o arquivo corrigido.
   */
  it('e a consulta usa o dia brasileiro', () => {
    expect(SERVICO).toContain('diaDeCalendarioBR');
    expect(SERVICO).not.toContain('private hojeUTC');
    expect(SERVICO).not.toContain('const m = now.getUTCMonth();');
  });

  /**
   * `addMonthsISO` e `paraData` continuam fazendo aritmética sobre a string, sem
   * ler relógio nenhum — é por isso que só o robô e o painel estavam errados.
   */
  it('o cálculo das parcelas não lê o relógio do servidor', () => {
    const helpers = SERVICO.slice(
      SERVICO.indexOf('private addMonthsISO'),
      SERVICO.indexOf('private dividirValor'),
    );
    expect(helpers).not.toContain('new Date()');
  });
});
