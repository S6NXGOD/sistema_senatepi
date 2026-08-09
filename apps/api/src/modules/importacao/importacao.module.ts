import { Module } from '@nestjs/common';
import { ImportacaoController } from './importacao.controller';
import { ImportacaoService } from './importacao.service';
import { RelatorioImportacaoService } from './relatorio.service';
import { FolhaPrefeituraController } from './folha-prefeitura.controller';
import { FolhaPrefeituraService } from './folha-prefeitura.service';

@Module({
  // FolhaPrefeituraController vem PRIMEIRO: o Nest resolve rotas na ordem de
  // registro, e o `@Get(':id')` de ImportacaoController casaria com "folha".
  // Mesmo motivo documentado em `FiliadosModule`.
  controllers: [FolhaPrefeituraController, ImportacaoController],
  providers: [ImportacaoService, RelatorioImportacaoService, FolhaPrefeituraService],
})
export class ImportacaoModule {}
