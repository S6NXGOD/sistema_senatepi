jest.mock('./api', () => ({ api: {}, TIMEOUT_LONGO: 120_000 }));

import { avisoDaBuscaNoDjen } from './djen';

/**
 * A FRASE DO "BUSCAR NO DJEN" NA FICHA (15/09/2026).
 *
 * A ficha dizia "Nenhuma publicação nova no DJEN." mesmo quando o histórico
 * parava pela cota no meio. Os valores são respostas reais da rota
 * `POST /djen/processo/:id/sincronizar`.
 */
describe('avisoDaBuscaNoDjen', () => {
  it('parou pela cota, sem nada novo: aviso de leitura parcial, nunca "nenhuma nova"', () => {
    expect(avisoDaBuscaNoDjen({ ingeridas: 0, recebidas: 100, historico: true, bateuNoTeto: false, interrompida: true })).toEqual({
      tom: 'AVISO',
      texto: 'Leitura parcial: o limite de consultas do CNJ foi atingido. Tente de novo em 1 minuto.',
    });
  });

  it('parou pela cota depois de trazer 3: diz as 3 e o aviso', () => {
    expect(avisoDaBuscaNoDjen({ ingeridas: 3, recebidas: 100, historico: false, bateuNoTeto: false, interrompida: true })).toEqual({
      tom: 'AVISO',
      texto: '3 publicações novas. Leitura parcial: o limite de consultas do CNJ foi atingido. Tente de novo em 1 minuto.',
    });
  });

  it('bateu no teto de páginas: as mais antigas podem faltar', () => {
    const r = avisoDaBuscaNoDjen({ ingeridas: 1, recebidas: 1000, historico: true, bateuNoTeto: true, interrompida: false });
    expect(r.tom).toBe('AVISO');
    expect(r.texto).toBe(
      '1 publicação nova. Leitura parcial: este processo tem mais publicações do que cabe numa leitura. As mais antigas podem não ter vindo.',
    );
  });

  it('a cota vence o teto: o que a pessoa pode fazer é tentar de novo', () => {
    expect(avisoDaBuscaNoDjen({ ingeridas: 0, recebidas: 1000, bateuNoTeto: true, interrompida: true }).texto).toMatch(/Tente de novo em 1 minuto\.$/);
  });

  it('histórico lido inteiro: diz quantas vieram e quantas eram novas', () => {
    expect(avisoDaBuscaNoDjen({ ingeridas: 5, recebidas: 37, historico: true, bateuNoTeto: false, interrompida: false })).toEqual({
      tom: 'SUCESSO',
      texto: 'Histórico do Diário lido: 37 publicações, 5 novas.',
    });
    expect(avisoDaBuscaNoDjen({ ingeridas: 0, recebidas: 1, historico: true }).texto).toBe(
      'Histórico do Diário lido: 1 publicação, nenhuma nova.',
    );
    expect(avisoDaBuscaNoDjen({ ingeridas: 0, recebidas: 0, historico: true }).texto).toBe(
      'Histórico do Diário lido: nenhuma publicação para este processo.',
    );
  });

  it('janela de todo dia, sem nada novo: a frase de antes', () => {
    expect(avisoDaBuscaNoDjen({ ingeridas: 0, recebidas: 2, historico: false, bateuNoTeto: false, interrompida: false })).toEqual({
      tom: 'SUCESSO',
      texto: 'Nenhuma publicação nova no DJEN.',
    });
  });

  /** Janela de troca: a API antiga manda só as duas contagens. */
  it('resposta da API antiga: sucesso com a contagem, singular e plural', () => {
    expect(avisoDaBuscaNoDjen({ ingeridas: 1, recebidas: 4 })).toEqual({ tom: 'SUCESSO', texto: '1 publicação nova.' });
    expect(avisoDaBuscaNoDjen({ ingeridas: 2, recebidas: 4 })).toEqual({ tom: 'SUCESSO', texto: '2 publicações novas.' });
  });
});
