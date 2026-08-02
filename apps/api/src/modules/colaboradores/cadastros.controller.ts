import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CadastrosService } from './cadastros.service';
import { AtualizarCargoDto, AtualizarDepartamentoDto, CargoDto, DepartamentoDto } from './dto/cadastros.dto';
import { Modulo } from '../../common/permissions/modulo.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * Listas de apoio de COLABORADORES: cargos e departamentos.
 *
 * Já foi um módulo à parte ("Cadastros Base"), com menu e permissão próprios.
 * Não se sustentava: as duas listas alimentam um único formulário, e quem edita
 * colaborador é exatamente quem precisa editá-las. Agora a autorização é
 * `@Modulo('colaboradores')` — VISUALIZAR lê, EDITAR escreve —, o que também
 * corrige uma incoerência antiga: o controller checava `@Roles`, então a linha
 * "Cadastros Base" da matriz de permissões não tinha efeito nenhum.
 *
 * EMPRESAS saiu daqui de vez. É a entidade do módulo Patronal (portal,
 * contribuições) e o CRUD simplificado apagava em cascata as contribuições da
 * empresa. O dono é `/empresas`.
 *
 * Prefixo mantido em /cadastros/* de propósito: pendurar em /colaboradores/*
 * colidiria com `@Get(':id')` do ColaboradoresController, e no Nest a primeira
 * rota que casa vence.
 */
@ApiTags('colaboradores-listas')
@ApiBearerAuth()
@Modulo('colaboradores')
@Controller('cadastros')
export class CadastrosController {
  constructor(private readonly service: CadastrosService) {}

  private ctx(req: Request, userId?: string) {
    return { userId, ip: req.ip, userAgent: req.headers['user-agent'] };
  }

  // ---- Departamentos ----
  @Get('departamentos')
  @ApiOperation({ summary: 'Departamentos ativos (use incluirInativos=true na tela de gestão).' })
  listarDepartamentos(@Query('incluirInativos') incluirInativos?: string) {
    return this.service.listarDepartamentos(incluirInativos === 'true');
  }

  @Post('departamentos')
  criarDepartamento(@Body() dto: DepartamentoDto, @CurrentUser('id') userId: string, @Req() req: Request) {
    return this.service.criarDepartamento(dto, this.ctx(req, userId));
  }

  @Patch('departamentos/:id')
  atualizarDepartamento(
    @Param('id') id: string,
    @Body() dto: AtualizarDepartamentoDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return this.service.atualizarDepartamento(id, dto, this.ctx(req, userId));
  }

  /** Exclusão — só Administrador (regra global). Recusada se estiver em uso. */
  @Delete('departamentos/:id')
  removerDepartamento(@Param('id') id: string, @CurrentUser('id') userId: string, @Req() req: Request) {
    return this.service.removerDepartamento(id, this.ctx(req, userId));
  }

  // ---- Cargos ----
  @Get('cargos')
  @ApiOperation({ summary: 'Cargos ativos (use incluirInativos=true na tela de gestão).' })
  listarCargos(@Query('incluirInativos') incluirInativos?: string) {
    return this.service.listarCargos(incluirInativos === 'true');
  }

  @Post('cargos')
  criarCargo(@Body() dto: CargoDto, @CurrentUser('id') userId: string, @Req() req: Request) {
    return this.service.criarCargo(dto, this.ctx(req, userId));
  }

  @Patch('cargos/:id')
  atualizarCargo(
    @Param('id') id: string,
    @Body() dto: AtualizarCargoDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return this.service.atualizarCargo(id, dto, this.ctx(req, userId));
  }

  /** Exclusão — só Administrador (regra global). Recusada se estiver em uso. */
  @Delete('cargos/:id')
  removerCargo(@Param('id') id: string, @CurrentUser('id') userId: string, @Req() req: Request) {
    return this.service.removerCargo(id, this.ctx(req, userId));
  }
}
