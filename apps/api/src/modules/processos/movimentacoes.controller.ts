import {
  Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { MovimentacoesService } from './movimentacoes.service';
import { ConsultaPreviaService } from './consulta-previa.service';
import { DatajudService } from './datajud.service';
import {
  CriarTipoAndamentoDto, AtualizarTipoAndamentoDto, RegistrarMovimentacaoDto,
  JaCuideiDoAndamentoDto,
} from './dto/movimentacoes.dto';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { Modulo } from '../../common/permissions/modulo.decorator';
import { RANK_NIVEL, nivelEfetivo } from '../../common/permissions/permissoes.constants';

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

  /*
    AS DUAS MÃOS SOBRE O ANDAMENTO DO TRIBUNAL (17/09/2026).

    Rotas em `processos/movimentacoes/:movId/...` para acompanhar a exclusão
    que já morava aqui — e nunca em `processos/:id/...`, que casaria com o
    `@Get(':id')` do ProcessosController. Nesta base duas rotas iguais não dão
    erro: uma some, e foi assim que a ficha do processo caiu uma vez.

    As duas ficam sob o `@Modulo('processos')` do controller e SEM `@Roles`: a
    matriz é a única política. Nenhuma é DELETE — "Já cuidei" muda o estado do
    aviso, não apaga o ato do tribunal.
  */

  /**
   * "Virar tarefa": cria a atividade na Agenda a partir do andamento.
   *
   * Grava na Agenda, então exige permissão de EDITAR também lá — o `@Modulo`
   * do controller só responde por "processos". Mesma checagem do radar de
   * audiências, e ela é o que evita oferecer um botão que a API recusaria
   * depois do clique.
   */
  @Post('movimentacoes/:movId/tarefa')
  @ApiOperation({ summary: 'Cria (ou devolve) a atividade da Agenda para este andamento.' })
  virarTarefa(@Param('movId') movId: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    if (RANK_NIVEL[nivelEfetivo(user.role, user.permissoes, 'agenda')] < RANK_NIVEL.EDITAR) {
      throw new ForbiddenException('Você não tem permissão para criar atividades na Agenda.');
    }
    return this.service.virarTarefa(movId, this.ctx(req, user));
  }

  /** "Já cuidei": dispensa HUMANA do aviso, com autor e motivo. Não apaga nada. */
  @Post('movimentacoes/:movId/ja-cuidei')
  @ApiOperation({ summary: 'Marca o andamento como já resolvido (o selo de atenção se apaga).' })
  jaCuidei(
    @Param('movId') movId: string,
    @Body() dto: JaCuideiDoAndamentoDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.service.jaCuidei(movId, dto.motivo, this.ctx(req, user));
  }

  /**
   * Desfaz o "Já cuidei" — o par que o radar de audiências sempre teve
   * (dispensar/restaurar). Sem ele, o toque errado no celular apagava o selo de
   * atenção sem volta em produto.
   */
  @Post('movimentacoes/:movId/desfazer-ja-cuidei')
  @ApiOperation({ summary: 'Desfaz a marcação "já cuidei" e devolve o selo de atenção ao andamento.' })
  desfazerJaCuidei(@Param('movId') movId: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.service.desfazerJaCuidei(movId, this.ctx(req, user));
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
  constructor(
    private readonly consulta: ConsultaPreviaService,
    private readonly datajud: DatajudService,
  ) {}

  /**
   * Estado do acompanhamento multi-instância.
   *
   * O front pergunta em runtime em vez de embutir a decisão no build: as
   * `NEXT_PUBLIC_*` do Next são resolvidas na compilação, e desligar a
   * funcionalidade exigiria rebuildar o serviço web. Mesma razão já registrada
   * em `duplicidade.controller.ts`.
   */
  @Get('status')
  status() {
    return { multiInstancia: this.datajud.multiInstanciaAtiva };
  }

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
