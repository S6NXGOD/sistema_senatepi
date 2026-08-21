import {
  BadRequestException, Body, Controller, Delete, Get, Param, Post, Req,
  UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { UserRole } from '@prisma/client';
import { LinkRecadastramentoService } from './link-recadastramento.service';
import { UpdateFiliadoDto } from '../filiados/dto/filiado.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

/** Geração e controle dos links — só a equipe autenticada. */
@ApiTags('recadastramento')
@ApiBearerAuth()
@Controller('filiados/:id/link-recadastramento')
export class LinkRecadastramentoAdminController {
  constructor(private readonly service: LinkRecadastramentoService) {}

  private ctx(req: Request, user?: AuthUser) {
    return { userId: user?.id, nome: user?.nome, ip: req.ip, userAgent: req.headers['user-agent'] };
  }

  /** Gera um link de 24h para o filiado se recadastrar sozinho. */
  @Post()
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO, UserRole.TRIAGEM)
  gerar(@Param('id') id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.service.gerar(id, this.ctx(req, user));
  }

  @Get()
  listar(@Param('id') id: string) {
    return this.service.listar(id);
  }
}

/** Revogação em rota própria (o id é do LINK, não do filiado). */
@ApiTags('recadastramento')
@ApiBearerAuth()
@Controller('links-recadastramento')
export class LinkRecadastramentoRevogarController {
  constructor(private readonly service: LinkRecadastramentoService) {}

  /** Cancelar é a única exclusão aqui — segue a regra global (só Admin). */
  @Delete(':linkId')
  revogar(@Param('linkId') linkId: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.service.revogar(linkId, { userId: user?.id, ip: req.ip });
  }
}

/**
 * ÁREA PÚBLICA — o filiado acessa SEM login, só com o token do link.
 *
 * Segurança: o token é a credencial. As rotas não recebem id de filiado; tudo
 * é resolvido a partir do token, então não há como pedir os dados de outra
 * pessoa. O desafio (CPF+nascimento ou COREN) é conferido de novo no envio.
 */
@ApiTags('recadastramento-publico')
@Public()
@Controller('recadastro')
export class RecadastroPublicoController {
  constructor(private readonly service: LinkRecadastramentoService) {}

  /** Estado do link + qual desafio será pedido. */
  @Get(':token')
  abrir(@Param('token') token: string, @Req() req: Request) {
    return this.service.abrir(token, req.ip);
  }

  /**
   * Confere a identidade e devolve o cadastro para edição.
   *
   * LIMITE PRÓPRIO: o desafio (CPF+nascimento ou COREN) é o SEGUNDO fator do
   * link — é ele que protege quem encaminhou o e-mail para a pessoa errada, ou
   * teve o link lido por cima do ombro. Sem limite, esse fator cai por força
   * bruta: data de nascimento tem ~36 mil combinações úteis, e a 120/min isso
   * sai em cinco horas. A 10/min, não sai.
   */
  @Post(':token/validar')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  validar(
    @Param('token') token: string,
    @Body() body: { cpf?: string; dataNascimento?: string; coren?: string },
  ) {
    return this.service.validarDesafio(token, body ?? {});
  }

  /**
   * Foto do filiado. Vai ANTES do envio: depois o link já está queimado.
   * O limite do multer é a primeira barreira; o serviço confere tipo e tamanho.
   */
  @Post(':token/foto')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('foto', { limits: { fileSize: 8 * 1024 * 1024, files: 1 } }))
  foto(@Param('token') token: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Arquivo "foto" é obrigatório.');
    return this.service.atualizarFoto(token, file.buffer, file.mimetype);
  }

  /** Grava o recadastramento e queima o link (uso único). */
  @Post(':token/enviar')
  enviar(
    @Param('token') token: string,
    @Body() dto: UpdateFiliadoDto & {
      cpfConfirmacao?: string;
      dataNascimentoConfirmacao?: string;
      corenConfirmacao?: string;
    },
    @Req() req: Request,
  ) {
    return this.service.submeter(token, dto, req.ip);
  }
}
