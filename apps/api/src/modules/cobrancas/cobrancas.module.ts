import { Module } from '@nestjs/common';
import { CobrancasController } from './cobrancas.controller';
import { CobrancasService } from './cobrancas.service';

@Module({
  controllers: [CobrancasController],
  providers: [CobrancasService],
  exports: [CobrancasService],
})
export class CobrancasModule {}
