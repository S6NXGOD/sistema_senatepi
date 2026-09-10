import {
  BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Req,
  UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { UsuariosService } from './usuarios.service';
import { CriarUsuarioDto, AtualizarUsuarioDto } from './dto/usuarios.dto';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { Modulo } from '../../common/permissions/modulo.decorator';

/**
 * Gestão de usuários do sistema e seus perfis/permissões.
 *
 * O CONTROLLER ERA `@Roles(ADMINISTRADOR)`, e esse era o bug relatado: o
 * administrador marcava `usuarios: EDITAR` para a coordenação, ela tomava
 * "Forbidden resource", e não havia como descobrir por quê — a matriz de
 * permissões nem chegava a ser consultada. Quem manda agora é
 * `@Modulo('usuarios')`, como em todo o resto do sistema.
 *
 * O teto está em `quem-pode-mexer-em-quem.ts`: só Administrador cria ou promove
 * Administrador, ninguém abaixo mexe numa conta de Administrador, e ninguém
 * concede um nível que não tem.
 */
@ApiTags('usuarios')
@ApiBearerAuth()
@Modulo('usuarios')
@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly service: UsuariosService) {}

  /**
   * O PERFIL DE QUEM AGE VAI JUNTO — e antes não ia, porque não precisava: todo
   * mundo que chegava aqui era administrador. Sai do token (`@CurrentUser`),
   * nunca do corpo da requisição.
   */
  private ctx(req: Request, autor?: AuthUser) {
    return {
      userId: autor?.id,
      role: autor?.role,
      permissoes: autor?.permissoes,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    };
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
  criar(@Body() dto: CriarUsuarioDto, @CurrentUser() autor: AuthUser, @Req() req: Request) {
    return this.service.criar(dto, this.ctx(req, autor));
  }

  @Patch(':id')
  atualizar(@Param('id') id: string, @Body() dto: AtualizarUsuarioDto, @CurrentUser() autor: AuthUser, @Req() req: Request) {
    return this.service.atualizar(id, dto, this.ctx(req, autor));
  }

  @Delete(':id')
  excluir(@Param('id') id: string, @CurrentUser() autor: AuthUser, @Req() req: Request) {
    return this.service.excluir(id, this.ctx(req, autor));
  }

  /** Envia/substitui a foto de perfil de um usuário (multipart, campo "avatar"). */
  @Post(':id/avatar')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('avatar'))
  avatar(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() autor: AuthUser,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('Arquivo "avatar" é obrigatório.');
    if (!file.mimetype.startsWith('image/')) throw new BadRequestException('Envie um arquivo de imagem.');
    return this.service.atualizarAvatar(id, file.buffer, this.ctx(req, autor));
  }

  /** Remove a foto de perfil de um usuário. */
  @Delete(':id/avatar')
  removerAvatar(@Param('id') id: string, @CurrentUser() autor: AuthUser, @Req() req: Request) {
    return this.service.removerAvatar(id, this.ctx(req, autor));
  }
}
