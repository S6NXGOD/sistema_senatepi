import { Module } from '@nestjs/common';
import { ProcessosController } from './processos.controller';
import { ProcessosService } from './processos.service';
import { DatajudService } from './datajud.service';
import { ProcessosCronService } from './processos-cron.service';

@Module({
  controllers: [ProcessosController],
  providers: [ProcessosService, DatajudService, ProcessosCronService],
  exports: [ProcessosService, DatajudService],
})
export class ProcessosModule {}
