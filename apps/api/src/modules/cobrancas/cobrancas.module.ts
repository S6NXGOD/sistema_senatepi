import { Module } from '@nestjs/common';
import { CobrancasController } from './cobrancas.controller';
import { CobrancasService } from './cobrancas.service';
import { CobrancasCronService } from './cobrancas-cron.service';

@Module({
  controllers: [CobrancasController],
  providers: [CobrancasService, CobrancasCronService],
  exports: [CobrancasService],
})
export class CobrancasModule {}
