import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { PartesService } from './partes.service';
import { PartesExternasService } from './partes-externas.service';
import {
  AdicionarParteDto, AtualizarParteDto, AtualizarParteExternaDto, CriarParteExternaDto,
  DefinirAdvogadosDto, ListParteExternaQueryDto, MesclarOrganizacaoDto,
} from './dto/partes.dto';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { Modulo } from '../../common/permissions/modulo.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

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

  /**
   * Fica ANTES de `:id` de propósito: o Nest casa as rotas na ordem em que são
   * declaradas, e `@Get(':id')` engoliria "parecidas" como se fosse um id.
   */
  @Get('parecidas')
  @ApiOperation({ summary: 'Cadastros que podem ser a mesma parte — evita duplicar o réu.' })
  parecidas(@Query('nome') nome: string, @Query('documento') documento?: string) {
    return this.service.parecidas(nome ?? '', documento);
  }

  /**
   * Consulta o CNPJ na Receita E confere o nosso cadastro na mesma resposta.
   *
   * Antes de `@Get(':id')` pelo mesmo motivo de `parecidas`: a rota casa na
   * ordem em que é declarada, e `:id` engoliria "cnpj" como se fosse um id.
   */
  @Get('cnpj/:cnpj')
  @ApiOperation({ summary: 'Dados do CNPJ na Receita + organização já cadastrada e semelhantes.' })
  consultarCnpj(@Param('cnpj') cnpj: string) {
    return this.service.consultarCnpj(cnpj);
  }

  /** Pares de organizações que parecem ser a mesma — a fila de limpeza. */
  @Get('duplicadas')
  @ApiOperation({ summary: 'Varredura do cadastro em busca de organizações duplicadas.' })
  duplicadas() {
    return this.service.duplicadas();
  }

  /**
   * Marca o par como "não são a mesma organização" — some da fila de limpeza.
   *
   * NÃO exige ADMINISTRADOR, ao contrário de mesclar: descartar não apaga nada
   * e é reversível pelo banco. Exigir o perfil mais alto para dizer "isto aqui
   * está errado" faria a fila encher justamente de quem tem menos acesso.
   */
  @Post(':id/nao-duplicada')
  @ApiOperation({ summary: 'Descarta o par sugerido pela varredura de duplicatas.' })
  naoSaoDuplicadas(
    @Param('id') id: string,
    @Body() dto: MesclarOrganizacaoDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.service.naoSaoDuplicadas(id, dto.duplicadaId, ctxDe(req, user));
  }

  /**
   * Mescla `duplicadaId` DENTRO de `:id`, que é a que permanece.
   *
   * Só ADMINISTRADOR: apaga um cadastro e reponta processos, vínculos de
   * emprego e, quando existe, o dossiê patronal. É a operação mais destrutiva
   * do módulo, e não tem desfazer na tela — o retrato do que sumiu fica na
   * auditoria.
   */
  @Post(':id/mesclar')
  @Roles(UserRole.ADMINISTRADOR)
  @ApiOperation({ summary: 'Mescla a organização duplicada dentro desta.' })
  mesclar(
    @Param('id') id: string,
    @Body() dto: MesclarOrganizacaoDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.service.mesclar(id, dto.duplicadaId, ctxDe(req, user));
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
