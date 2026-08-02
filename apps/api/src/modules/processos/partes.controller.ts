import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { PartesService } from './partes.service';
import { PartesExternasService } from './partes-externas.service';
import {
  AdicionarParteDto, AtualizarParteDto, AtualizarParteExternaDto, CriarParteExternaDto,
  DefinirAdvogadosDto, ListParteExternaQueryDto,
} from './dto/partes.dto';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { Modulo } from '../../common/permissions/modulo.decorator';

function ctxDe(req: Request, user?: AuthUser) {
  return { ip: req.ip, userAgent: req.headers['user-agent'], userId: user?.id, role: user?.role };
}

/**
 * Partes do processo (polo ativo × passivo × terceiros) e advogados da casa.
 *
 * Rotas aninhadas em /processos para herdar a leitura mental do módulo. As de
 * item usam /processos/partes/:parteId (sem o id do processo) porque o id da
 * parte já é único — evita a rota mentirosa em que o processo do path e o dono
 * real da parte podem divergir.
 */
@ApiTags('processos')
@ApiBearerAuth()
@Modulo('processos')
@Controller('processos')
export class PartesController {
  constructor(private readonly service: PartesService) {}

  @Get(':id/partes')
  @ApiOperation({ summary: 'Partes do processo agrupadas por polo, com o confronto "Autor × Réu".' })
  listar(@Param('id') processoId: string) {
    return this.service.listar(processoId);
  }

  @Post(':id/partes')
  @ApiOperation({ summary: 'Adiciona uma parte (filiado, parte cadastrada ou nome livre).' })
  adicionar(
    @Param('id') processoId: string,
    @Body() dto: AdicionarParteDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.service.adicionar(processoId, dto, ctxDe(req, user));
  }

  @Patch('partes/:parteId')
  atualizar(
    @Param('parteId') parteId: string,
    @Body() dto: AtualizarParteDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.service.atualizar(parteId, dto, ctxDe(req, user));
  }

  @Delete('partes/:parteId')
  @ApiOperation({ summary: 'Remove a parte do processo (só Administrador, regra global).' })
  remover(@Param('parteId') parteId: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.service.remover(parteId, ctxDe(req, user));
  }

  @Get(':id/advogados')
  listarAdvogados(@Param('id') processoId: string) {
    return this.service.listarAdvogados(processoId);
  }

  @Patch(':id/advogados')
  @ApiOperation({ summary: 'Define a lista completa de advogados do processo e quem é o responsável.' })
  definirAdvogados(
    @Param('id') processoId: string,
    @Body() dto: DefinirAdvogadosDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.service.definirAdvogados(processoId, dto, ctxDe(req, user));
  }
}

/**
 * Cadastro de partes externas — a empresa ré, o município, a pessoa física.
 * Vive sob o módulo `processos`: quem enxerga processos enxerga o cadastro.
 */
@ApiTags('processos')
@ApiBearerAuth()
@Modulo('processos')
@Controller('partes-externas')
export class PartesExternasController {
  constructor(private readonly service: PartesExternasService) {}

  @Get()
  @ApiOperation({ summary: 'Lista/busca o cadastro de partes (autocomplete do seletor).' })
  listar(@Query() query: ListParteExternaQueryDto) {
    return this.service.listar(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Dossiê da parte: cadastro + todos os processos em que figura.' })
  detalhe(@Param('id') id: string) {
    return this.service.detalhe(id);
  }

  @Post()
  criar(@Body() dto: CriarParteExternaDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.service.criar(dto, ctxDe(req, user));
  }

  @Patch(':id')
  atualizar(
    @Param('id') id: string,
    @Body() dto: AtualizarParteExternaDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.service.atualizar(id, dto, ctxDe(req, user));
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Exclui o cadastro (bloqueado se a parte já figura em processos).' })
  remover(@Param('id') id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.service.remover(id, ctxDe(req, user));
  }
}
