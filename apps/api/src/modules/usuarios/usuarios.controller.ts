import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { UserRole } from '@prisma/client';
import { UsuariosService } from './usuarios.service';
import { CriarUsuarioDto, AtualizarUsuarioDto } from './dto/usuarios.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Modulo } from '../../common/permissions/modulo.decorator';

/** Gestão de usuários do sistema e seus perfis/permissões — restrito ao Administrador. */
@ApiTags('usuarios')
@ApiBearerAuth()
@Roles(UserRole.ADMINISTRADOR)
@Modulo('usuarios')
@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly service: UsuariosService) {}

  private ctx(req: Request, userId?: string) {
    return { userId, ip: req.ip, userAgent: req.headers['user-agent'] };
  }

  @Get()
  listar(@Query('busca') busca?: string) {
    return this.service.listar(busca);
  }

  @Get(':id')
  detalhe(@Param('id') id: string) {
    return this.service.detalhe(id);
  }

  @Post()
  criar(@Body() dto: CriarUsuarioDto, @CurrentUser('id') userId: string, @Req() req: Request) {
    return this.service.criar(dto, this.ctx(req, userId));
  }

  @Patch(':id')
  atualizar(@Param('id') id: string, @Body() dto: AtualizarUsuarioDto, @CurrentUser('id') userId: string, @Req() req: Request) {
    return this.service.atualizar(id, dto, this.ctx(req, userId));
  }

  @Delete(':id')
  excluir(@Param('id') id: string, @CurrentUser('id') userId: string, @Req() req: Request) {
    return this.service.excluir(id, this.ctx(req, userId));
  }
}
