import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AtendimentosService } from './atendimentos.service';
import {
  AtualizarAssuntoDto, AtualizarLinkConsultaDto, CancelarAtendimentoDto, ConcluirAtendimentoDto,
  CreateAtendimentoDto, EncaminhamentoOpcoesQueryDto, ListAtendimentosQueryDto,
  MudarModalidadeConsultaDto, MudarStatusAtendimentoDto, RegistrarDesfechoDto,
} from './dto/atendimentos.dto';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Modulo } from '../../common/permissions/modulo.decorator';

@ApiTags('atendimentos')
@ApiBearerAuth()
@Modulo('atendimentos')
@Controller('atendimentos')
export class AtendimentosController {
  constructor(private readonly service: AtendimentosService) {}

  private ctx(req: Request, userId?: string, nome?: string) {
    return { ip: req.ip, userAgent: req.headers['user-agent'], userId, nome };
  }

  @Post()
  criar(@Body() dto: CreateAtendimentoDto, @CurrentUser('id') userId: string, @Req() req: Request) {
    return this.service.criar(dto, this.ctx(req, userId));
  }

  @Get()
  listar(@Query() query: ListAtendimentosQueryDto, @CurrentUser('id') userId: string) {
    // O usuário do token é o "me" de `atendente=me` (o balcão do painel), nunca um id vindo da URL.
    return this.service.listar(query, userId);
  }

  /**
   * Plantão do dia da consulta e quem pode receber o encaminhamento.
   * Declarada ANTES de `:id`. Mora aqui, e não em /escalas, para que quem
   * registra o desfecho alcance o que o desfecho precisa — ver o serviço.
   */
  @Get('encaminhamento/opcoes')
  opcoesDoEncaminhamento(@Query() query: EncaminhamentoOpcoesQueryDto) {
    return this.service.opcoesDoEncaminhamento(query.data);
  }

  @Get(':id')
  detalhe(@Param('id') id: string) {
    return this.service.detalhe(id);
  }

  /** Classificar (ou reclassificar) o assunto depois da criação. */
  @Patch(':id/assunto')
  atualizarAssunto(@Param('id') id: string, @Body() dto: AtualizarAssuntoDto, @CurrentUser('id') userId: string, @Req() req: Request) {
    return this.service.atualizarAssunto(id, dto, this.ctx(req, userId));
  }

  /** Colar, trocar ou tirar o link da chamada de uma consulta nascida deste atendimento. */
  @Patch(':id/consultas/:compromissoId/link')
  atualizarLinkDaConsulta(
    @Param('id') id: string,
    @Param('compromissoId') compromissoId: string,
    @Body() dto: AtualizarLinkConsultaDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return this.service.atualizarLinkDaConsulta(id, compromissoId, dto, this.ctx(req, userId));
  }

  /**
   * "Mudar como vai ser" a consulta nascida deste atendimento: na sede, por
   * vídeo ou por telefone. O nome de quem mudou vai para a linha do tempo da
   * atividade, e por isso o controller passa o usuário inteiro.
   */
  @Patch(':id/consultas/:compromissoId/modalidade')
  mudarModalidadeDaConsulta(
    @Param('id') id: string,
    @Param('compromissoId') compromissoId: string,
    @Body() dto: MudarModalidadeConsultaDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.service.mudarModalidadeDaConsulta(id, compromissoId, dto, this.ctx(req, user?.id, user?.nome));
  }

  /** Registra o desfecho (resultado). Em ENCAMINHADO, agenda a consulta. */
  @Patch(':id/desfecho')
  registrarDesfecho(@Param('id') id: string, @Body() dto: RegistrarDesfechoDto, @CurrentUser('id') userId: string, @Req() req: Request) {
    return this.service.registrarDesfecho(id, dto, this.ctx(req, userId));
  }

  /** Concluir: o plano de fechamento decide o que é perguntado e o que é recusado. */
  @Patch(':id/concluir')
  concluir(@Param('id') id: string, @Body() dto: ConcluirAtendimentoDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.service.concluir(id, dto, this.ctx(req, user?.id, user?.nome));
  }

  /** Cancelar, com a categoria, e o que fazer com a consulta marcada. */
  @Patch(':id/cancelar')
  cancelar(@Param('id') id: string, @Body() dto: CancelarAtendimentoDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.service.cancelar(id, dto, this.ctx(req, user?.id, user?.nome));
  }

  /** Só o Reabrir (PENDENTE). Concluir e cancelar têm rota própria. */
  @Patch(':id/status')
  mudarStatus(@Param('id') id: string, @Body() dto: MudarStatusAtendimentoDto, @CurrentUser('id') userId: string, @Req() req: Request) {
    return this.service.mudarStatus(id, dto, this.ctx(req, userId));
  }

  /** Exclui o atendimento — só Administrador (regra global de exclusão). */
  @Delete(':id')
  remover(@Param('id') id: string, @CurrentUser('id') userId: string, @Req() req: Request) {
    return this.service.remover(id, this.ctx(req, userId));
  }
}
