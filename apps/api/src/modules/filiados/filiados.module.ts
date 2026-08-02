import { Module } from '@nestjs/common';
import { FiliadosController } from './filiados.controller';
import { AdminFiliadosController } from './admin-filiados.controller';
import { FiliadosService } from './filiados.service';
import { DossieService } from './dossie.service';
import { AnexosModule } from '../anexos/anexos.module';

@Module({
  // O dossiê consolida também o ACERVO de documentos do filiado — reusa o
  // AnexosService em vez de reimplementar a varredura de anexos.
  imports: [AnexosModule],
  controllers: [FiliadosController, AdminFiliadosController],
  providers: [FiliadosService, DossieService],
  exports: [FiliadosService],
})
export class FiliadosModule {}
