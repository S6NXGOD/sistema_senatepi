import { Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Modulo } from '../../common/permissions/modulo.decorator';
import { ModuloTenant } from '../../common/tenant/modulo-tenant.decorator';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { PortalFiliadoAuthService } from './portal-filiado-auth.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * O LADO DA SECRETARIA: liberar, reemitir e revogar o acesso ao portal.
 *
 * ESTE CONTROLLER É DA EQUIPE, não do filiado — por isso entra pelos guards
 * globais, com `@Modulo('filiados')`. Quem pode editar um filiado pode liberar
 * o portal dele; é a mesma decisão, e a matriz de permissões continua sendo a
 * única política. NÃO há `@Roles` aqui de propósito: `@Roles` numa rota atropela
 * a matriz em silêncio, e é a dívida que a casa passou o mês inteiro pagando.
 */
@ApiTags('portal-filiado')
@ApiBearerAuth()
@ModuloTenant('filiados')
@Modulo('filiados')
@Controller('filiados/:id/portal')
export class PortalFiliadoAdminController {
  constructor(
    private readonly auth: PortalFiliadoAuthService,
    private readonly prisma: PrismaService,
  ) {}

  private ctx(req: Request) {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }

  /** Estado do acesso, para a ficha mostrar sem precisar adivinhar. */
  @Get()
  async estado(@Param('id') id: string) {
    const f = await this.prisma.filiado.findUnique({
      where: { id },
      select: {
        cpf: true,
        matricula: true,
        portalSenhaHash: true,
        portalPrimeiroAcesso: true,
        portalSenhaDefinidaEm: true,
        portalUltimoAcessoEm: true,
      },
    });
    if (!f) return null;
    return {
      liberado: !!f.portalSenhaHash,
      /** Liberado mas nunca trocou a senha: a provisória ainda está valendo. */
      aguardandoPrimeiroAcesso: !!f.portalSenhaHash && f.portalPrimeiroAcesso,
      senhaDefinidaEm: f.portalSenhaDefinidaEm,
      ultimoAcessoEm: f.portalUltimoAcessoEm,
      /*
        A ficha mostra POR ONDE a pessoa vai entrar. Medido: só 39% dos ativos
        têm CPF — sem este aviso a secretaria dita "entre com seu CPF" para
        alguém que não tem CPF no cadastro, e a ligação volta.
      */
      entraPor: f.cpf ? ['CPF', 'matrícula'] : ['matrícula'],
      matricula: f.matricula,
    };
  }

  /**
   * Gera (ou regera) a senha provisória e a DEVOLVE em claro — uma única vez.
   *
   * O banco guarda só o hash: ninguém, nem o Administrador, consegue ler a
   * senha de volta depois. Perdeu, chama esta rota outra vez. É de propósito, e
   * a tela precisa dizer isso na hora em que mostra a senha.
   */
  @Post('senha')
  @ApiOperation({ summary: 'Emite a senha provisória do portal (aparece uma vez só)' })
  emitirSenha(@Param('id') id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.auth.emitirSenhaProvisoria(id, { id: user.id, nome: user.nome }, this.ctx(req));
  }

  /**
   * Tira o acesso. O token morre na requisição seguinte, porque a estratégia
   * relê o hash a cada chamada em vez de confiar no que está assinado.
   */
  @Delete('senha')
  @ApiOperation({ summary: 'Revoga o acesso ao portal' })
  revogar(@Param('id') id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.auth.revogarAcesso(id, { id: user.id, nome: user.nome }, this.ctx(req));
  }
}
