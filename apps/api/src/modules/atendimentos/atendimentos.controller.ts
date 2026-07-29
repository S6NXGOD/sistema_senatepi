import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AtendimentosService } from './atendimentos.service';
import {
  CreateAtendimentoDto, ListAtendimentosQueryDto,
  MudarStatusAtendimentoDto, RegistrarDesfechoDto,
} from './dto/atendimentos.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Modulo } from '../../common/permissions/modulo.decorator';

@ApiTags('atendimentos')
@ApiBearerAuth()
@Modulo('atendimentos')
@Controller('atendimentos')
export class AtendimentosController {
  constructor(private readonly service: AtendimentosService) {}

  private ctx(req: Request, userId?: string) {
    return { ip: req.ip, userAgent: req.headers['user-agent'], userId };
  }

  @Post()
  criar(@Body() dto: CreateAtendimentoDto, @CurrentUser('id') userId: string, @Req() req: Request) {
    return this.service.criar(dto, this.ctx(req, userId));
  }

  @Get()
  listar(@Query() query: ListAtendimentosQueryDto) {
    return this.service.listar(query);
  }

  @Get(':id')
  detalhe(@Param('id') id: string) {
    return this.service.detalhe(id);
  }

  /** Registra o desfecho (resultado). Em ENCAMINHADO, agenda a(s) consulta(s). */
  @Patch(':id/desfecho')
  registrarDesfecho(@Param('id') id: string, @Body() dto: RegistrarDesfechoDto, @CurrentUser('id') userId: string, @Req() req: Request) {
    return this.service.registrarDesfecho(id, dto, this.ctx(req, userId));
  }

  /** Concluir / cancelar / reabrir a demanda. */
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
