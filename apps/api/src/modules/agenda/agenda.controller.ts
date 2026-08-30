import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AgendaService } from './agenda.service';
import { desfechosDoTipo, CATEGORIAS_CANCELAMENTO } from './desfechos.catalogo';
import {
  CancelarCompromissoDto,
  ConcluirCompromissoDto,
  CreateCompromissoDto,
  ListCompromissosQueryDto,
  MudarStatusDto,
  RemarcarCompromissoDto,
  UpdateCompromissoDto,
} from './dto/agenda.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Modulo } from '../../common/permissions/modulo.decorator';

@ApiTags('agenda')
@ApiBearerAuth()
@Modulo('agenda')
@Controller('compromissos')
export class AgendaController {
  constructor(private readonly service: AgendaService) {}

  private ctx(req: Request, userId?: string, nome?: string) {
    return { ip: req.ip, userAgent: req.headers['user-agent'], userId, nome };
  }

  @Get('responsaveis')
  responsaveis() {
    return this.service.listarResponsaveis();
  }

  /** Alertas: "Aguardando interação" (venceu há +3h) e "Próximas 24 horas". */
  @Get('alertas')
  alertas() {
    return this.service.alertas();
  }

  @Post()
  criar(@Body() dto: CreateCompromissoDto, @CurrentUser('id') userId: string, @CurrentUser('nome') nome: string, @Req() req: Request) {
    return this.service.criar(dto, this.ctx(req, userId, nome));
  }

  /**
   * Desfechos possíveis para um TIPO de atividade.
   * A tela monta as opções a partir daqui — é o que faz uma audiência oferecer
   * "houve acordo" e um prazo oferecer "prazo perdido".
   */
  @Get('desfechos/:tipo')
  desfechos(@Param('tipo') tipo: string) {
    return desfechosDoTipo(tipo);
  }

  /** Motivos possíveis de cancelamento (inclui "não compareceu"). */
  @Get('categorias-cancelamento')
  categoriasCancelamento() {
    // As categorias `apenasSistema` ficam fora do formulário: ninguém cancela
    // algo "porque foi substituída" — isso é consequência de outra ação. O
    // rótulo delas continua no catálogo, para a tela exibir cartões já
    // cancelados por essa via.
    return CATEGORIAS_CANCELAMENTO.filter((c) => !c.apenasSistema);
  }

  /**
   * O que já ocupa a agenda desta pessoa neste horário.
   *
   * ROTA PRÓPRIA, e não um campo da listagem: o formulário consulta a cada
   * mudança de data/hora/responsável, e trazer o cartão inteiro (equipe,
   * processo, partes, histórico) a cada tecla seria caro à toa.
   *
   * Vem ANTES de `@Get(':id')` no arquivo — senão o Nest casaria "conflitos"
   * como um id e devolveria 404.
   */
  @Get('conflitos')
  conflitos(
    @Query('responsavelId') responsavelId: string,
    @Query('inicio') inicio: string,
    @Query('fim') fim: string,
    @Query('ignorarId') ignorarId?: string,
  ) {
    if (!responsavelId || !inicio || !fim) return [];
    return this.service.conflitos({ responsavelId, inicio, fim, ignorarId });
  }

  @Get()
  listar(@Query() query: ListCompromissosQueryDto) {
    return this.service.listar(query);
  }

  @Get(':id')
  detalhe(@Param('id') id: string) {
    return this.service.detalhe(id);
  }

  /** Linha do tempo da atividade: quem mexeu, o que fez e quando. */
  @Get(':id/historico')
  historico(@Param('id') id: string) {
    return this.service.listarHistorico(id);
  }

  /**
   * Avanço "simples": iniciar, voltar a pendente, reabrir. Concluir e cancelar
   * têm rotas próprias porque exigem desfecho/motivo — esta aqui os recusa com
   * uma mensagem que aponta o caminho certo.
   */
  @Patch(':id/status')
  mudarStatus(@Param('id') id: string, @Body() dto: MudarStatusDto, @CurrentUser('id') userId: string, @CurrentUser('nome') nome: string, @Req() req: Request) {
    return this.service.mudarStatus(id, dto, this.ctx(req, userId, nome));
  }

  @Patch(':id/concluir')
  @ApiOperation({
    summary: 'Conclui a atividade registrando o desfecho (e, se for o caso, criando o processo).',
  })
  concluir(@Param('id') id: string, @Body() dto: ConcluirCompromissoDto, @CurrentUser('id') userId: string, @CurrentUser('nome') nome: string, @Req() req: Request) {
    return this.service.concluir(id, dto, this.ctx(req, userId, nome));
  }

  @Patch(':id/cancelar')
  @ApiOperation({ summary: 'Cancela a atividade — o motivo é obrigatório.' })
  cancelar(@Param('id') id: string, @Body() dto: CancelarCompromissoDto, @CurrentUser('id') userId: string, @CurrentUser('nome') nome: string, @Req() req: Request) {
    return this.service.cancelar(id, dto, this.ctx(req, userId, nome));
  }

  @Patch(':id/remarcar')
  @ApiOperation({ summary: 'Remarca só a data/hora, preservando a duração e travando a data original.' })
  remarcar(@Param('id') id: string, @Body() dto: RemarcarCompromissoDto, @CurrentUser('id') userId: string, @CurrentUser('nome') nome: string, @Req() req: Request) {
    return this.service.remarcar(id, dto, this.ctx(req, userId, nome));
  }

  @Patch(':id')
  atualizar(@Param('id') id: string, @Body() dto: UpdateCompromissoDto, @CurrentUser('id') userId: string, @CurrentUser('nome') nome: string, @Req() req: Request) {
    return this.service.atualizar(id, dto, this.ctx(req, userId, nome));
  }

  /** Exclui um compromisso — só Administrador (regra global de exclusão). */
  @Delete(':id')
  remover(@Param('id') id: string, @CurrentUser('id') userId: string, @CurrentUser('nome') nome: string, @Req() req: Request) {
    return this.service.remover(id, this.ctx(req, userId, nome));
  }
}
