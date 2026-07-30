import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { TiposEventoService } from './tipos-evento.service';
import { CriarTipoEventoDto, AtualizarTipoEventoDto } from './dto/tipos-evento.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Modulo } from '../../common/permissions/modulo.decorator';

/** Tipos de evento da Agenda (cadastráveis). Gateado pelo módulo "agenda". */
@ApiTags('tipos-evento')
@ApiBearerAuth()
@Modulo('agenda')
@Controller('tipos-evento')
export class TiposEventoController {
  constructor(private readonly service: TiposEventoService) {}

  private ctx(req: Request, userId?: string) {
    return { ip: req.ip, userAgent: req.headers['user-agent'], userId };
  }

  @Get()
  listar(@Query('incluirInativos') incluirInativos?: string) {
    return this.service.listar(incluirInativos === 'true');
  }

  @Post()
  criar(@Body() dto: CriarTipoEventoDto, @CurrentUser('id') userId: string, @Req() req: Request) {
    return this.service.criar(dto, this.ctx(req, userId));
  }

  @Patch(':id')
  atualizar(@Param('id') id: string, @Body() dto: AtualizarTipoEventoDto, @CurrentUser('id') userId: string, @Req() req: Request) {
    return this.service.atualizar(id, dto, this.ctx(req, userId));
  }

  /** Excluir — só Administrador (regra global). Bloqueia tipos do sistema/em uso. */
  @Delete(':id')
  remover(@Param('id') id: string, @CurrentUser('id') userId: string, @Req() req: Request) {
    return this.service.remover(id, this.ctx(req, userId));
  }
}
