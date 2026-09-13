import {
  BadRequestException, Body, Controller, Delete, Get, Param, Post, Req,
  UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { LinkRecadastramentoService } from './link-recadastramento.service';
import { RecadastroPublicoDto } from './dto/recadastro-publico.dto';
import { EnvioDoLinkDto } from './dto/envio-do-link.dto';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { Modulo } from '../../common/permissions/modulo.decorator';
import { ModuloTenant } from '../../common/tenant/modulo-tenant.decorator';

/** Geração e controle dos links — só a equipe autenticada. */
@ApiTags('recadastramento')
@ApiBearerAuth()
@ModuloTenant('filiados')
@Modulo('filiados')
@Controller('filiados/:id/link-recadastramento')
export class LinkRecadastramentoAdminController {
  constructor(private readonly service: LinkRecadastramentoService) {}

  private ctx(req: Request, user?: AuthUser) {
    return { userId: user?.id, nome: user?.nome, ip: req.ip, userAgent: req.headers['user-agent'] };
  }

  /** Gera um link de 24h para o filiado se recadastrar sozinho. */
  @Post()
  gerar(@Param('id') id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.service.gerar(id, this.ctx(req, user));
  }

  /**
   * Prepara o envio: reaproveita o link vivo (ou gera, se não houver) e registra
   * por qual meio a equipe vai mandar. Mandar link é editar filiado — POST exige
   * EDITAR pela matriz, sem perfil chumbado.
   */
  @Post('envio')
  envio(
    @Param('id') id: string,
    @Body() dto: EnvioDoLinkDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.service.prepararEnvio(id, dto.meio, this.ctx(req, user));
  }

  @Get()
  listar(@Param('id') id: string) {
    return this.service.listar(id);
  }
}

/** Revogação em rota própria (o id é do LINK, não do filiado). */
@ApiTags('recadastramento')
@ApiBearerAuth()
@ModuloTenant('filiados')
@Modulo('filiados')
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
   *
   * Desde 13/09/2026 os campos `cpf`, `dataNascimento` e `coren` vêm no mesmo
   * multipart e o serviço confere o desafio, contando o erro. O limite é o do
   * /validar: sem ele, a foto seria a porta para varrer o desafio.
   */
  @Post(':token/foto')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('foto', { limits: { fileSize: 8 * 1024 * 1024, files: 1 } }))
  foto(
    @Param('token') token: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { cpf?: string; dataNascimento?: string; coren?: string },
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('Arquivo "foto" é obrigatório.');
    return this.service.atualizarFoto(token, file.buffer, file.mimetype, body ?? {}, req.ip);
  }

  /**
   * Grava o recadastramento e queima o link (uso único).
   *
   * O corpo é a CLASSE `RecadastroPublicoDto`. Não troque por interseção
   * (`UpdateFiliadoDto & {...}`): o metatipo vira `Object`, o ValidationPipe
   * deixa de validar e o corpo inteiro chega ao serviço — ver o DTO.
   *
   * Mesmo limite do /validar (13/09/2026): o envio também confere o desafio.
   */
  @Post(':token/enviar')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  enviar(
    @Param('token') token: string,
    @Body() dto: RecadastroPublicoDto,
    @Req() req: Request,
  ) {
    return this.service.submeter(token, dto, req.ip);
  }
}
