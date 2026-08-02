import { Module } from '@nestjs/common';
import { FiliadosController } from './filiados.controller';
import { AdminFiliadosController } from './admin-filiados.controller';
import { DuplicidadeController } from './duplicidade.controller';
import { FiliadosService } from './filiados.service';
import { DossieService } from './dossie.service';
import { DuplicidadeService } from './duplicidade.service';
import { AnexosModule } from '../anexos/anexos.module';

@Module({
  // O dossiê consolida também o ACERVO de documentos do filiado — reusa o
  // AnexosService em vez de reimplementar a varredura de anexos.
  imports: [AnexosModule],
  // DuplicidadeController vem PRIMEIRO: o Nest resolve rotas na ordem de
  // registro, e o `@Get(':id')` de FiliadosController casaria com
  // "duplicidade", devolvendo "filiado não encontrado" em vez da tela.
  controllers: [DuplicidadeController, FiliadosController, AdminFiliadosController],
  providers: [FiliadosService, DossieService, DuplicidadeService],
  exports: [FiliadosService],
})
export class FiliadosModule {}
