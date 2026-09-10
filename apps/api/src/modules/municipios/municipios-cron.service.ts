import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OrigemSincronizacao } from '@prisma/client';
import { JOB_SICONFI_SYNC, comTravaDeJob } from '@core/infra';
import { PrismaService } from '../../prisma/prisma.service';
import { pularJobSemModulo } from '../../tenant/job-do-modulo';
import { integracaoAtiva } from '../../tenant/tenant.config';
import { SiconfiSyncService } from './siconfi-sync.service';
import { VinculoDeEnteService } from './vinculo-de-ente.service';

/**
 * A ROTINA NOTURNA DOS MUNICÍPIOS.
 *
 * ÀS 03:00 DE TERESINA, e o fuso é obrigatório: o contêiner roda em UTC, e sem
 * `timeZone` o disparo aconteceria às 00:00 daqui — três horas antes, ainda no
 * dia anterior. Há teste no repositório que afirma exatamente isso.
 *
 * POR QUE 03:00. É o buraco entre o DataJud (02:00) e o DJEN (05:00). Os três
 * jobs falam com fora e nenhum deles precisa disputar rede com o outro.
 *
 * DUAS TAREFAS, NESTA ORDEM, e a ordem importa:
 *
 *  1. CASAR o cadastro com o catálogo. Filiado cadastrado ontem no balcão ganha
 *     o município hoje de madrugada.
 *  2. BUSCAR os indicadores no Tesouro — e só para os municípios que o passo 1
 *     acabou de mostrar que interessam. Invertendo a ordem, um município que
 *     entrou na base ontem esperaria mais um dia inteiro pelo indicador.
 *
 * A trava no banco existe porque duas réplicas da API disparam o mesmo cron no
 * mesmo minuto.
 */
@Injectable()
export class MunicipiosCronService {
  private readonly logger = new Logger(MunicipiosCronService.name);
  private readonly TRAVA_TTL_MIN = 60;

  constructor(
    private readonly prisma: PrismaService,
    private readonly siconfi: SiconfiSyncService,
    private readonly vinculo: VinculoDeEnteService,
  ) {}

  @Cron('0 3 * * *', { name: 'municipios-sync', timeZone: 'America/Fortaleza' })
  async rotinaNoturna() {
    if (pularJobSemModulo('municipios', this.logger, 'MUNICIPIOS')) return;

    await comTravaDeJob(
      this.prisma,
      JOB_SICONFI_SYNC,
      this.logger,
      { ttlMinutos: this.TRAVA_TTL_MIN },
      async () => {
        /*
          O CASAMENTO roda mesmo com a integração do Tesouro desligada: ele é
          trabalho local, entre o cadastro e o catálogo que já está no banco.
          Amarrar as duas coisas faria uma API externa fora do ar impedir que o
          filiado de ontem ganhasse município.
        */
        try {
          await this.vinculo.casarFiliados();
          await this.vinculo.casarOrganizacoes();
        } catch (err) {
          this.logger.error(`[MUNICIPIOS] Falha ao casar cadastros: ${(err as Error).message}`);
        }

        if (!integracaoAtiva('siconfi', process.env.SICONFI_INTEGRACAO)) {
          this.logger.debug('[SICONFI] Integração desligada nesta instalação — indicadores não buscados.');
          return;
        }

        try {
          await this.siconfi.sincronizar(OrigemSincronizacao.CRON);
        } catch (err) {
          this.logger.error(`[SICONFI] Erro na varredura: ${(err as Error).message}`);
        }
      },
    );
  }
}
