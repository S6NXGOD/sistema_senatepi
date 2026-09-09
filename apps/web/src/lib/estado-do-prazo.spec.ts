import { estadoDoPrazo, estaAtrasado, pedeAtencao } from './agenda';

/**
 * O SISTEMA SE CONTRADIZIA NA PALAVRA MAIS GRAVE QUE TEM.
 *
 * Sino: "atrasada" = aberta de dia anterior  → 0 em 08/09/2026
 * Painel/agenda: "atrasada" = hora passada   → 8 em 08/09/2026
 *
 * Mesma pessoa, mesmo instante, sino calado e painel vermelho.
 */
const emDias = (d: number, hora: number) => {
  // Meia-noite de Teresina do dia de hoje, deslocada em `d` dias e `hora` horas.
  const agora = Date.now();
  const meiaNoiteBR = new Date(new Date(agora - 3 * 3_600_000).toISOString().slice(0, 10) + 'T03:00:00.000Z');
  return new Date(meiaNoiteBR.getTime() + d * 86_400_000 + hora * 3_600_000).toISOString();
};

describe('em que pé está o prazo', () => {
  it('aberta de dia anterior é ATRASADA — o alarme', () => {
    expect(estadoDoPrazo({ inicio: emDias(-1, 9), status: 'PENDENTE' })).toBe('ATRASADA');
    expect(estadoDoPrazo({ inicio: emDias(-30, 15), status: 'EM_ANDAMENTO' })).toBe('ATRASADA');
  });

  /**
   * O CASO QUE MOTIVOU A SEPARAÇÃO: o robô agenda "Cadastrar ação do Diário"
   * para as 15:00 do PRÓPRIO dia. Às 15:01 isso virava vermelho — 7 das 8
   * "atrasadas" medidas na produção eram exatamente essas.
   */
  it('de hoje com a hora passada é PASSOU_DA_HORA, não atraso', () => {
    const estado = estadoDoPrazo({ inicio: emDias(0, 0), status: 'PENDENTE' });
    expect(estado).toBe('PASSOU_DA_HORA');
    expect(estaAtrasado({ inicio: emDias(0, 0), status: 'PENDENTE' })).toBe(false);
    expect(pedeAtencao({ inicio: emDias(0, 0), status: 'PENDENTE' })).toBe(true);
  });

  it('de hoje ainda por vir, e dos próximos dias, é EM_DIA', () => {
    expect(estadoDoPrazo({ inicio: emDias(1, 9), status: 'PENDENTE' })).toBe('EM_DIA');
    expect(estadoDoPrazo({ inicio: emDias(7, 9), status: 'PENDENTE' })).toBe('EM_DIA');
  });

  /** Fechada nunca atrasa — o que acabou, acabou. */
  it('concluída e cancelada nunca pedem atenção', () => {
    expect(estadoDoPrazo({ inicio: emDias(-10, 9), status: 'CONCLUIDO' })).toBe('EM_DIA');
    expect(estadoDoPrazo({ inicio: emDias(-10, 9), status: 'CANCELADO' })).toBe('EM_DIA');
    expect(pedeAtencao({ inicio: emDias(-10, 9), status: 'CONCLUIDO' })).toBe(false);
  });

  /** `pedeAtencao` cobre os dois — é o que a fila do painel nunca pode esconder. */
  it('pedeAtencao junta os dois estados que precisam de gente', () => {
    expect(pedeAtencao({ inicio: emDias(-1, 9), status: 'PENDENTE' })).toBe(true);
    expect(pedeAtencao({ inicio: emDias(0, 0), status: 'PENDENTE' })).toBe(true);
    expect(pedeAtencao({ inicio: emDias(1, 9), status: 'PENDENTE' })).toBe(false);
  });
});
