import { Body, Controller, Delete, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { EmpresasService } from './empresas.service';
import { CreateEmpresaDto, ListEmpresasQueryDto } from './dto/empresa.dto';
import { Modulo } from '../../common/permissions/modulo.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * Módulo Patronal — cadastro interno das empresas conveniadas.
 *
 * A autorização é por módulo (`@Modulo('empresas')`): GET exige VISUALIZAR e
 * POST exige EDITAR, conforme a matriz de permissões do usuário.
 */
@ApiTags('empresas')
@ApiBearerAuth()
@Modulo('empresas')
@Controller('empresas')
export class EmpresasController {
  constructor(private readonly service: EmpresasService) {}

  /**
   * Consulta na BrasilAPI para preencher o formulário.
   *
   * Declarada ANTES de qualquer `@Get(':algo')`: no Nest a primeira rota que
   * casa vence, e um `@Get(':id')` acima capturaria '/empresas/cnpj/...'.
   */
  @Get('cnpj/:cnpj')
  @ApiOperation({ summary: 'Dados públicos de um CNPJ (Receita via BrasilAPI)' })
  consultarCnpj(@Param('cnpj') cnpj: string) {
    return this.service.consultarCnpj(cnpj);
  }

  @Get()
  findAll(@Query() query: ListEmpresasQueryDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(
    @Body() dto: CreateEmpresaDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.service.create(dto, {
      userId: user?.id,
      nome: user?.nome,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  /**
   * Exclusão permanente.
   * O verbo DELETE já é restrito ao Administrador pelo guard global — não há
   * `@Roles` aqui para não haver duas regras dizendo a mesma coisa.
   */
  @Delete(':id')
  @ApiOperation({ summary: 'Exclui a empresa, suas contribuições e documentos' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.service.remove(id, {
      userId: user?.id,
      nome: user?.nome,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
