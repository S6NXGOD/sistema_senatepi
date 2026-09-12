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
/**
 * QUEM ESTÁ ESPERANDO NA TELA PASSA NA FRENTE DO ROBÔ.
 *
 * Esta é a metade que faltava, e a falta apareceu como "o sistema travou".
 *
 * A cota é uma fila SERIAL: 14 requisições por minuto, uma de cada vez. Toda a
 * casa passa por ela — a varredura da madrugada, o backfill de instâncias que
 * dispara ao abrir a lista de processos, o botão "Sincronizar" e a consulta que
 * o cadastro faz enquanto alguém olha para o formulário.
 *
 * Sendo FIFO, o backfill de 10 processos (que pode custar 20 requisições)
 * entrava na frente de quem acabou de digitar o número na tela. Medido na
 * produção em 11/09/2026: a consulta do cadastro levou 36s, 38s, 45s — e o
 * usuário, com razão, chamou aquilo de travamento. Não era lentidão do CNJ: era
 * a nossa própria fila, atendendo o robô primeiro.
 *
 * Com duas faixas, o robô continua andando e cede a vez. Ele não perde nada: a
 * releitura dele não tem ninguém olhando.
 */
export type PrioridadeCnj = 'PESSOA' | 'ROBO';

interface Pedido<T = unknown> {
  fn: () => Promise<T>;
  resolver: (v: T) => void;
  rejeitar: (e: unknown) => void;
}

export class CotaPorMinuto {
  /** Instantes das requisições que ainda estão dentro da janela. */
  private readonly historico: number[] = [];
  /** Duas faixas: quem está na tela e quem não está. */
  private readonly aguardando: Record<PrioridadeCnj, Pedido[]> = { PESSOA: [], ROBO: [] };
  private bombeando = false;
  /**
   * ATÉ QUANDO A FILA ESTÁ DE CASTIGO — o que o 429 nos ensina.
   *
   * O teto de 14/min é nosso e é respeitado; mesmo assim o CNJ devolveu 429
   * cinco vezes seguidas em 11/09/2026. A explicação é que a cota é por IP e o
   * IP de saída do Railway é COMPARTILHADO: o vizinho gasta a mesma cota, e
   * nenhum contador nosso enxerga isso.
   *
   * Contra o que não se pode medir, o que resta é recuar. Sem isto, a primeira
   * recusa vira uma sequência: cada chamada seguinte encontra a janela ainda
   * estourada e falha igual, queimando a fila inteira em erros.
   */
  private deCastigoAte = 0;

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
   * O CNJ RECUSOU POR COTA: para a fila até a janela virar.
   *
   * Quem chamou já recebeu o erro — isto não repete a chamada, só evita que as
   * próximas saiam para tomar a mesma recusa.
   */
  penalizar(ms: number = CNJ_JANELA_MS): void {
    this.deCastigoAte = Math.max(this.deCastigoAte, Date.now() + ms);
  }

  /** Quantos pedidos esperam vez, por faixa — para o log dizer o porquê da espera. */
  get naFila(): { pessoa: number; robo: number } {
    return { pessoa: this.aguardando.PESSOA.length, robo: this.aguardando.ROBO.length };
  }

  /**
   * Executa `fn` respeitando a cota, em série com todas as outras.
   *
   * `prioridade` decide quem passa quando há mais de um esperando. O padrão é
   * `ROBO` de propósito: quem não disser que tem gente esperando, não tem.
   */
  executar<T>(fn: () => Promise<T>, prioridade: PrioridadeCnj = 'ROBO'): Promise<T> {
    return new Promise<T>((resolver, rejeitar) => {
      this.aguardando[prioridade].push({ fn, resolver, rejeitar } as Pedido);
      void this.bombear();
    });
  }

  /** Tira o próximo da fila: a faixa da gente primeiro, sempre. */
  private proximo(): Pedido | undefined {
    return this.aguardando.PESSOA.shift() ?? this.aguardando.ROBO.shift();
  }

  /**
   * O laço que atende a fila — um de cada vez, e um só laço.
   *
   * `bombeando` é o que garante a serialização: sem ele, duas chamadas
   * simultâneas abririam dois laços e as duas gastariam a mesma vaga.
   */
  private async bombear(): Promise<void> {
    if (this.bombeando) return;
    this.bombeando = true;
    try {
      for (let pedido = this.proximo(); pedido; pedido = this.proximo()) {
        await this.aguardarVaga();
        this.historico.push(Date.now());
        try {
          pedido.resolver(await pedido.fn());
        } catch (err) {
          pedido.rejeitar(err);
        }
      }
    } finally {
      this.bombeando = false;
    }
    // Alguém entrou na fila enquanto o laço se encerrava: recomeça.
    if (this.aguardando.PESSOA.length || this.aguardando.ROBO.length) void this.bombear();
  }

  private expirar(agora: number): void {
    while (this.historico.length && agora - this.historico[0] >= CNJ_JANELA_MS) {
      this.historico.shift();
    }
  }

  private async aguardarVaga(): Promise<void> {
    // Castigo primeiro: de nada adianta ter vaga na janela se o CNJ acabou de
    // dizer que não tem.
    const falta = this.deCastigoAte - Date.now();
    if (falta > 0) {
      this.aoEsperar?.(falta);
      await dormir(falta);
    }
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
