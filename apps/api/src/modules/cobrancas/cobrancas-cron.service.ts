import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CobrancasService } from './cobrancas.service';
import { pularJobSemModulo } from '../../tenant/job-do-modulo';

/**
 * Robô de automação de vencimentos. Todo dia à meia-noite, marca como VENCIDO
 * as parcelas ainda PENDENTES cujo vencimento já passou.
 *
 * MEIA-NOITE DE TERESINA, e isto precisa estar escrito.
 * `EVERY_DAY_AT_MIDNIGHT` sem fuso é meia-noite do PROCESSO, e o contêiner roda
 * em UTC: o robô disparava às 21:00 do horário de Brasília, do dia ANTERIOR. Os
 * outros dois crons do sistema (DataJud 02:00, DJEN 05:00) já fixavam
 * `America/Fortaleza`; este ficou para trás e ninguém notou porque ele não
 * chama API externa — só escreve no banco, em silêncio, três horas cedo.
 *
 * Sozinho o fuso não resolvia: `hojeUTC()` no serviço virava o dia no mesmo
 * instante. As duas coisas foram corrigidas juntas, e é por isso que este
 * comentário aponta para lá.
 *
 * NÃO DISPUTA COM NINGUÉM: não toca CNJ, então não consome a cota de 20/min
 * compartilhada pelos crons de processos, e às 00:00 os dois outros nem
 * começaram.
 *
 * LGPD: os logs registram apenas contagem/tempo — nenhum dado pessoal.
 */
@Injectable()
export class CobrancasCronService {
  private readonly logger = new Logger(CobrancasCronService.name);

  constructor(private readonly cobrancas: CobrancasService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, {
    name: 'cobrancas-vencimentos',
    timeZone: 'America/Fortaleza',
  })
  async processarVencimentos() {
    if (pularJobSemModulo('cobrancas', this.logger, 'Vencimentos')) return 0;
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
