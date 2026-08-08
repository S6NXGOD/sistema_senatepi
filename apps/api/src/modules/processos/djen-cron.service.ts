import { JOB_DJEN_SYNC, comTravaDeJob } from '@core/infra';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

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
   * Prazo da trava.
   *
   * A duração da rodada é LIMITADA por construção: a cota do CNJ é de 20
   * requisições por minuto, o serviço se segura em 14, e o complemento por NPU
   * tem teto de processos por noite (DJEN_MAX_PROCESSOS_POR_RODADA, padrão
   * 300). No pior caso são ~300 consultas + uma por advogado, ou seja ~25
   * minutos. Três horas dão folga larga sobre isso e continuam muito abaixo do
   * intervalo de 24h entre execuções — o que importa é que a trava JAMAIS
   * expire com a rodada ainda correndo, porque aí duas passariam a disputar a
   * mesma cota.
   */
  private readonly TRAVA_TTL_MIN = 180;

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
