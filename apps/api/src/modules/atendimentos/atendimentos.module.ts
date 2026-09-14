import { Module } from '@nestjs/common';
import { AgendaModule } from '../agenda/agenda.module';
import { EscalasModule } from '../escalas/escalas.module';
import { AtendimentosController } from './atendimentos.controller';
import { AtendimentosService } from './atendimentos.service';

@Module({
  // O encaminhamento lê o plantão pelo EscalasService — sem passar pela rota
  // /escalas, que a Triagem não alcança.
  //
  // A agenda entra em 14/09/2026: fechar o atendimento cancela a consulta pela
  // regra da agenda, e a linha do tempo da atividade conta quem cancelou
  // (`AgendaService.registrarNoHistorico`). O AgendaModule não importa nenhum
  // dos dois, então não há ciclo.
  imports: [EscalasModule, AgendaModule],
  controllers: [AtendimentosController],
  providers: [AtendimentosService],
  exports: [AtendimentosService],
})
export class AtendimentosModule {}
