import { Module } from '@nestjs/common';
import { AgendaModule } from '../agenda/agenda.module';
import { AudienciasController } from './audiencias.controller';
import { AudienciasService } from './audiencias.service';
import { ProcessosController } from './processos.controller';
import { ProcessosService } from './processos.service';
import { DatajudService } from './datajud.service';
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
    PartesController,
    PartesExternasController,
  ],
  providers: [
    ProcessosService,
    DatajudService,
    ProcessosCronService,
    AudienciasService,
    MovimentacoesService,
    SincronizacaoLogService,
    ConsultaPreviaService,
    PartesService,
    PartesExternasService,
    AutomacaoPrazosService,
  ],
  exports: [ProcessosService, DatajudService, AudienciasService, PartesService],
})
export class ProcessosModule {}
