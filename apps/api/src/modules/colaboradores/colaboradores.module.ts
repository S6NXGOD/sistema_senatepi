import { Module } from '@nestjs/common';
import { CadastrosController } from './cadastros.controller';
import { CadastrosService } from './cadastros.service';
import { ColaboradoresController } from './colaboradores.controller';
import { ColaboradoresService } from './colaboradores.service';

@Module({
  controllers: [CadastrosController, ColaboradoresController],
  providers: [CadastrosService, ColaboradoresService],
})
export class ColaboradoresModule {}
