import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FiliadosService } from './filiados.service';
import { ModuloTenant } from '../../common/tenant/modulo-tenant.decorator';
import { Modulo } from '../../common/permissions/modulo.decorator';

/**
 * Rotas administrativas de consulta ao cadastro legado de Filiados.
 * Prefixo global `api` → GET /api/admin/filiados/buscar
 */
@ApiTags('admin-filiados')
@ApiBearerAuth()
@ModuloTenant('filiados')
@Modulo('filiados')
@Controller('admin/filiados')
export class AdminFiliadosController {
  constructor(private readonly service: FiliadosService) {}

  /**
   * Autocomplete (Nome + CPF) para telas administrativas.
   *
   * SEM `@Roles`, DE PROPÓSITO — quem manda é a matriz (`@Modulo('filiados')`
   * + GET ⇒ VISUALIZAR).
   *
   * O BURACO QUE ISTO FECHA. A lista era `ADMINISTRADOR, COORDENACAO`, e o
   * ADVOGADO tem `filiados: VISUALIZAR` no preset. Resultado: ao importar um
   * processo, a busca de filiado do polo ativo respondia 403 para o advogado —
   * e a tela, que trata erro como lista vazia, dizia "Nenhum filiado
   * encontrado". A saída que sobrava era "a parte não é o sindicato nem um
   * filiado", e o processo nascia sem dono.
   *
   * É provavelmente a origem dos 26 processos individuais da produção cujo polo
   * ativo é uma pessoa sem cadastro, 14 deles com a pessoa cadastrada o tempo
   * todo. Procurar no cadastro para VINCULAR uma parte é leitura, e leitura de
   * filiado o advogado sempre teve.
   */
  @Get('buscar')
  buscar(@Query('q') q?: string) {
    return this.service.buscarParaAutocomplete(q ?? '');
  }
}
