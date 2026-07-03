import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { FiliadosService } from './filiados.service';
import { Roles } from '../../common/decorators/roles.decorator';

/**
 * Rotas administrativas de consulta ao cadastro legado de Filiados.
 * Prefixo global `api` → GET /api/admin/filiados/buscar
 */
@ApiTags('admin-filiados')
@ApiBearerAuth()
@Controller('admin/filiados')
export class AdminFiliadosController {
  constructor(private readonly service: FiliadosService) {}

  /** Autocomplete (Nome + CPF) para telas administrativas. */
  @Get('buscar')
  @Roles(UserRole.ADMIN, UserRole.DIRETORIA)
  buscar(@Query('q') q?: string) {
    return this.service.buscarParaAutocomplete(q ?? '');
  }
}
