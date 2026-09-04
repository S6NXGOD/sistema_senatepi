import { ehNoticiaVelha } from '../correlacao.service';
import { diaBR } from './data-br.util';

/**
 * NOTÍCIA VELHA NÃO VIRA TAREFA.
 *
 * A regra é importada do serviço, não copiada: duas versões de uma mesma regra
 * é o defeito que este módulo já pagou caro — elas divergem em silêncio e o
 * teste segue verde sobre a versão errada.
 *
 * O caso que este arquivo existe para travar só apareceu na simulação contra a
 * produção: a publicação do próprio dia-limite. `dataDisponibilizacao` é coluna
 * DATE (meia-noite UTC) e o limite era calculado como meia-noite de TERESINA
 * (03:00 UTC) — três horas que jogavam essa publicação para o lado do arquivo.
 */

/** Coluna DATE do Postgres: meia-noite UTC, sem hora. */
const publicadaEm = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
/** Instante real — a hora em que a publicação foi BAIXADA. */
const baixadaEm = (iso: string) => new Date(iso);

describe('notícia velha', () => {
  /**
   * O caso da produção: integração ligada em 03/09/2026 às 23h de Teresina,
   * trazendo o histórico inteiro de processos cadastrados em 24 e 31/08.
   */
  const primeiraIngestao = baixadaEm('2026-09-04T02:15:00.000Z'); // 23:15 em Teresina, 03/09

  it.each([
    ['2026-08-11', 'acórdão de três semanas antes'],
    ['2026-08-18', 'anterior ao próprio cadastro do processo'],
    ['2026-08-23', 'anterior ao acompanhamento'],
    ['2026-08-27', 'anterior ao acompanhamento'],
  ])('%s é eco (%s)', (data) => {
    expect(ehNoticiaVelha(publicadaEm(data), primeiraIngestao)).toBe(true);
  });

  it('a publicação do dia da ingestão vira tarefa', () => {
    expect(ehNoticiaVelha(publicadaEm('2026-09-03'), primeiraIngestao)).toBe(false);
  });

  /** O dia-limite é INCLUSIVO — é o caso que a comparação errada derrubava. */
  it('a publicação do dia-limite ainda vira tarefa', () => {
    expect(ehNoticiaVelha(publicadaEm('2026-08-31'), primeiraIngestao)).toBe(false);
    expect(ehNoticiaVelha(publicadaEm('2026-08-30'), primeiraIngestao)).toBe(true);
  });

  /**
   * REGIME NORMAL: o processo já era acompanhado há semanas. Tudo que chega
   * passa — a régua só morde na primeira ingestão.
   */
  it('com o processo já acompanhado, nada é arquivado', () => {
    const acompanhadoDesde = baixadaEm('2026-07-01T08:00:00.000Z');
    for (const data of ['2026-07-02', '2026-08-11', '2026-09-03']) {
      expect(ehNoticiaVelha(publicadaEm(data), acompanhadoDesde)).toBe(false);
    }
  });

  /**
   * A varredura ficou dias fora do ar e voltou: as publicações do período são
   * posteriores ao início do acompanhamento e continuam virando tarefa. Sem
   * isso, uma queda do robô viraria silêncio permanente.
   */
  it('retomada após queda do robô não arquiva o que ficou para trás', () => {
    const acompanhadoDesde = baixadaEm('2026-08-01T08:00:00.000Z');
    expect(ehNoticiaVelha(publicadaEm('2026-08-25'), acompanhadoDesde)).toBe(false);
  });

  /** Perto da meia-noite de Teresina o dia UTC já virou — não pode escorregar. */
  it('não escorrega de dia na virada', () => {
    const ingestao2350 = baixadaEm('2026-09-04T02:50:00.000Z'); // 23:50 em Teresina, 03/09
    expect(diaBR(ingestao2350)).toBe('2026-09-03');
    expect(ehNoticiaVelha(publicadaEm('2026-08-31'), ingestao2350)).toBe(false);
  });
});
