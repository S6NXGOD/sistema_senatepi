import { daPessoa, NAO_E_RESERVA, ORIGEM_RESERVA } from '../agenda/equipe.util';
import { abertasDeAlguem, contarAbertasPorPessoa, type AbertaComEquipe } from './abertas-da-pessoa.util';

/**
 * EM ABERTO E ATRASADAS POR PESSOA — a régua `daPessoa`, para a equipe inteira.
 *
 * A soma em memória repete a regra do `where`. Se as duas se separarem, a mesma
 * pessoa volta a ter um número no painel e outro nos Relatórios (13/09/2026).
 */
describe('abertas da pessoa — a soma', () => {
  const hojeIni = new Date('2026-09-13T03:00:00.000Z'); // 0h de 13/09 em Teresina
  const ontem = new Date('2026-09-12T20:00:00.000Z');
  const hoje = new Date('2026-09-13T13:00:00.000Z');
  const aberta = (over: Partial<AbertaComEquipe>): AbertaComEquipe => ({
    responsavelId: null, inicio: hoje, equipe: [], ...over,
  });

  it('conta o responsável e quem foi posto por gente; a reserva do robô não', () => {
    const mapa = contarAbertasPorPessoa(
      [
        aberta({ responsavelId: 'ana' }),
        aberta({ responsavelId: 'bia', equipe: [{ usuarioId: 'ana', origem: 'MANUAL' }] }),
        aberta({ responsavelId: 'bia', equipe: [{ usuarioId: 'ana', origem: null }] }),
        aberta({ responsavelId: 'bia', equipe: [{ usuarioId: 'ana', origem: ORIGEM_RESERVA }] }),
      ],
      hojeIni,
    );
    expect(mapa.get('ana')).toEqual({ abertas: 3, atrasadas: 0 });
    expect(mapa.get('bia')).toEqual({ abertas: 3, atrasadas: 0 });
  });

  it('a mesma atividade conta uma vez, mesmo com a pessoa responsável e na equipe', () => {
    const mapa = contarAbertasPorPessoa(
      [aberta({ responsavelId: 'ana', equipe: [{ usuarioId: 'ana', origem: null }] })],
      hojeIni,
    );
    expect(mapa.get('ana')).toEqual({ abertas: 1, atrasadas: 0 });
  });

  /** Atrasada é o DIA que virou: 17h de ontem, sim; 10h de hoje, já passada a hora, não. */
  it('atrasada pelo início do dia em Teresina, e não pela hora', () => {
    const mapa = contarAbertasPorPessoa(
      [
        aberta({ responsavelId: 'ana', inicio: ontem }),
        aberta({ responsavelId: 'ana', inicio: hoje }),
        aberta({ responsavelId: 'bia', inicio: ontem, equipe: [{ usuarioId: 'ana', origem: 'MANUAL' }] }),
        aberta({ responsavelId: 'bia', inicio: ontem, equipe: [{ usuarioId: 'ana', origem: ORIGEM_RESERVA }] }),
      ],
      hojeIni,
    );
    expect(mapa.get('ana')).toEqual({ abertas: 3, atrasadas: 2 });
    expect(mapa.get('bia')).toEqual({ abertas: 2, atrasadas: 2 });
  });

  it('sem responsável nem equipe, não é de ninguém', () => {
    expect(contarAbertasPorPessoa([aberta({})], hojeIni).size).toBe(0);
  });
});

describe('abertas da pessoa — o where', () => {
  /**
   * O `where` da equipe é o de `daPessoa`, com a lista no lugar de um id. A
   * reserva vem de `NAO_E_RESERVA`, que já cobre a origem NULA — `{ not: X }`
   * sozinho não traz a linha nula no SQL.
   */
  it('é a régua daPessoa para uma lista de pessoas', () => {
    const w = abertasDeAlguem(['ana', 'bia']);
    expect(w.status).toEqual({ in: ['PENDENTE', 'EM_ANDAMENTO'] });
    expect(w.OR).toEqual([
      { responsavelId: { in: ['ana', 'bia'] } },
      { equipe: { some: { usuarioId: { in: ['ana', 'bia'] }, ...NAO_E_RESERVA } } },
    ]);
    const umaPessoa = daPessoa('ana').OR as unknown[];
    expect(umaPessoa).toEqual([
      { responsavelId: 'ana' },
      { equipe: { some: { usuarioId: 'ana', ...NAO_E_RESERVA } } },
    ]);
  });
});
