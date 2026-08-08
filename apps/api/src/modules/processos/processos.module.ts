import { Module } from '@nestjs/common';
import { AgendaModule } from '../agenda/agenda.module';
import { AudienciasController } from './audiencias.controller';
import { AudienciasService } from './audiencias.service';
import { ProcessosController } from './processos.controller';
import { ProcessosService } from './processos.service';
import { DatajudService } from './datajud.service';
import { DjenService } from './djen.service';
import { DjenSyncService } from './djen-sync.service';
import { DjenCronService } from './djen-cron.service';
import { DjenAtivoGuard, DjenController } from './djen.controller';
import { InstanciasService } from './instancias.service';
import { ProcessosCronService } from './processos-cron.service';
import { MovimentacoesService } from './movimentacoes.service';
import {
  DatajudConsultaController, MovimentacoesController, TiposMovimentacaoController,
} from './movimentacoes.controller';
import { SincronizacaoLogService } from './sincronizacao-log.service';
import { ConsultaPreviaService } from './consulta-previa.service';
import { PartesController, PartesExternasController } from './partes.controller';
import { PartesService } from './partes.service';
import { PartesExternasService } from './partes-externas.service';
import { AutomacaoPrazosService } from './automacao-prazos.service';
import { CorrelacaoService } from './correlacao.service';
import { ParteInstitucionalSeedService } from './parte-institucional-seed.service';

@Module({
  // AgendaModule: o radar de audiências cria o compromisso pela AgendaService,
  // reaproveitando validações, auditoria e trava de data original da Agenda.
  imports: [AgendaModule],
  controllers: [
    ProcessosController,
    AudienciasController,
    MovimentacoesController,
    TiposMovimentacaoController,
    DatajudConsultaController,
    DjenController,
    PartesController,
    PartesExternasController,
  ],
  providers: [
    ParteInstitucionalSeedService,
    ProcessosService,
    DatajudService,
    InstanciasService,
    DjenService,
    DjenSyncService,
    DjenCronService,
    DjenAtivoGuard,
    ProcessosCronService,
    AudienciasService,
    MovimentacoesService,
    SincronizacaoLogService,
    ConsultaPreviaService,
    PartesService,
    PartesExternasService,
    AutomacaoPrazosService,
    CorrelacaoService,
  ],
  exports: [ProcessosService, DatajudService, AudienciasService, PartesService],
})
export class ProcessosModule {}
