import { Module } from '@nestjs/common';
import { EmpresasController } from './empresas.controller';
import { EmpresasService } from './empresas.service';
import { ReceitaModule } from '../../common/receita/receita.module';
import { AuditoriaContribuicoesController } from './auditoria-contribuicoes.controller';
import { AuditoriaContribuicoesService } from './auditoria-contribuicoes.service';

@Module({
  imports: [ReceitaModule],
  controllers: [EmpresasController, AuditoriaContribuicoesController],
  providers: [EmpresasService, AuditoriaContribuicoesService],
  exports: [EmpresasService, AuditoriaContribuicoesService],
})
export class EmpresasModule {}
