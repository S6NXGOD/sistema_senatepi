import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inicioDoDiaBR } from '../processos/utils/data-br.util';
import { diasDoNomeDoArquivo, periodoDoFiltro } from './periodo.util';

const DIA_MS = 24 * 3_600_000;

/** A conta que os dois relatórios fazem sobre o período — repetida aqui de propósito. */
const janela = (p: { de: Date; ate: Date }) => ({
  inicio: inicioDoDiaBR(p.de).toISOString(),
  fim: new Date(inicioDoDiaBR(p.ate).getTime() + DIA_MS).toISOString(),
});

/**
 * O PERÍODO QUE A TELA PEDE É O QUE O RELATÓRIO CONTA.
 *
 * Medido na produção em 12/09/2026: pedido "de 13/08 até 12/09", a API somava
 * de 12/08 a 11/09 — o dia de hoje ficava de fora de todos os relatórios.
 */
describe('o período dos relatórios', () => {
  it('"de 13/08 até 12/09" vai da meia-noite de 13/08 ao fim de 12/09, em Teresina', () => {
    expect(janela(periodoDoFiltro({ de: '2026-08-13', ate: '2026-09-12' }))).toEqual({
      inicio: '2026-08-13T03:00:00.000Z',
      fim: '2026-09-13T03:00:00.000Z',
    });
  });

  it('um dia só é o dia inteiro', () => {
    expect(janela(periodoDoFiltro({ de: '2026-09-12', ate: '2026-09-12' }))).toEqual({
      inicio: '2026-09-12T03:00:00.000Z',
      fim: '2026-09-13T03:00:00.000Z',
    });
  });

  it('sem datas, são os últimos trinta dias — contando hoje, mesmo às 23h30', () => {
    const agora = new Date('2026-09-12T23:30:00-03:00');
    expect(janela(periodoDoFiltro({}, agora))).toEqual({
      inicio: '2026-08-13T03:00:00.000Z',
      fim: '2026-09-13T03:00:00.000Z',
    });
  });

  it('período invertido se desinverte em silêncio', () => {
    expect(janela(periodoDoFiltro({ de: '2026-09-12', ate: '2026-08-13' }))).toEqual({
      inicio: '2026-08-13T03:00:00.000Z',
      fim: '2026-09-13T03:00:00.000Z',
    });
  });

  it('com hora escrita, o instante é o que o texto diz', () => {
    expect(periodoDoFiltro({ de: '2026-08-13T10:00:00Z', ate: '2026-08-14T10:00:00Z' }).de.toISOString()).toBe(
      '2026-08-13T10:00:00.000Z',
    );
  });

  it('o nome da planilha diz o primeiro e o último dia contados', () => {
    const periodo = periodoDoFiltro({ de: '2026-08-13', ate: '2026-09-12' });
    const { inicio, fim } = janela(periodo);
    expect(diasDoNomeDoArquivo({ de: inicio, ate: fim })).toEqual(['2026-08-13', '2026-09-12']);
  });

  it('todas as rotas dos relatórios passam por estas regras', () => {
    const controller = readFileSync(join(__dirname, 'relatorios.controller.ts'), 'utf8');
    expect(controller).toContain('return periodoDoFiltro(q);');
    expect(controller).not.toMatch(/new Date\(q\.(de|ate)\)/);
    expect(controller).not.toMatch(/periodo\.(de|ate)\.slice\(0, 10\)/);
  });
});
