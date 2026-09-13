import { Module } from '@nestjs/common';
import { EscalasModule } from '../escalas/escalas.module';
import { AtendimentosController } from './atendimentos.controller';
import { AtendimentosService } from './atendimentos.service';

@Module({
  // O encaminhamento lê o plantão pelo EscalasService — sem passar pela rota
  // /escalas, que a Triagem não alcança.
  imports: [EscalasModule],
  controllers: [AtendimentosController],
  providers: [AtendimentosService],
  exports: [AtendimentosService],
})
export class AtendimentosModule {}
