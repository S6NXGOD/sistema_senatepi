import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { RelatoriosController } from './relatorios.controller';
import { RelatoriosService } from './relatorios.service';
import { ProdutividadeService } from './produtividade.service';
import { RostosService } from './rostos.service';

/** `StorageService` (usado pelas fotos do PDF) vem do `StorageModule`, que é global. */
@Module({
  imports: [PrismaModule],
  controllers: [RelatoriosController],
  providers: [RelatoriosService, ProdutividadeService, RostosService],
})
export class RelatoriosModule {}
