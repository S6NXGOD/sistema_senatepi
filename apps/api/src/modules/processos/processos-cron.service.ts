import { JOB_DATAJUD_SYNC, comTravaDeJob } from '@core/infra';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

import { AudienciasService } from './audiencias.service';
import { ProcessosService } from './processos.service';
import { pularJobSemModulo } from '../../tenant/job-do-modulo';
import { integracaoAtiva } from '../../tenant/tenant.config';

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
   * Validade da trava. A varredura leva ~5s por processo (2–3s de espera + a
   * consulta, que o CNJ responde em 10–25s nos casos ruins); 3h dão folga larga
   * sobre o acervo atual sem chegar perto do intervalo de 24h entre execuções.
   */
  private readonly TRAVA_TTL_MIN = 180;

  constructor(
    private readonly prisma: PrismaService,
    private readonly processos: ProcessosService,
    private readonly audiencias: AudienciasService,
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
    await comTravaDeJob(
      this.prisma,
      JOB_DATAJUD_SYNC,
      this.logger,
      { ttlMinutos: this.TRAVA_TTL_MIN },
      () => this.varrer(),
    );

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

    try {
      // Ativos E pendentes: um processo recém-cadastrado (PENDENTE) também
      // precisa receber os andamentos até ser formalizado.
      const ids = await this.processos.idsParaSincronizar();
      const totalLotes = Math.ceil(ids.length / this.TAMANHO_LOTE);
      this.logger.log(
        `[DATAJUD-SYNC] Iniciando varredura de ${ids.length} processo(s) ativo(s)/pendente(s) ` +
          `em ${totalLotes} lote(s) de até ${this.TAMANHO_LOTE}…`,
      );

      let ok = 0;
      let comNovas = 0;
      let novasTotal = 0;
      let falhas = 0;

      for (let inicioLote = 0; inicioLote < ids.length; inicioLote += this.TAMANHO_LOTE) {
        const lote = ids.slice(inicioLote, inicioLote + this.TAMANHO_LOTE);
        const numeroLote = Math.floor(inicioLote / this.TAMANHO_LOTE) + 1;

        // Dentro do lote, as chamadas são SEQUENCIAIS com 2–3s entre elas.
        // Paralelizar aqui seria justamente o que estoura o rate limit do CNJ.
        for (let i = 0; i < lote.length; i++) {
          const id = lote[i];
          try {
            const { novas } = await this.processos.ressincronizarSilencioso(id);
            ok++;
            if (novas > 0) {
              comNovas++;
              novasTotal += novas;
              this.logger.log(`[DATAJUD-SYNC] Processo ${id}: ${novas} nova(s) movimentação(ões).`);
            }
          } catch (err) {
            falhas++;
            // Isola a falha (rate limit, CNJ fora do ar, tribunal desconhecido).
            // O motivo detalhado já foi para `logs_sincronizacao_datajud`.
            this.logger.warn(`[DATAJUD-SYNC] Falha no processo ${id}: ${(err as Error).message}`);
          }
          if (i < lote.length - 1) await this.aguardar();
        }

        this.logger.log(`[DATAJUD-SYNC] Lote ${numeroLote}/${totalLotes} concluído.`);
        // Respiro entre lotes — mantém o servidor e o CNJ folgados.
        if (inicioLote + this.TAMANHO_LOTE < ids.length) {
          await new Promise((r) => setTimeout(r, this.PAUSA_ENTRE_LOTES));
        }
      }

      this.logger.log(
        `[DATAJUD-SYNC] Concluído em ${Math.round((Date.now() - inicio) / 1000)}s — ` +
          `${ok} sincronizado(s), ${comNovas} com novidades (${novasTotal} mov.), ${falhas} falha(s).`,
      );

      // Radar de audiências: as movimentações novas já entraram classificadas.
      // Este número é o que a equipe vai ver no painel pela manhã — alertas
      // dispensados NÃO voltam, porque a dispensa mora na própria movimentação
      // e a sincronização só insere movimentações ausentes.
      const pendentes = await this.audiencias.contarPendentes();
      this.logger.log(`[RADAR-AUDIENCIAS] ${pendentes} audiência(s) aguardando agendamento.`);
    } catch (err) {
      this.logger.error(`[DATAJUD-SYNC] Erro na varredura: ${(err as Error).message}`);
    }
  }

  /** Espera aleatória entre DELAY_MIN e DELAY_MAX para suavizar as rajadas. */
  private aguardar(): Promise<void> {
    const ms = this.DELAY_MIN + Math.floor(Math.random() * (this.DELAY_MAX - this.DELAY_MIN + 1));
    return new Promise((r) => setTimeout(r, ms));
  }
}
