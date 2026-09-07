import { CNJ_JANELA_MS, CNJ_REQ_POR_MINUTO, CotaPorMinuto } from './cota-cnj.util';

/**
 * O TETO DA COTA PRECISA VALER SOB CONCORRÊNCIA — é só aí que ele falha.
 *
 * O DataJud não tinha limitador: quem espaçava as chamadas era um `setTimeout`
 * de 2–3 s dentro do laço do cron. Isso dá 20–30 req/min contra um teto de 20,
 * ignora a SEGUNDA requisição de um processo em duas instâncias e não enxerga o
 * botão da ficha nem o backfill gastando a mesma cota. Medido na produção:
 * pico de 19 chamadas num minuto e **6 respostas HTTP 429 em 04/09/2026**.
 *
 * Estes testes usam relógio falso: esperar 60 s de verdade numa suíte que roda
 * em 20 s não é teste, é castigo.
 */
describe('cota do CNJ por minuto', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('deixa passar até o limite e segura a seguinte', async () => {
    const cota = new CotaPorMinuto(2);
    const executadas: number[] = [];
    const chamar = (n: number) => cota.executar(async () => void executadas.push(n));

    const todas = Promise.all([chamar(1), chamar(2), chamar(3)]);

    // Sem avançar o relógio, só as duas primeiras cabem na janela.
    await jest.advanceTimersByTimeAsync(0);
    expect(executadas).toEqual([1, 2]);

    // A janela vira e a terceira entra — não antes.
    await jest.advanceTimersByTimeAsync(CNJ_JANELA_MS + 2_000);
    expect(executadas).toEqual([1, 2, 3]);
    await todas;
  });

  /**
   * A FILA É A METADE QUE COSTUMA FALTAR. Um contador sem serialização erra
   * exatamente sob concorrência: duas chamadas leem o saldo no mesmo instante,
   * as duas se acham autorizadas, e as duas passam.
   */
  it('serializa: uma chamada não começa antes da anterior terminar', async () => {
    const cota = new CotaPorMinuto(10);
    let emVoo = 0;
    let maximoSimultaneo = 0;

    const lenta = () =>
      cota.executar(async () => {
        emVoo++;
        maximoSimultaneo = Math.max(maximoSimultaneo, emVoo);
        await new Promise((r) => setTimeout(r, 500));
        emVoo--;
      });

    const todas = Promise.all([lenta(), lenta(), lenta()]);
    await jest.advanceTimersByTimeAsync(3_000);
    await todas;

    expect(maximoSimultaneo).toBe(1);
  });

  /** Uma falha não pode travar a fila para sempre — e o erro tem de subir. */
  it('a falha de uma chamada não mata a fila', async () => {
    const cota = new CotaPorMinuto(5);
    const quebrada = cota.executar(async () => {
      throw new Error('CNJ fora do ar');
    });

    await expect(quebrada).rejects.toThrow('CNJ fora do ar');

    const depois = cota.executar(async () => 'passou');
    await jest.advanceTimersByTimeAsync(0);
    await expect(depois).resolves.toBe('passou');
  });

  /** O saldo se recompõe sozinho: o que saiu da janela deixa de contar. */
  it('a janela desliza — o que envelheceu libera vaga', async () => {
    const cota = new CotaPorMinuto(3);
    await Promise.all([
      cota.executar(async () => undefined),
      cota.executar(async () => undefined),
      cota.executar(async () => undefined),
    ]);
    expect(cota.gastasNaJanela).toBe(3);

    await jest.advanceTimersByTimeAsync(CNJ_JANELA_MS + 1);
    expect(cota.gastasNaJanela).toBe(0);
  });

  /**
   * O teto fica ABAIXO das 20 req/min que o CNJ publica, e de propósito: o
   * saldo é por IP, e DataJud, DJEN, o botão da ficha e uma eventual segunda
   * réplica dividem o mesmo. Se alguém subir este número achando que ganha
   * velocidade, ganha 403.
   */
  it('o teto padrão tem folga contra o limite real do CNJ', () => {
    expect(CNJ_REQ_POR_MINUTO).toBeLessThan(20);
  });
});
