import { Module } from '@nestjs/common';
import { ImportacaoController } from './importacao.controller';
import { ImportacaoService } from './importacao.service';
import { RelatorioImportacaoService } from './relatorio.service';

@Module({
  controllers: [ImportacaoController],
  providers: [ImportacaoService, RelatorioImportacaoService],
})
export class ImportacaoModule {}
