import { Module } from '@nestjs/common';
import { EscalasController } from './escalas.controller';
import { EscalasService } from './escalas.service';

@Module({
  controllers: [EscalasController],
  providers: [EscalasService],
  exports: [EscalasService],
})
export class EscalasModule {}
