import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { MovimentacoesService } from './movimentacoes.service';
import { ConsultaPreviaService } from './consulta-previa.service';
import {
  CriarTipoAndamentoDto, AtualizarTipoAndamentoDto, RegistrarMovimentacaoDto,
} from './dto/movimentacoes.dto';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { Modulo } from '../../common/permissions/modulo.decorator';

/**
 * Tipos de movimentação (cadastráveis) — gateado pelo módulo "processos".
 * Em controller próprio para manter o CRUD isolado do fluxo do DataJud.
 */
@ApiTags('processos')
@ApiBearerAuth()
@Modulo('processos')
@Controller('tipos-movimentacao')
export class TiposMovimentacaoController {
  constructor(private readonly service: MovimentacoesService) {}

  private ctx(req: Request, user?: AuthUser) {
    return { ip: req.ip, userAgent: req.headers['user-agent'], userId: user?.id, role: user?.role };
  }

  @Get()
  listar(@Query('incluirInativos') incluirInativos?: string) {
    return this.service.listarTipos(incluirInativos === 'true');
  }

  @Post()
  criar(@Body() dto: CriarTipoAndamentoDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.service.criarTipo(dto, this.ctx(req, user));
  }

  @Patch(':id')
  atualizar(
    @Param('id') id: string,
    @Body() dto: AtualizarTipoAndamentoDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.service.atualizarTipo(id, dto, this.ctx(req, user));
  }

  /** Excluir — só Administrador (regra global). Bloqueia tipo do sistema/em uso. */
  @Delete(':id')
  remover(@Param('id') id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.service.removerTipo(id, this.ctx(req, user));
  }
}

/** Movimentações internas (andamentos) e o dossiê consolidado do processo. */
@ApiTags('processos')
@ApiBearerAuth()
@Modulo('processos')
@Controller('processos')
export class MovimentacoesController {
  constructor(private readonly service: MovimentacoesService) {}

  private ctx(req: Request, user?: AuthUser) {
    return { ip: req.ip, userAgent: req.headers['user-agent'], userId: user?.id, role: user?.role };
  }

  /** Tudo que a tela de detalhe precisa numa chamada só. */
  @Get(':id/dossie')
  dossie(@Param('id') id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.service.dossie(id, this.ctx(req, user));
  }

  /** Registra um andamento (opcionalmente mudando o status do processo). */
  @Post(':id/movimentacoes')
  registrar(
    @Param('id') id: string,
    @Body() dto: RegistrarMovimentacaoDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.service.registrar(id, dto, this.ctx(req, user));
  }

  /** Exclui um andamento — só Administrador (regra global). */
  @Delete('movimentacoes/:movId')
  remover(@Param('movId') movId: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.service.remover(movId, this.ctx(req, user));
  }
}

/**
 * Consulta ao DataJud sem persistir — alimenta o auto-preenchimento do modal
 * "Novo Processo".
 *
 * Em rota PRÓPRIA (`/datajud/consultar`) de propósito: sob `/processos/...` ela
 * seria capturada pelo `@Get(':id')` do ProcessosController (que trataria
 * "consultar" como um id e devolveria 404).
 */
@ApiTags('processos')
@ApiBearerAuth()
@Modulo('processos')
@Controller('datajud')
export class DatajudConsultaController {
  constructor(private readonly consulta: ConsultaPreviaService) {}

  @Get('consultar')
  consultarPrevia(@Query('numeroCNJ') numeroCNJ: string, @Query('tribunal') tribunal?: string) {
    return this.consulta.consultar(numeroCNJ, tribunal);
  }

  /** Últimas sincronizações (diagnóstico do robô noturno). */
  @Get('logs')
  logs(@Query('limite') limite?: string) {
    return this.consulta.listarLogs(Number(limite) || 50);
  }

  /**
   * Sugestão de advogado responsável a partir do HISTÓRICO local do filiado.
   * 100% local — não toca no CNJ. É o que o modal chama quando o operador
   * seleciona um filiado manualmente. A sugestão é sempre facultativa.
   */
  @Get('sugerir-advogado')
  sugerirAdvogado(@Query('filiadoId') filiadoId?: string) {
    return this.consulta.sugerirAdvogado({ filiadoId: filiadoId || undefined });
  }

  /**
   * Re-indexa a linha do tempo dos processos já cadastrados com o parser atual.
   * Operação pesada (fala com o CNJ) — por isso é POST e tem limite.
   */
  @Post('reindexar')
  reindexar(@Query('limite') limite?: string) {
    return this.consulta.reindexar(Number(limite) || 50);
  }
}
