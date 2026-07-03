import { Module } from '@nestjs/common';
import { FiliadosController } from './filiados.controller';
import { AdminFiliadosController } from './admin-filiados.controller';
import { FiliadosService } from './filiados.service';

@Module({
  controllers: [FiliadosController, AdminFiliadosController],
  providers: [FiliadosService],
  exports: [FiliadosService],
})
export class FiliadosModule {}
