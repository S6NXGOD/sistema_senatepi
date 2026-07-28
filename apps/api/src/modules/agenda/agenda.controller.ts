import {
  Body, Controller, Get, Param, Patch, Post, Query, Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { UserRole } from '@prisma/client';
import { AgendaService } from './agenda.service';
import {
  CreateCompromissoDto,
  ListCompromissosQueryDto,
  MudarStatusDto,
  UpdateCompromissoDto,
} from './dto/agenda.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('agenda')
@ApiBearerAuth()
@Roles(UserRole.ADMIN, UserRole.DIRETORIA, UserRole.FUNCIONARIO)
@Controller('compromissos')
export class AgendaController {
  constructor(private readonly service: AgendaService) {}

  private ctx(req: Request, userId?: string) {
    return { ip: req.ip, userAgent: req.headers['user-agent'], userId };
  }

  @Get('responsaveis')
  responsaveis() {
    return this.service.listarResponsaveis();
  }

  @Post()
  criar(@Body() dto: CreateCompromissoDto, @CurrentUser('id') userId: string, @Req() req: Request) {
    return this.service.criar(dto, this.ctx(req, userId));
  }

  @Get()
  listar(@Query() query: ListCompromissosQueryDto) {
    return this.service.listar(query);
  }

  @Get(':id')
  detalhe(@Param('id') id: string) {
    return this.service.detalhe(id);
  }

  @Patch(':id/status')
  mudarStatus(@Param('id') id: string, @Body() dto: MudarStatusDto, @CurrentUser('id') userId: string, @Req() req: Request) {
    return this.service.mudarStatus(id, dto, this.ctx(req, userId));
  }

  @Patch(':id')
  atualizar(@Param('id') id: string, @Body() dto: UpdateCompromissoDto, @CurrentUser('id') userId: string, @Req() req: Request) {
    return this.service.atualizar(id, dto, this.ctx(req, userId));
  }
}
