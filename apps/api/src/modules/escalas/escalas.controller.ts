import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { EscalasService } from './escalas.service';
import { AtualizarEscalaDto, CriarEscalasDto, ListEscalasQueryDto } from './dto/escalas.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Modulo } from '../../common/permissions/modulo.decorator';

@ApiTags('escalas')
@ApiBearerAuth()
@Modulo('escalas')
@Controller('escalas')
export class EscalasController {
  constructor(private readonly service: EscalasService) {}

  private ctx(req: Request, userId?: string) {
    return { userId, ip: req.ip, userAgent: req.headers['user-agent'] };
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

  /** Escalas do mês (?mes=YYYY-MM&advogadoId=). */
  @Get()
  listar(@Query() query: ListEscalasQueryDto) {
    return this.service.listar(query);
  }

  /** Cadastra uma ou mais escalas (datas/horários) para um advogado. */
  @Post()
  criar(@Body() dto: CriarEscalasDto, @CurrentUser('id') userId: string, @Req() req: Request) {
    return this.service.criar(dto, this.ctx(req, userId));
  }

  /**
   * Corrige horário/observação ou troca a pessoa de um plantão.
   *
   * EDITAR pela matriz (`@Modulo('escalas')`), sem `@Roles`: a Coordenação tinha
   * EDITAR e nenhuma rota de edição — só criava, e o conserto dependia do
   * Administrador apagar e alguém recriar.
   */
  @Patch(':id')
  atualizar(
    @Param('id') id: string,
    @Body() dto: AtualizarEscalaDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return this.service.atualizar(id, dto, this.ctx(req, userId));
  }

  /** Remove uma escala — só Administrador (regra global de exclusão). */
  @Delete(':id')
  remover(@Param('id') id: string, @CurrentUser('id') userId: string, @Req() req: Request) {
    return this.service.remover(id, this.ctx(req, userId));
  }
}
