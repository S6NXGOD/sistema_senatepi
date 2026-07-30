import { Module } from '@nestjs/common';
import { AgendaController } from './agenda.controller';
import { AgendaService } from './agenda.service';
import { TiposEventoController } from './tipos-evento.controller';
import { TiposEventoService } from './tipos-evento.service';

@Module({
  controllers: [AgendaController, TiposEventoController],
  providers: [AgendaService, TiposEventoService],
  exports: [AgendaService],
})
export class AgendaModule {}
