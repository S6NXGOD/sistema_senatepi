import { Module } from '@nestjs/common';
import { MunicipiosController } from './municipios.controller';
import { MunicipiosService } from './municipios.service';
import { EnteSeedService } from './ente-seed.service';
import { MunicipiosCronService } from './municipios-cron.service';
import { SiconfiService } from './siconfi.service';
import { SiconfiSyncService } from './siconfi-sync.service';
import { VinculoDeEnteService } from './vinculo-de-ente.service';
import { RelatorioEntesService } from './relatorio-entes.service';
import { FichaDoEnteService } from './ficha-do-ente.service';
import { SincronizacaoLogService } from '../processos/sincronizacao-log.service';

/**
 * MUNICÍPIOS (IBGE) E INDICADORES FISCAIS (SICONFI).
 *
 * `PrismaModule` é `@Global()` — por isso não aparece em `imports`.
 *
 * `SincronizacaoLogService` é declarado aqui como provider próprio em vez de
 * importado de `ProcessosModule`: ele só depende do Prisma, e importar o módulo
 * de Processos inteiro para gravar uma linha de log traria junto DataJud, DJEN
 * e crons de processo como dependência deste módulo. A tabela é a mesma
 * (`logs_sincronizacao_datajud`, com a coluna `fonte` em texto justamente para
 * caber fonte nova) e o serviço não guarda estado.
 */
@Module({
  controllers: [MunicipiosController],
  providers: [
    MunicipiosService,
    EnteSeedService,
    MunicipiosCronService,
    SiconfiService,
    SiconfiSyncService,
    VinculoDeEnteService,
    RelatorioEntesService,
    FichaDoEnteService,
    SincronizacaoLogService,
  ],
  exports: [MunicipiosService, VinculoDeEnteService],
})
export class MunicipiosModule {}
