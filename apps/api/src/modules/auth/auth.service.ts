import {
  Injectable,
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

interface RequestContext {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

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

    const accessToken = await this.jwt.signAsync(payload, {
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

  async login(dto: LoginDto, ctx: RequestContext) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || !user.ativo) {
      throw new UnauthorizedException('Credenciais inválidas');
    }
    const ok = await bcrypt.compare(dto.senha, user.senhaHash);
    if (!ok) throw new UnauthorizedException('Credenciais inválidas');

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
      user: { id: user.id, nome: user.nome, email: user.email, role: user.role },
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
      // TODO: enviar `token` por e-mail (serviço de e-mail a configurar).
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
