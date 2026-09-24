import { JOB_DATAJUD_SYNC, comTravaDeJob } from '@core/infra';
import { ehCotaEstourada } from './utils/cota-do-cnj.util';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OrigemSincronizacao } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

import { AudienciasService } from './audiencias.service';
import { ProcessosService } from './processos.service';
import { FONTE_DATAJUD, SincronizacaoLogService } from './sincronizacao-log.service';
import { pularJobSemModulo } from '../../tenant/job-do-modulo';
import { integracaoAtiva } from '../../tenant/tenant.config';

/**
 * O QUE ACONTECEU NUMA RODADA DO DATAJUD — a matéria-prima da linha de resumo.
 *
 * `pulada` é a rodada que não começou porque outra detinha a trava.
 */
export type RodadaDatajud =
  | { pulada: true }
  | {
      pulada?: false;
      /** Processos que a varredura se propôs a consultar. */
      elegiveis: number;
      ok: number;
      comNovas: number;
      novas: number;
      falhas: number;
      /** Mensagem do erro que interrompeu a rodada, ou null. */
      quebrou: string | null;
    };

/**
 * A LINHA DE RESUMO DA RODADA DO DATAJUD — rodou, rodou sem alvo, foi pulada.
 *
 * O DataJud era a única rotina externa sem linha por rodada: gravava uma linha
 * por PROCESSO, e só. Uma noite com a trava ocupada ("pulando esta rodada", um
 * warn que ia só para o stdout) ou sem processo elegível passava sem linha
 * nenhuma, e o painel só estranhava o silêncio dois dias úteis depois
 * (auditoria dos robôs, 13/09/2026). DJEN e SICONFI já gravavam; isto devolve a
 * simetria, e as três respostas deixam de ser o mesmo buraco no log.
 *
 * PULADA É SUCESSO, e de propósito. Depois que a releitura da tela ganhou trava
 * própria, quem pode deter `datajud-sync` às 02:00 é outra réplica fazendo a
 * mesma varredura — a noite não se perdeu. Gravar falha empurraria a fonte para
 * INSTÁVEL por uma varredura que aconteceu.
 *
 * Função pura: o texto é o que alguém lê ao investigar, então é testado com
 * valores, não com `toContain` no fonte.
 */
export function linhaDeResumoDatajud(r: RodadaDatajud): {
  sucesso: boolean;
  mensagemErro: string;
  novasMovimentacoes: number;
} {
  if (r.pulada) {
    return {
      sucesso: true,
      novasMovimentacoes: 0,
      mensagemErro:
        'Rodada pulada: outra varredura do DataJud detinha a trava (outra réplica rodando, ou uma rodada interrompida há menos de 3 horas).',
    };
  }
  const tentativas = r.ok + r.falhas;
  if (r.quebrou) {
    return {
      sucesso: false,
      novasMovimentacoes: r.novas,
      mensagemErro: `Rodada interrompida: ${r.quebrou} (${tentativas} de ${r.elegiveis} processo(s) consultado(s) antes da quebra).`,
    };
  }
  if (r.elegiveis === 0) {
    return {
      sucesso: true,
      novasMovimentacoes: 0,
      mensagemErro: 'Rodada sem alvo: nenhum processo elegível para consulta.',
    };
  }
  // Tentou tudo e nada voltou: não é "rodou". É o CNJ, a rede ou a cota.
  if (tentativas > 0 && r.falhas === tentativas) {
    return {
      sucesso: false,
      novasMovimentacoes: 0,
      mensagemErro: `Rodada sem resposta: as ${tentativas} consulta(s) falharam.`,
    };
  }
  const novidades = `${r.comNovas} com novidade (${r.novas} movimentação(ões) nova(s))`;
  return {
    sucesso: true,
    novasMovimentacoes: r.novas,
    mensagemErro:
      r.falhas > 0
        ? `Rodada concluída com ${r.falhas} de ${tentativas} consulta(s) em falha; ${r.ok} processo(s) consultado(s), ${novidades}.`
        : `Rodada concluída: ${r.ok} processo(s) consultado(s), ${novidades}.`,
  };
}

/**
 * Robô de sincronização do DATAJUD.
 *
 * Roda de madrugada (02:00) e varre todos os processos ATIVOS, atualizando o
 * cache local com as novas movimentações — de forma silenciosa (sem auditoria
 * por processo) para não poluir o histórico.
 *
 * Rate limit do CNJ: a API Pública é compartilhada e sensível a rajadas; por
 * isso há um DELAY de 2–3s entre cada consulta e as falhas são isoladas
 * (um processo que der erro não interrompe a varredura).
 */
/** Por quantos dias o log de sincronização é guardado. Ver `podarLogAntigo`. */
const DIAS_DE_LOG = 90;

@Injectable()
export class ProcessosCronService {
  private readonly logger = new Logger(ProcessosCronService.name);
  private readonly DELAY_MIN = 2000;
  private readonly DELAY_MAX = 3000;
  /** Processa em lotes pequenos, com respiro entre eles (fila leve). */
  private readonly TAMANHO_LOTE = 10;
  private readonly PAUSA_ENTRE_LOTES = 5000;
  /**
   * Quanto esperar antes de repetir quem levou 429.
   *
   * A cota do CNJ é por minuto; um minuto inteiro é o menor intervalo que
   * garante que a janela virou. Numa rodada de madrugada, sessenta segundos não
   * custam nada — e é a diferença entre o processo ser lido hoje ou daqui a
   * oito dias, se ele estiver na faixa lenta.
   */
  private readonly PAUSA_APOS_COTA = 60_000;
  /**
   * Validade da trava. A varredura leva ~5s por processo (2–3s de espera + a
   * consulta, que o CNJ responde em 10–25s nos casos ruins); 3h dão folga larga
   * sobre o acervo atual sem chegar perto do intervalo de 24h entre execuções.
   */
  private readonly TRAVA_TTL_MIN = 180;

  constructor(
    private readonly prisma: PrismaService,
    private readonly processos: ProcessosService,
    private readonly audiencias: AudienciasService,
    private readonly logSync: SincronizacaoLogService,
  ) {}

  @Cron('0 2 * * *', { name: 'datajud-sync', timeZone: 'America/Fortaleza' })
  async sincronizarAtivos() {
    if (pularJobSemModulo('processos', this.logger, 'DATAJUD-SYNC')) return;
    if (!integracaoAtiva('datajud', process.env.DATAJUD_INTEGRACAO)) {
      // Instalação com acervo jurídico mas sem consulta ao CNJ: os processos
      // existem e são editados à mão, e a varredura noturna simplesmente não
      // acontece. Em `debug` porque, ali, isso é o esperado todo dia.
      this.logger.debug('[DATAJUD-SYNC] Integração não faz parte desta instalação.');
      return;
    }

    // Trava no banco, e não em memória: com duas réplicas da API, dois
    // booleanos de instância valeriam `false` ao mesmo tempo e as duas varreriam
    // o acervo em paralelo — o dobro de chamadas ao CNJ.
    const rodada = await comTravaDeJob(
      this.prisma,
      JOB_DATAJUD_SYNC,
      this.logger,
      { ttlMinutos: this.TRAVA_TTL_MIN },
      () => this.varrer(),
    );
    // A rodada que não começou também fica no log — ver `linhaDeResumoDatajud`.
    if (!rodada.executou) await this.registrarRodada({ pulada: true }, 0);

    // Depois da varredura, e fora da trava: se a poda falhar, o que importa
    // (a sincronização) já aconteceu.
    await this.podarLogAntigo().catch((e) =>
      this.logger.warn(`[DATAJUD-SYNC] Falha ao podar o log: ${(e as Error).message}`),
    );
  }

  /**
   * PODA DO LOG DE SINCRONIZAÇÃO — a única tabela que este sistema apaga sozinho.
   *
   * Medido em 04/09/2026: o banco inteiro tem 48 MB e não corre risco nenhum.
   * O que cresce sem freio é telemetria: 1.176 linhas de log em 31 dias, ~14 mil
   * por ano. Não é urgente; é o tipo de coisa que ninguém lembra de olhar e que
   * em três anos vira a maior tabela do banco por nada.
   *
   * O QUE NÃO É PODADO, e de propósito:
   *
   *  - `auditorias` — é a trilha de quem fez o quê. Num sistema jurídico ela é
   *    prova, não sujeira. Some só se alguém decidir que some, à mão.
   *  - `importacao_linhas` — 7.550 linhas de conferência de importações já
   *    concluídas. Parece lixo e é histórico de uma migração de acervo; apagar
   *    por conta própria tiraria a chance de auditar de onde veio cada processo.
   *  - `comunicacoes_djen` e `movimentacoes_processuais` — são o acervo.
   *
   * Noventa dias cobrem qualquer investigação de "por que o robô parou", que é
   * a única pergunta que este log responde. O painel de saúde olha as últimas
   * 48 horas.
   */
  private async podarLogAntigo() {
    const corte = new Date(Date.now() - DIAS_DE_LOG * 24 * 3_600_000);
    const { count } = await this.prisma.logSincronizacaoDatajud.deleteMany({
      where: { createdAt: { lt: corte } },
    });
    if (count) this.logger.log(`[DATAJUD-SYNC] ${count} log(s) com mais de ${DIAS_DE_LOG} dias removido(s).`);
  }

  private async varrer() {
    const inicio = Date.now();
    // Fora do `try`: a linha de resumo do `finally` precisa do que já foi
    // contado mesmo quando a rodada quebra no meio.
    const rodada = {
      elegiveis: 0, ok: 0, comNovas: 0, novas: 0, falhas: 0,
      /** Quantos voltaram na segunda tentativa depois de um 429. */
      recuperados: 0,
      quebrou: null as string | null,
    };
    /** Os que levaram 429: a cota era de outro, e eles merecem uma segunda vez. */
    const paraTentarDeNovo: string[] = [];

    try {
      // Ativos E pendentes: um processo recém-cadastrado (PENDENTE) também
      // precisa receber os andamentos até ser formalizado.
      const ids = await this.processos.idsParaSincronizar();
      rodada.elegiveis = ids.length;
      const totalLotes = Math.ceil(ids.length / this.TAMANHO_LOTE);
      this.logger.log(
        `[DATAJUD-SYNC] Iniciando varredura de ${ids.length} processo(s) ativo(s)/pendente(s) ` +
          `em ${totalLotes} lote(s) de até ${this.TAMANHO_LOTE}…`,
      );

      for (let inicioLote = 0; inicioLote < ids.length; inicioLote += this.TAMANHO_LOTE) {
        const lote = ids.slice(inicioLote, inicioLote + this.TAMANHO_LOTE);
        const numeroLote = Math.floor(inicioLote / this.TAMANHO_LOTE) + 1;

        // Dentro do lote, as chamadas são SEQUENCIAIS com 2–3s entre elas.
        // Paralelizar aqui seria justamente o que estoura o rate limit do CNJ.
        for (let i = 0; i < lote.length; i++) {
          const id = lote[i];
          try {
            const { novas } = await this.processos.ressincronizarSilencioso(id);
            rodada.ok++;
            if (novas > 0) {
              rodada.comNovas++;
              rodada.novas += novas;
              this.logger.log(`[DATAJUD-SYNC] Processo ${id}: ${novas} nova(s) movimentação(ões).`);
            }
          } catch (err) {
            rodada.falhas++;
            // Isola a falha (rate limit, CNJ fora do ar, tribunal desconhecido).
            // O motivo detalhado já foi para `logs_sincronizacao_datajud`.
            this.logger.warn(`[DATAJUD-SYNC] Falha no processo ${id}: ${(err as Error).message}`);
            if (ehCotaEstourada(err)) paraTentarDeNovo.push(id);
          }
          if (i < lote.length - 1) await this.aguardar();
        }

        this.logger.log(`[DATAJUD-SYNC] Lote ${numeroLote}/${totalLotes} concluído.`);
        // Respiro entre lotes — mantém o servidor e o CNJ folgados.
        if (inicioLote + this.TAMANHO_LOTE < ids.length) {
          await new Promise((r) => setTimeout(r, this.PAUSA_ENTRE_LOTES));
        }
      }

      /*
        O 429 NÃO É DEFEITO DO PROCESSO — é a vez de outro (24/09/2026).

        O dono perguntou se valia espaçar as chamadas ou dividir a varredura em
        duas janelas. MEDIDO antes de decidir, e a medição derrubou as duas
        ideias:

          ritmo real da varredura ..... 1 a 2 chamadas por MINUTO
          cota do CNJ ................. 20 por minuto
          429 em 24/09 ................ 9 de 169 (5,3%)
          429 nos 8 dias anteriores ... ZERO

        Não somos nós que estouramos a cota: estamos a um décimo dela. O 429 veio
        de fora — o IP do Railway é compartilhado, e naquela manhã alguém mais
        gastou a cota antes. Espaçar mais só alongaria a rodada sem ganhar nada,
        e dividir em duas janelas DOBRARIA a exposição ao começo de rodada, que
        é justamente onde os 429 caíram.

        O que faltava era simples: 429 quer dizer "tente daqui a pouco", e a
        rodada nunca tentava. Estes voltam UMA vez, no fim, com um respiro maior
        — custa segundos numa rodada de madrugada e devolve o dia de atualização
        que aqueles processos perderam por um motivo que não era deles.

        Uma vez só, de propósito: se a cota ainda estiver estourada na segunda
        tentativa, insistir vira parte do problema.
      */
      if (paraTentarDeNovo.length) {
        this.logger.log(
          `[DATAJUD-SYNC] ${paraTentarDeNovo.length} processo(s) levaram 429 (cota do CNJ); ` +
            'tentando de novo uma vez, no fim da rodada.',
        );
        await new Promise((r) => setTimeout(r, this.PAUSA_APOS_COTA));
        for (let i = 0; i < paraTentarDeNovo.length; i++) {
          const id = paraTentarDeNovo[i];
          try {
            const { novas } = await this.processos.ressincronizarSilencioso(id);
            rodada.ok++;
            rodada.falhas--;
            rodada.recuperados++;
            if (novas > 0) {
              rodada.comNovas++;
              rodada.novas += novas;
            }
          } catch (err) {
            this.logger.warn(
              `[DATAJUD-SYNC] ${id} falhou de novo depois da cota: ${(err as Error).message}`,
            );
          }
          if (i < paraTentarDeNovo.length - 1) await this.aguardar();
        }
      }

      this.logger.log(
        `[DATAJUD-SYNC] Concluído em ${Math.round((Date.now() - inicio) / 1000)}s — ` +
          `${rodada.ok} sincronizado(s), ${rodada.comNovas} com novidades (${rodada.novas} mov.), ` +
          `${rodada.falhas} falha(s)` +
          (rodada.recuperados ? `, ${rodada.recuperados} recuperado(s) da cota` : '') +
          '.',
      );
    } catch (err) {
      rodada.quebrou = (err as Error).message;
      this.logger.error(`[DATAJUD-SYNC] Erro na varredura: ${rodada.quebrou}`);
    } finally {
      // Grava até quando quebra — a mesma garantia que o DJEN já dava.
      await this.registrarRodada(rodada, Date.now() - inicio);
    }

    // Radar de audiências: as movimentações novas já entraram classificadas.
    // Este número é o que a equipe vai ver no painel pela manhã — alertas
    // dispensados NÃO voltam, porque a dispensa mora na própria movimentação
    // e a sincronização só insere movimentações ausentes.
    // Fora do `try` da varredura: contar o radar é leitura de conveniência, e
    // um erro nela não pode ficar gravado como "rodada interrompida".
    try {
      const pendentes = await this.audiencias.contarPendentes();
      this.logger.log(`[RADAR-AUDIENCIAS] ${pendentes} audiência(s) aguardando agendamento.`);
    } catch (err) {
      this.logger.warn(`[RADAR-AUDIENCIAS] Não deu para contar: ${(err as Error).message}`);
    }
  }

  /**
   * Uma linha por rodada em `logs_sincronizacao_datajud`, sem processo e sem NPU:
   * ela fala da RODADA. Quem conta "processos sincronizados" por linha do
   * DataJud precisa ignorar `processo_id IS NULL AND numero_cnj IS NULL`.
   */
  private async registrarRodada(rodada: RodadaDatajud, duracaoMs: number) {
    await this.logSync.registrar({
      fonte: FONTE_DATAJUD,
      origem: OrigemSincronizacao.CRON,
      processoId: null,
      numeroCNJ: null,
      duracaoMs,
      ...linhaDeResumoDatajud(rodada),
    });
  }

  /** Espera aleatória entre DELAY_MIN e DELAY_MAX para suavizar as rajadas. */
  private aguardar(): Promise<void> {
    const ms = this.DELAY_MIN + Math.floor(Math.random() * (this.DELAY_MAX - this.DELAY_MIN + 1));
    return new Promise((r) => setTimeout(r, ms));
  }
}
