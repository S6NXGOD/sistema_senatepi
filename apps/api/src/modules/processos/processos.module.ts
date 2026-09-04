import { Module } from '@nestjs/common';
import { AgendaModule } from '../agenda/agenda.module';
import { ReceitaModule } from '../../common/receita/receita.module';
import { AudienciasController } from './audiencias.controller';
import { AudienciasService } from './audiencias.service';
import { ProcessosController } from './processos.controller';
import { ProcessosService } from './processos.service';
import { DatajudService } from './datajud.service';
import { DjenService } from './djen.service';
import { DjenSyncService } from './djen-sync.service';
import { DjenBuscaService } from './djen-busca.service';
import { PadroesService } from './padroes.service';
import { DossieProcessoService } from './dossie-processo.service';
import { PadroesController } from './padroes.controller';
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
import { OrganizacoesHerdadasService } from './organizacoes-herdadas.service';

@Module({
  // AgendaModule: o radar de audiências cria o compromisso pela AgendaService,
  // reaproveitando validações, auditoria e trava de data original da Agenda.
  imports: [AgendaModule, ReceitaModule],
  controllers: [
    ProcessosController,
    AudienciasController,
    MovimentacoesController,
    TiposMovimentacaoController,
    DatajudConsultaController,
    DjenController,
    PartesController,
    PartesExternasController,
    PadroesController,
  ],
  providers: [
    ParteInstitucionalSeedService,
    OrganizacoesHerdadasService,
    ProcessosService,
    DatajudService,
    InstanciasService,
    DjenService,
    DjenSyncService,
    DjenBuscaService,
    PadroesService,
    DossieProcessoService,
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
