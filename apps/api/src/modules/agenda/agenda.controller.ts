import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AgendaService } from './agenda.service';
import { desfechosComSugestao, CATEGORIAS_CANCELAMENTO } from './desfechos.catalogo';
import {
  CancelarCompromissoDto,
  ConcluirCompromissoDto,
  CreateCompromissoDto,
  ListCompromissosQueryDto,
  MudarStatusDto,
  RemarcarCompromissoDto,
  UpdateCompromissoDto,
} from './dto/agenda.dto';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Modulo } from '../../common/permissions/modulo.decorator';

@ApiTags('agenda')
@ApiBearerAuth()
@Modulo('agenda')
@Controller('compromissos')
export class AgendaController {
  constructor(private readonly service: AgendaService) {}

  /*
    O USUÁRIO INTEIRO ENTRA NO CONTEXTO, e não só id e nome (13/09/2026).

    Toda escrita devolve o cartão da atividade, e o cartão trazia as partes do
    processo para quem tem `processos: SEM_ACESSO` — o corte existia na listagem
    e no detalhe, e não aqui. Perfil e matriz já vêm no token: nada de consulta.
  */
  private ctx(req: Request, user?: AuthUser) {
    return {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      userId: user?.id,
      nome: user?.nome,
      leitor: user ? { id: user.id, role: user.role, permissoes: user.permissoes } : undefined,
    };
  }

  @Get('responsaveis')
  responsaveis() {
    return this.service.listarResponsaveis();
  }

  /*
    `GET /compromissos/alertas` SAIU em 14/09/2026 (D20 da rodada 3), sem
    substituta. Nenhuma tela chamava desde 523cd0c, e ela mantinha viva uma
    terceira régua de "atrasada" (+3h) — a que o projeto passou setembro
    apagando. A régua que vale mora em `recortes.util.ts`.
  */

  @Post()
  criar(@Body() dto: CreateCompromissoDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.service.criar(dto, this.ctx(req, user));
  }

  /**
   * Desfechos possíveis para um TIPO de atividade.
   * A tela monta as opções a partir daqui — é o que faz uma audiência oferecer
   * "houve acordo" e um prazo oferecer "prazo perdido".
   */
  @Get('desfechos/:tipo')
  desfechos(@Param('tipo') tipo: string) {
    // Com `seguimento.sugeridoPara` já calculado: a prévia da tela não refaz a conta.
    return desfechosComSugestao(tipo);
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
    // Responsável e quem vai atuar junto, separados por vírgula.
    @Query('pessoas') pessoas?: string,
  ) {
    if ((!responsavelId && !pessoas) || !inicio || !fim) return [];
    return this.service.conflitos({ responsavelId, pessoas, inicio, fim, ignorarId });
  }

  /**
   * Quantas atividades cabem em cada aba, com os mesmos filtros da listagem.
   * Também antes de `@Get(':id')`, pelo mesmo motivo de `conflitos`.
   */
  @Get('recortes')
  recortes(@Query() query: ListCompromissosQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.contarRecortes(query, user);
  }

  @Get()
  listar(@Query() query: ListCompromissosQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.listar(query, user);
  }

  /** Quem não vê Processos recebe o detalhe sem o teor das publicações e sem as partes. */
  @Get(':id')
  detalhe(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.detalhe(id, user);
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
  mudarStatus(@Param('id') id: string, @Body() dto: MudarStatusDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.service.mudarStatus(id, dto, this.ctx(req, user));
  }

  @Patch(':id/concluir')
  @ApiOperation({
    summary: 'Conclui a atividade registrando o desfecho (e, se for o caso, criando o processo).',
  })
  concluir(@Param('id') id: string, @Body() dto: ConcluirCompromissoDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.service.concluir(id, dto, this.ctx(req, user));
  }

  /**
   * Desfaz a conclusão recém-registrada: só quem concluiu, até 2 minutos, e só
   * se ela não criou seguimento, processo ou vínculo. É o "Desfazer" do toast.
   */
  @Patch(':id/desfazer-conclusao')
  @ApiOperation({ summary: 'Desfaz a conclusão feita há pouco pela mesma pessoa.' })
  desfazerConclusao(@Param('id') id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.service.desfazerConclusao(id, this.ctx(req, user));
  }

  @Patch(':id/cancelar')
  @ApiOperation({ summary: 'Cancela a atividade — o motivo é obrigatório.' })
  cancelar(@Param('id') id: string, @Body() dto: CancelarCompromissoDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.service.cancelar(id, dto, this.ctx(req, user));
  }

  @Patch(':id/remarcar')
  @ApiOperation({ summary: 'Remarca só a data/hora, preservando a duração e travando a data original.' })
  remarcar(@Param('id') id: string, @Body() dto: RemarcarCompromissoDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.service.remarcar(id, dto, this.ctx(req, user));
  }

  @Patch(':id')
  atualizar(@Param('id') id: string, @Body() dto: UpdateCompromissoDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.service.atualizar(id, dto, this.ctx(req, user));
  }

  /** Exclui um compromisso — só Administrador (regra global de exclusão). */
  @Delete(':id')
  remover(@Param('id') id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.service.remover(id, this.ctx(req, user));
  }
}
