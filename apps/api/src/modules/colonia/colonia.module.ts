import { Module } from '@nestjs/common';
import { ColoniaController } from './colonia.controller';
import { ColoniaService } from './colonia.service';
import { ColoniaSeedService } from './colonia-seed.service';

@Module({
  controllers: [ColoniaController],
  providers: [ColoniaService, ColoniaSeedService],
  exports: [ColoniaService],
})
export class ColoniaModule {}
