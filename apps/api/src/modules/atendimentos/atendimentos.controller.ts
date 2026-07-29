import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AtendimentosService } from './atendimentos.service';
import {
  CreateAtendimentoDto,
  ListAtendimentosQueryDto,
} from './dto/atendimentos.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Modulo } from '../../common/permissions/modulo.decorator';

@ApiTags('atendimentos')
@ApiBearerAuth()
// Funil de entrada — governado pela matriz de permissões do módulo.
@Modulo('atendimentos')
@Controller('atendimentos')
export class AtendimentosController {
  constructor(private readonly service: AtendimentosService) {}

  private ctx(req: Request, userId?: string) {
    return { ip: req.ip, userAgent: req.headers['user-agent'], userId };
  }

  @Post()
  criar(
    @Body() dto: CreateAtendimentoDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
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
}
