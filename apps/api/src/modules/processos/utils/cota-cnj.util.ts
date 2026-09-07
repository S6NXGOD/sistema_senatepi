/**
 * A COTA DO CNJ É POR IP E POR MINUTO — e o DataJud não a respeitava.
 *
 * O DJEN sempre teve limitador próprio (fila serial + janela deslizante). O
 * DataJud não tinha nada: quem espaçava as chamadas era o `setTimeout` de
 * 2–3 s dentro do laço do cron. Isso é frágil por três motivos, e os três foram
 * medidos na produção em 07/09/2026:
 *
 * 1. 2–3 s entre chamadas dá **20 a 30 requisições por minuto** por construção,
 *    contra um teto de 20. O pico registrado foi de **19 chamadas num minuto**
 *    — a um passo do limite, e isso contando LINHAS DE LOG.
 *
 * 2. Cada processo pode custar DUAS requisições, não uma: quando o caso subiu
 *    de instância, `buscarInstanciasPorNPU` consulta também o tribunal
 *    superior. O log grava uma linha por processo, então o consumo real é
 *    maior do que o log mostra — o pico verdadeiro passa de 20.
 *
 * 3. O laço do cron não é o único consumidor: o botão da ficha, o backfill de
 *    instâncias e uma eventual segunda réplica da API gastam a mesma cota sem
 *    saber uns dos outros. Um `sleep` dentro de UM laço não governa isso.
 *
 * O resultado apareceu no log: **6 respostas HTTP 429 em 04/09** e 4 em 04/08.
 * Não era instabilidade do CNJ — era a varredura passando do teto.
 *
 * Aqui fica só o mecanismo genérico. O `DjenService` mantém o dele por cima
 * disto porque faz duas coisas a mais que não são de todo mundo: lê o saldo que
 * o próprio CNJ devolve em `X-RateLimit-Remaining` e abre um disjuntor quando o
 * CDN recusa por ORIGEM (403 sem cabeçalho de cota, que insistir não resolve).
 * O que NÃO pode divergir é o número — por isso ele vive aqui e os dois
 * serviços o importam.
 */

/**
 * Teto local, deliberadamente ABAIXO das 20 req/min que o CNJ publica.
 *
 * A folga não é timidez: o saldo é por IP e há mais de um consumidor. Foi o
 * valor que o DJEN já usava — este arquivo o herdou para que as duas
 * integrações parem de ter cada uma o seu.
 */
export const CNJ_REQ_POR_MINUTO = 14;

/** A janela que o CNJ repõe (verificado: o saldo volta em ~60 s). */
export const CNJ_JANELA_MS = 60_000;

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Janela deslizante + fila de um.
 *
 * A FILA É A METADE QUE COSTUMA FALTAR. Sem ela, duas chamadas simultâneas
 * consultam o contador no mesmo instante, as duas acham que há saldo, e as duas
 * passam. Contador sem serialização é um contador que erra exatamente quando
 * importa — sob concorrência.
 */
export class CotaPorMinuto {
  /** Instantes das requisições que ainda estão dentro da janela. */
  private readonly historico: number[] = [];
  private fila: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly limite: number = CNJ_REQ_POR_MINUTO,
    /** Chamado quando a cota obriga a esperar — para o serviço logar do seu jeito. */
    private readonly aoEsperar?: (ms: number) => void,
  ) {}

  /** Quantas requisições já foram gastas na janela corrente. */
  get gastasNaJanela(): number {
    this.expirar(Date.now());
    return this.historico.length;
  }

  /**
   * Executa `fn` respeitando a cota, em série com todas as outras.
   *
   * O `catch` no encadeamento existe só para a fila não morrer com a primeira
   * falha; o erro segue íntegro para quem chamou.
   */
  executar<T>(fn: () => Promise<T>): Promise<T> {
    const proxima = this.fila.then(async () => {
      await this.aguardarVaga();
      this.historico.push(Date.now());
      return fn();
    });
    this.fila = proxima.catch(() => undefined);
    return proxima;
  }

  private expirar(agora: number): void {
    while (this.historico.length && agora - this.historico[0] >= CNJ_JANELA_MS) {
      this.historico.shift();
    }
  }

  private async aguardarVaga(): Promise<void> {
    this.expirar(Date.now());
    if (this.historico.length < this.limite) return;

    // Quanto falta para a mais antiga sair da janela, com 1 s de folga: sem a
    // folga, o relógio do CNJ e o nosso discordam por milissegundos justamente
    // na requisição que reabre a janela.
    const espera = Math.max(1_000, CNJ_JANELA_MS - (Date.now() - this.historico[0]) + 1_000);
    this.aoEsperar?.(espera);
    await dormir(espera);
    return this.aguardarVaga();
  }
}
