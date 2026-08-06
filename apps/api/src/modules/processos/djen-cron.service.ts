import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { comTravaDeJob, JOB_DJEN_SYNC } from '../../common/utils/trava-job.util';
import { DjenService } from './djen.service';
import { DjenSyncService } from './djen-sync.service';

/**
 * Robô de publicações do DJEN.
 *
 * POR QUE ÀS 05:00, E NÃO JUNTO COM O DATAJUD
 * Três horas depois da varredura do CNJ, de propósito. As movimentações do dia
 * já entraram, então a correlação tem a que se ligar: quando a publicação chega
 * para um ato que o DataJud já registrou, ela ENRIQUECE a atividade existente
 * em vez de criar uma segunda. Rodando junto, a ordem seria disputa de sorte.
 *
 * Cadência igual à do DataJud (2–3s entre chamadas): a API do DJEN não devolveu
 * 429 em rajada curta na verificação, mas é infraestrutura pública compartilhada
 * e não há razão para descobrir o limite dela em produção.
 */
@Injectable()
export class DjenCronService {
  private readonly logger = new Logger(DjenCronService.name);
  private readonly DELAY_MIN = 2000;
  private readonly DELAY_MAX = 3000;
  /**
   * A varredura é bem mais curta que a do DataJud (uma chamada por advogado,
   * não por processo), mas o complemento por NPU cresce com o acervo. 2h dão
   * folga larga e ficam muito abaixo do intervalo de 24h entre execuções.
   */
  private readonly TRAVA_TTL_MIN = 120;

  constructor(
    private readonly prisma: PrismaService,
    private readonly djen: DjenService,
    private readonly sync: DjenSyncService,
  ) {}

  @Cron('0 5 * * *', { name: 'djen-sync', timeZone: 'America/Fortaleza' })
  async sincronizarPublicacoes() {
    if (!this.djen.integracaoAtiva) return;

    await comTravaDeJob(
      this.prisma,
      JOB_DJEN_SYNC,
      this.logger,
      { ttlMinutos: this.TRAVA_TTL_MIN },
      async () => {
        const inicio = Date.now();
        try {
          await this.sync.varrer(() => this.aguardar());
          this.logger.log(
            `[DJEN-SYNC] Concluído em ${Math.round((Date.now() - inicio) / 1000)}s.`,
          );
        } catch (err) {
          this.logger.error(`[DJEN-SYNC] Erro na varredura: ${(err as Error).message}`);
        }
      },
    );
  }

  /** Espera aleatória entre DELAY_MIN e DELAY_MAX para suavizar as rajadas. */
  private aguardar(): Promise<void> {
    const ms = this.DELAY_MIN + Math.floor(Math.random() * (this.DELAY_MAX - this.DELAY_MIN + 1));
    return new Promise((r) => setTimeout(r, ms));
  }
}
