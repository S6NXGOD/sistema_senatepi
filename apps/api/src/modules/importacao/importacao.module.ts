import { Module } from '@nestjs/common';
import { ImportacaoController } from './importacao.controller';
import { ImportacaoService } from './importacao.service';
import { RelatorioImportacaoService } from './relatorio.service';
import { FolhaPrefeituraController } from './folha-prefeitura.controller';
import { FolhaPrefeituraService } from './folha-prefeitura.service';
import { ColaboradoresLegadoController } from './colaboradores-legado.controller';
import { ColaboradoresLegadoService } from './colaboradores-legado.service';

@Module({
  // Os controllers de PREFIXO ESPECÍFICO vêm PRIMEIRO: o Nest resolve rotas na
  // ordem de registro, e o `@Get(':id')` de ImportacaoController casaria com
  // "folha" e com "colaboradores". Mesmo motivo documentado em `FiliadosModule`.
  controllers: [
    FolhaPrefeituraController,
    ColaboradoresLegadoController,
    ImportacaoController,
  ],
  providers: [
    ImportacaoService,
    RelatorioImportacaoService,
    FolhaPrefeituraService,
    ColaboradoresLegadoService,
  ],
})
export class ImportacaoModule {}
