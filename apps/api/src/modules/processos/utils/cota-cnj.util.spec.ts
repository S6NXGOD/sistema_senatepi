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

/**
 * QUEM ESTÁ NA TELA PASSA NA FRENTE — a faixa que faltava.
 *
 * A fila era FIFO pura, e isso apareceu como "o sistema travou": o backfill de
 * instâncias dispara ao abrir a lista de Processos e enfileira até 20
 * requisições; a consulta do formulário de cadastro entrava atrás delas. Medido
 * na produção em 11/09/2026: 36s, 38s e 45s para uma consulta com gente parada
 * olhando, enquanto o robô era atendido primeiro.
 */
describe('a cota atende gente antes de robô', () => {
  it('o pedido da tela fura a fila do robô', async () => {
    const cota = new CotaPorMinuto(50);
    const ordem: string[] = [];
    const tarefa = (nome: string) => async () => {
      ordem.push(nome);
      return nome;
    };

    // Um robô já em execução prende a fila; os outros entram enquanto isso.
    const primeiro = cota.executar(tarefa('robo-1'), 'ROBO');
    const roboDois = cota.executar(tarefa('robo-2'), 'ROBO');
    const roboTres = cota.executar(tarefa('robo-3'), 'ROBO');
    const pessoa = cota.executar(tarefa('pessoa'), 'PESSOA');

    await Promise.all([primeiro, roboDois, roboTres, pessoa]);

    expect(ordem[0]).toBe('robo-1'); // já tinha começado: ninguém tira a vez de quem está no ar
    expect(ordem[1]).toBe('pessoa'); // e a partir daí a gente vem primeiro
    expect(ordem).toEqual(['robo-1', 'pessoa', 'robo-2', 'robo-3']);
  });

  it('sem dizer nada, o pedido é tratado como robô', async () => {
    const cota = new CotaPorMinuto(50);
    const ordem: string[] = [];
    const p1 = cota.executar(async () => void ordem.push('a'));
    const p2 = cota.executar(async () => void ordem.push('b'), 'PESSOA');
    await Promise.all([p1, p2]);
    // 'a' começou primeiro; o que importa é que o padrão NÃO é PESSOA.
    expect(ordem).toEqual(['a', 'b']);
  });

  it('o erro de um pedido não derruba a fila nem some para quem chamou', async () => {
    const cota = new CotaPorMinuto(50);
    const quebrado = cota.executar(async () => {
      throw new Error('CNJ fora');
    });
    await expect(quebrado).rejects.toThrow('CNJ fora');
    await expect(cota.executar(async () => 'segue')).resolves.toBe('segue');
  });

  /**
   * 429 é aviso de janela estourada, não erro isolado.
   *
   * A cota é por IP e o IP de saída do Railway é compartilhado: o teto de
   * 14/min é respeitado do nosso lado e mesmo assim vieram CINCO 429 seguidos.
   * Sem recuo, cada chamada seguinte sai só para tomar a mesma recusa.
   */
  it('depois de um 429 a fila espera antes de tentar de novo', async () => {
    const cota = new CotaPorMinuto(50);
    await cota.executar(async () => 'ok');
    cota.penalizar(120);
    const t0 = Date.now();
    await cota.executar(async () => 'depois');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(100);
  });
});
