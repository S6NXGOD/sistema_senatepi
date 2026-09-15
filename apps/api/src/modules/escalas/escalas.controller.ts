import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { EscalasService } from './escalas.service';
import {
  AtualizarEscalaDto, ConsultasDoPlantaoQueryDto, CopiaQueryDto, CopiarEscalaDto, CriarEscalasDto,
  ListEscalasQueryDto,
} from './dto/escalas.dto';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Modulo } from '../../common/permissions/modulo.decorator';
import { DadosProprios } from '../../common/permissions/dados-proprios.decorator';

@ApiTags('escalas')
@ApiBearerAuth()
@Modulo('escalas')
@Controller('escalas')
export class EscalasController {
  constructor(private readonly service: EscalasService) {}

  /*
    O USUÁRIO INTEIRO ENTRA NO CONTEXTO (14/09/2026), e não só o id.

    A troca passou a escrever na agenda: o nome de quem agiu fica congelado na
    linha do tempo da consulta, e "passar consultas" exige Agenda EDITAR pela
    matriz (`nivelEfetivo`), conferida no serviço. Perfil e matriz já vêm no
    token: nada de consulta a mais.
  */
  private leitor(user?: AuthUser) {
    return user ? { id: user.id, role: user.role, permissoes: user.permissoes } : undefined;
  }

  private ctx(req: Request, user?: AuthUser) {
    return {
      userId: user?.id,
      nome: user?.nome,
      leitor: this.leitor(user),
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    };
  }

  /** Usuários que podem ser escalados. */
  @Get('advogados')
  advogados() {
    return this.service.listarAdvogados();
  }

  /** Advogados de plantão numa data (?data=YYYY-MM-DD). */
  @Get('plantao')
  plantao(@Query('data') data?: string) {
    return this.service.listarPlantao(data);
  }

  /**
   * A PRÉVIA DA CÓPIA de um mês para outro (?origem=AAAA-MM&destino=AAAA-MM).
   *
   * VISUALIZAR, como todo GET da matriz; a tela só oferece com EDITAR. Literal
   * declarado antes de qualquer rota com parâmetro: hoje não há `GET :id`, mas
   * se um dia houver, `copia` viraria um id e sumiria sem erro.
   */
  @Get('copia')
  previaDaCopia(@Query() query: CopiaQueryDto) {
    return this.service.previaDaCopia(query);
  }

  /** O mês de Teresina e os meses com plantões — para o botão "Copiar" da página (15/09/2026). */
  @Get('meses')
  mesesDaCopia() {
    return this.service.mesesDaCopia();
  }

  /** Escalas do mês (?mes=YYYY-MM&advogadoId=). */
  @Get()
  listar(@Query() query: ListEscalasQueryDto) {
    return this.service.listar(query);
  }

  /**
   * As consultas marcadas com quem está no plantão (?entra=userId opcional).
   * Com `entra`, a prévia da troca; sem, o aviso de excluir e de encurtar.
   */
  @Get(':id/consultas')
  consultas(
    @Param('id') id: string,
    @Query() query: ConsultasDoPlantaoQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.consultasDoPlantao(id, query.entra, this.leitor(user), undefined, {
      horaInicio: query.horaInicio,
      horaFim: query.horaFim,
    });
  }

  /** Grava a cópia — só os itens marcados, recalculados numa transação (409 se a escala mudou). */
  @Post('copia')
  copiar(@Body() dto: CopiarEscalaDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.service.copiar(dto, this.ctx(req, user));
  }

  /** Cadastra uma ou mais escalas (datas/horários) para um advogado. */
  @Post()
  criar(@Body() dto: CriarEscalasDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.service.criar(dto, this.ctx(req, user));
  }

  /**
   * Corrige horário/observação ou troca a pessoa de um plantão — e, na troca,
   * passa as consultas escolhidas (`passarConsultas`).
   *
   * EDITAR pela matriz (`@Modulo('escalas')`), sem `@Roles`: a Coordenação tinha
   * EDITAR e nenhuma rota de edição — só criava, e o conserto dependia do
   * Administrador apagar e alguém recriar.
   */
  @Patch(':id')
  atualizar(
    @Param('id') id: string,
    @Body() dto: AtualizarEscalaDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.service.atualizar(id, dto, this.ctx(req, user));
  }

  /**
   * DESFAZ A CÓPIA RECÉM-FEITA (15/09/2026) — a única exclusão da escala que não
   * é só do Administrador.
   *
   * `@DadosProprios()` tira ESTA rota da trava global de DELETE do
   * `PermissionsGuard`, e só dela: o que se apaga é o gesto do próprio usuário
   * do token, e o serviço confere que foi ele quem copiou, há menos de dez
   * minutos, sem alteração nem consulta nova no meio. A matriz continua valendo
   * (`@Modulo('escalas')` exige EDITAR para DELETE). Declarada antes de
   * `DELETE :id` pela regra da casa, embora os dois segmentos não colidam.
   */
  @Delete('copia/:loteId')
  @DadosProprios()
  desfazerCopia(@Param('loteId') loteId: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.service.desfazerCopia(loteId, this.ctx(req, user));
  }

  /** Remove uma escala — só Administrador (regra global de exclusão). */
  @Delete(':id')
  remover(@Param('id') id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.service.remover(id, this.ctx(req, user));
  }
}
