import { Module } from '@nestjs/common';
import { ProcessosController } from './processos.controller';
import { ProcessosService } from './processos.service';
import { DatajudService } from './datajud.service';

@Module({
  controllers: [ProcessosController],
  providers: [ProcessosService, DatajudService],
  exports: [ProcessosService, DatajudService],
})
export class ProcessosModule {}
