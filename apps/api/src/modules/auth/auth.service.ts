import { StorageService } from '@core/infra';
import {
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, randomUUID } from 'node:crypto';
import { AcaoAuditoria } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';

import { JwtPayload } from './strategies/jwt.strategy';
import { LoginDto, ResetPasswordDto } from './dto/auth.dto';
import { tenant } from '../../tenant/tenant.config';

interface RequestContext {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  /** URL da foto: a enviada (via chave no storage) tem prioridade sobre a URL manual. */
  private async resolverAvatar(avatarKey: string | null, avatarUrl: string | null): Promise<string | null> {
    if (avatarKey) return this.storage.getSignedUrl(avatarKey).catch(() => avatarUrl);
    return avatarUrl;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Interpreta durações no formato "30d" (dias). Fallback ao padrão informado. */
  private parseDuracaoDias(v: string | undefined, padrao: number): number {
    const m = /^(\d+)\s*d$/i.exec((v ?? '').trim());
    return m ? parseInt(m[1], 10) : padrao;
  }

  /**
   * Gera o par de tokens. Sessão longa (login persistente): refresh de 30 dias
   * por padrão (90 dias com "lembrar"). Devolve também `refreshExpiraEm` para que
   * o registro no banco fique SEMPRE consistente com a validade do JWT.
   */
  private async gerarTokens(payload: JwtPayload, lembrar = false) {
    const diasRefresh = lembrar
      ? 90
      : this.parseDuracaoDias(this.config.get('JWT_REFRESH_EXPIRES_IN'), 30);

    // Carimba o sindicato no token. Ver `JwtPayload.tenant` para o porquê.
    const accessToken = await this.jwt.signAsync({ ...payload, tenant: tenant.id }, {
      secret: this.config.get('JWT_ACCESS_SECRET'),
      expiresIn: this.config.get('JWT_ACCESS_EXPIRES_IN', '30d'),
    });
    const refreshToken = await this.jwt.signAsync(
      { sub: payload.sub, jti: randomUUID() },
      {
        secret: this.config.get('JWT_REFRESH_SECRET'),
        expiresIn: `${diasRefresh}d`,
      },
    );
    const refreshExpiraEm = new Date(Date.now() + diasRefresh * 24 * 60 * 60 * 1000);
    return { accessToken, refreshToken, refreshExpiraEm };
  }

  /**
   * REGISTRA A TENTATIVA RECUSADA.
   *
   * Antes, só o login BEM-SUCEDIDO ia para a auditoria — e uma trilha que só
   * guarda sucesso não serve para investigar invasão. Depois de um incidente,
   * a pergunta é sempre "tentaram entrar antes?", e a resposta era um silêncio
   * indistinguível de "ninguém tentou".
   *
   * NÃO CRIA VALOR DE ENUM NOVO de propósito: `AcaoAuditoria` é um enum do
   * Postgres, e acrescentar `LOGIN_FALHA` exigiria migration. Isto entra no ar
   * durante uma eleição — registro novo não vale um ALTER TYPE. Fica como
   * LOGIN com `sucesso: false` no metadata, que é filtrável do mesmo jeito.
   *
   * O E-MAIL TENTADO ENTRA, A SENHA NÃO. Registrar a senha errada é o clássico
   * jeito de vazar a senha CERTA — ela quase sempre aparece na tentativa
   * seguinte, com um caractere a mais.
   *
   * Falhar aqui nunca pode derrubar o login: a auditoria é melhor-esforço.
   */
  private async registrarLoginRecusado(email: string, motivo: string, ctx: RequestContext) {
    await this.audit
      .registrar({
        userId: null,
        acao: AcaoAuditoria.LOGIN,
        descricao: `Tentativa de login RECUSADA (${motivo}).`,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        metadata: { sucesso: false, motivo, emailTentado: email?.slice(0, 120) ?? null },
      })
      .catch(() => undefined);
  }

  async login(dto: LoginDto, ctx: RequestContext) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || !user.ativo) {
      // O motivo separa "conta não existe" de "conta desativada" NA TRILHA, sem
      // mudar a mensagem devolvida — quem está do lado de fora continua vendo
      // sempre a mesma coisa, que é o que impede enumerar usuário.
      await this.registrarLoginRecusado(dto.email, user ? 'conta inativa' : 'usuário inexistente', ctx);
      throw new UnauthorizedException('Credenciais inválidas');
    }
    const ok = await bcrypt.compare(dto.senha, user.senhaHash);
    if (!ok) {
      await this.registrarLoginRecusado(dto.email, 'senha incorreta', ctx);
      throw new UnauthorizedException('Credenciais inválidas');
    }

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      nome: user.nome,
    };
    const tokens = await this.gerarTokens(payload, dto.lembrar);

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(tokens.refreshToken),
        expiraEm: tokens.refreshExpiraEm, // consistente com a validade do JWT
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
    });

    await this.prisma.user.update({
      where: { id: user.id },
      data: { ultimoLoginEm: new Date() },
    });

    await this.audit.registrar({
      userId: user.id,
      acao: AcaoAuditoria.LOGIN,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      descricao: 'Login realizado',
    });

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: user.id,
        nome: user.nome,
        nomeExibicao: user.nomeExibicao,
        email: user.email,
        role: user.role,
        avatarUrl: await this.resolverAvatar(user.avatarKey, user.avatarUrl),
        permissoes: user.permissoes,
      },
    };
  }

  async refresh(refreshToken: string) {
    let decoded: { sub: string };
    try {
      decoded = await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.get('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Refresh token inválido');
    }

    const hash = this.hashToken(refreshToken);
    const armazenado = await this.prisma.refreshToken.findFirst({
      where: { userId: decoded.sub, tokenHash: hash, revogado: false },
    });
    if (!armazenado || armazenado.expiraEm < new Date()) {
      throw new UnauthorizedException('Sessão expirada');
    }

    const user = await this.prisma.user.findUnique({ where: { id: decoded.sub } });
    if (!user || !user.ativo) throw new UnauthorizedException('Usuário inativo');

    // Rotação: revoga o token usado e emite um novo par.
    await this.prisma.refreshToken.update({
      where: { id: armazenado.id },
      data: { revogado: true },
    });

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      nome: user.nome,
    };
    const tokens = await this.gerarTokens(payload);
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(tokens.refreshToken),
        expiraEm: tokens.refreshExpiraEm, // consistente com a validade do JWT
      },
    });

    return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
  }

  async logout(userId: string, ctx: RequestContext) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revogado: false },
      data: { revogado: true },
    });
    await this.audit.registrar({
      userId,
      acao: AcaoAuditoria.LOGOUT,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      descricao: 'Logout realizado',
    });
    return { ok: true };
  }

  /**
   * Inicia recuperação de senha. Por segurança, sempre responde sucesso
   * (não revela se o e-mail existe). Em produção, envie o token por e-mail.
   */
  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user) {
      const token = randomUUID();
      await this.prisma.passwordReset.create({
        data: {
          email,
          tokenHash: this.hashToken(token),
          expiraEm: new Date(Date.now() + 60 * 60 * 1000), // 1h
        },
      });
      // SEGURANÇA: esta rota é PÚBLICA. Devolver o token na resposta permitiria
      // que qualquer pessoa que saiba um e-mail (ex.: o admin padrão) redefinisse
      // a senha daquela conta — tomada de conta total. O token só é devolvido
      // fora de produção, para testes locais.
      //
      // Enquanto não houver serviço de e-mail, a recuperação em produção é feita
      // pelo Administrador em "Usuários e Perfis" (campo "Nova senha").
      // TODO: enviar `token` por e-mail e então voltar a expor o autoatendimento.
      const producao = this.config.get<string>('NODE_ENV') === 'production';
      if (producao) {
        this.logger.warn(
          `Redefinição de senha solicitada para ${email}, mas não há serviço de e-mail configurado — ` +
            'o token NÃO é exposto. Redefina a senha pelo painel (Usuários e Perfis).',
        );
        return { ok: true };
      }
      return { ok: true, devToken: token };
    }
    return { ok: true };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const hash = this.hashToken(dto.token);
    const reset = await this.prisma.passwordReset.findFirst({
      where: { tokenHash: hash, usado: false },
    });
    if (!reset || reset.expiraEm < new Date()) {
      throw new UnauthorizedException('Token inválido ou expirado');
    }
    const senhaHash = await bcrypt.hash(dto.novaSenha, 12);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { email: reset.email },
        data: { senhaHash },
      }),
      this.prisma.passwordReset.update({
        where: { id: reset.id },
        data: { usado: true },
      }),
      this.prisma.refreshToken.updateMany({
        where: { user: { email: reset.email } },
        data: { revogado: true },
      }),
    ]);
    return { ok: true };
  }
}
