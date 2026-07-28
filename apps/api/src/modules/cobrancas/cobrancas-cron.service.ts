import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CobrancasService } from './cobrancas.service';

/**
 * Robô de automação de vencimentos. Todo dia à meia-noite, marca como VENCIDO
 * as parcelas ainda PENDENTES cujo vencimento já passou.
 *
 * LGPD: os logs registram apenas contagem/tempo — nenhum dado pessoal.
 */
@Injectable()
export class CobrancasCronService {
  private readonly logger = new Logger(CobrancasCronService.name);

  constructor(private readonly cobrancas: CobrancasService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async processarVencimentos() {
    const inicio = Date.now();
    this.logger.log('[Vencimentos] Iniciando varredura de parcelas vencidas…');
    try {
      const atualizadas = await this.cobrancas.marcarParcelasVencidas();
      this.logger.log(
        `[Vencimentos] Concluído: ${atualizadas} parcela(s) marcada(s) como VENCIDO em ${Date.now() - inicio}ms.`,
      );
      return atualizadas;
    } catch (err) {
      this.logger.error(`[Vencimentos] Falha na varredura: ${(err as Error).message}`);
      throw err;
    }
  }
}
