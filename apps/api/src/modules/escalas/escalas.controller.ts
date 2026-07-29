import { Body, Controller, Delete, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { EscalasService } from './escalas.service';
import { CriarEscalasDto, ListEscalasQueryDto } from './dto/escalas.dto';
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

  /** Remove uma escala — só Administrador (regra global de exclusão). */
  @Delete(':id')
  remover(@Param('id') id: string, @CurrentUser('id') userId: string, @Req() req: Request) {
    return this.service.remover(id, this.ctx(req, userId));
  }
}
