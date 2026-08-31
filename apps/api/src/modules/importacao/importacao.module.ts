import { Module } from '@nestjs/common';
import { ImportacaoController } from './importacao.controller';
import { ImportacaoService } from './importacao.service';
import { RelatorioImportacaoService } from './relatorio.service';
import { FolhaPrefeituraController } from './folha-prefeitura.controller';
import { FolhaPrefeituraService } from './folha-prefeitura.service';
import { ColaboradoresLegadoController } from './colaboradores-legado.controller';
import { ColaboradoresLegadoService } from './colaboradores-legado.service';
import { ProcessosCsvController } from './processos-csv.controller';
import { ProcessosCsvService } from './processos-csv.service';
import { ProcessosModule } from '../processos/processos.module';

@Module({
  /**
   * `ProcessosModule` entra porque a importação em lote NÃO escreve processo:
   * ela chama `ProcessosService.importar`, o mesmo caminho do botão de um
   * processo só. É isso que garante que os 82 registros nasçam com instâncias,
   * andamentos e auditoria — e não como cascas vazias.
   */
  imports: [ProcessosModule],
  // Os controllers de PREFIXO ESPECÍFICO vêm PRIMEIRO: o Nest resolve rotas na
  // ordem de registro, e o `@Get(':id')` de ImportacaoController casaria com
  // "folha" e com "colaboradores". Mesmo motivo documentado em `FiliadosModule`.
  controllers: [
    FolhaPrefeituraController,
    ColaboradoresLegadoController,
    ProcessosCsvController,
    ImportacaoController,
  ],
  providers: [
    ImportacaoService,
    RelatorioImportacaoService,
    FolhaPrefeituraService,
    ColaboradoresLegadoService,
    ProcessosCsvService,
  ],
})
export class ImportacaoModule {}
