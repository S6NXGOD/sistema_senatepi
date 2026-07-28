import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { UserRole } from '@prisma/client';
import { ProcessosService } from './processos.service';
import {
  AtualizarProcessoDto,
  ListProcessosQueryDto,
  SincronizarProcessoDto,
} from './dto/processos.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('processos')
@ApiBearerAuth()
@Roles(UserRole.ADMIN, UserRole.DIRETORIA, UserRole.FUNCIONARIO)
@Controller('processos')
export class ProcessosController {
  constructor(private readonly service: ProcessosService) {}

  private ctx(req: Request, userId?: string) {
    return { ip: req.ip, userAgent: req.headers['user-agent'], userId };
  }

  /** Consulta o DATAJUD e espelha (cache) o processo no banco local. */
  @Post('sincronizar')
  sincronizar(@Body() dto: SincronizarProcessoDto, @CurrentUser('id') userId: string, @Req() req: Request) {
    return this.service.sincronizar(dto, this.ctx(req, userId));
  }

  @Get()
  listar(@Query() query: ListProcessosQueryDto) {
    return this.service.listar(query);
  }

  @Get(':id')
  detalhe(@Param('id') id: string) {
    return this.service.detalhe(id);
  }

  @Patch(':id')
  atualizar(@Param('id') id: string, @Body() dto: AtualizarProcessoDto, @CurrentUser('id') userId: string, @Req() req: Request) {
    return this.service.atualizar(id, dto, this.ctx(req, userId));
  }
}
