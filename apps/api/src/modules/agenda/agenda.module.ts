import { Module } from '@nestjs/common';
import { AgendaController } from './agenda.controller';
import { AgendaService } from './agenda.service';
import { TiposEventoController } from './tipos-evento.controller';
import { TiposEventoService } from './tipos-evento.service';
import { PendenciasController } from './pendencias.controller';
import { PendenciasService } from './pendencias.service';

@Module({
  controllers: [AgendaController, TiposEventoController, PendenciasController],
  providers: [AgendaService, TiposEventoService, PendenciasService],
  exports: [AgendaService],
})
export class AgendaModule {}
