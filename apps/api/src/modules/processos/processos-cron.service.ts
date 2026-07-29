import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ProcessosService } from './processos.service';

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
@Injectable()
export class ProcessosCronService {
  private readonly logger = new Logger(ProcessosCronService.name);
  private readonly DELAY_MIN = 2000;
  private readonly DELAY_MAX = 3000;
  /** Trava de reentrância: garante que duas execuções não se sobreponham. */
  private rodando = false;

  constructor(private readonly processos: ProcessosService) {}

  @Cron('0 2 * * *', { name: 'datajud-sync', timeZone: 'America/Fortaleza' })
  async sincronizarAtivos() {
    if (this.rodando) {
      this.logger.warn('[DATAJUD-SYNC] Execução anterior ainda em andamento — pulando.');
      return;
    }
    this.rodando = true;
    const inicio = Date.now();

    try {
      const ids = await this.processos.idsAtivos();
      this.logger.log(`[DATAJUD-SYNC] Iniciando varredura de ${ids.length} processo(s) ATIVO(s)…`);

      let ok = 0;
      let comNovas = 0;
      let novasTotal = 0;
      let falhas = 0;

      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
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
          // Isola a falha (rate limit, indisponibilidade do CNJ, tribunal desconhecido).
          this.logger.warn(`[DATAJUD-SYNC] Falha no processo ${id}: ${(err as Error).message}`);
        }

        // Respeita o rate limit do CNJ: aguarda entre 2 e 3s (exceto no último).
        if (i < ids.length - 1) await this.aguardar();
      }

      this.logger.log(
        `[DATAJUD-SYNC] Concluído em ${Math.round((Date.now() - inicio) / 1000)}s — ` +
          `${ok} sincronizado(s), ${comNovas} com novidades (${novasTotal} mov.), ${falhas} falha(s).`,
      );
    } catch (err) {
      this.logger.error(`[DATAJUD-SYNC] Erro na varredura: ${(err as Error).message}`);
    } finally {
      this.rodando = false;
    }
  }

  /** Espera aleatória entre DELAY_MIN e DELAY_MAX para suavizar as rajadas. */
  private aguardar(): Promise<void> {
    const ms = this.DELAY_MIN + Math.floor(Math.random() * (this.DELAY_MAX - this.DELAY_MIN + 1));
    return new Promise((r) => setTimeout(r, ms));
  }
}
