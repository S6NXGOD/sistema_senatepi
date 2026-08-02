import { Module } from '@nestjs/common';
import { EmpresasController } from './empresas.controller';
import { EmpresasService } from './empresas.service';
import { BrasilApiService } from './brasil-api.service';
import { AuditoriaContribuicoesController } from './auditoria-contribuicoes.controller';
import { AuditoriaContribuicoesService } from './auditoria-contribuicoes.service';

@Module({
  controllers: [EmpresasController, AuditoriaContribuicoesController],
  providers: [EmpresasService, BrasilApiService, AuditoriaContribuicoesService],
  exports: [EmpresasService, AuditoriaContribuicoesService],
})
export class EmpresasModule {}
