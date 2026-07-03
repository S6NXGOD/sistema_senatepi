import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AcaoAuditoria, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { ChangePasswordDto, UpdateProfileDto } from './dto/profile.dto';

interface Ctx {
  ip?: string;
  userAgent?: string;
}

// Campos públicos do perfil (NUNCA expõe o hash da senha).
const PERFIL_SELECT = {
  id: true,
  nome: true,
  email: true,
  username: true,
  avatarUrl: true,
  role: true,
  ativo: true,
  ultimoLoginEm: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Dados do usuário logado (sem a senha). */
  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: PERFIL_SELECT,
    });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    return user;
  }

  /**
   * Atualiza nome, e-mail, username e avatarUrl do próprio usuário.
   * E-mail/username duplicados em OUTRO registro → 409 (Conflict).
   * Tratamento mínimo e transparente dos dados pessoais (LGPD - Lei 13.709/2018).
   */
  async update(userId: string, dto: UpdateProfileDto, ctx: Ctx) {
    const email = dto.email?.trim().toLowerCase();
    const username = dto.username?.trim();

    if (email) {
      const jaExiste = await this.prisma.user.findFirst({
        where: { email, id: { not: userId } },
        select: { id: true },
      });
      if (jaExiste) throw new ConflictException('Este e-mail já está em uso por outro usuário.');
    }
    if (username) {
      const jaExiste = await this.prisma.user.findFirst({
        where: { username, id: { not: userId } },
        select: { id: true },
      });
      if (jaExiste) throw new ConflictException('Este nome de usuário já está em uso.');
    }

    const data: Prisma.UserUpdateInput = {
      nome: dto.nome?.trim(),
      email,
      // string vazia limpa o campo (username/avatar são opcionais)
      username: dto.username !== undefined ? username || null : undefined,
      avatarUrl: dto.avatarUrl !== undefined ? dto.avatarUrl.trim() || null : undefined,
    };

    try {
      const user = await this.prisma.user.update({
        where: { id: userId },
        data,
        select: PERFIL_SELECT,
      });
      await this.audit.registrar({
        userId,
        acao: AcaoAuditoria.UPDATE,
        entidade: 'User',
        entidadeId: userId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        descricao: 'Perfil atualizado pelo próprio usuário.',
        metadata: { campos: Object.keys(dto) },
      });
      return user;
    } catch (e) {
      // Backstop caso a corrida bata no índice único.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const alvo = (e.meta?.target as string[])?.join(', ') ?? 'dado';
        throw new ConflictException(`Já existe outro usuário com este ${alvo}.`);
      }
      throw e;
    }
  }

  /** Troca de senha: valida a senha atual (bcrypt) e grava o novo hash. */
  async changePassword(userId: string, dto: ChangePasswordDto, ctx: Ctx) {
    if (dto.novaSenha !== dto.confirmarNovaSenha)
      throw new BadRequestException('A confirmação não corresponde à nova senha.');
    if (dto.novaSenha === dto.senhaAtual)
      throw new BadRequestException('A nova senha deve ser diferente da atual.');

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado.');

    const confere = await bcrypt.compare(dto.senhaAtual, user.senhaHash);
    if (!confere) throw new BadRequestException('Senha atual incorreta.');

    const senhaHash = await bcrypt.hash(dto.novaSenha, 12);
    await this.prisma.user.update({ where: { id: userId }, data: { senhaHash } });

    // Segurança: encerra as demais sessões (refresh tokens) após troca de senha.
    await this.prisma.refreshToken.updateMany({
      where: { userId, revogado: false },
      data: { revogado: true },
    });

    await this.audit.registrar({
      userId,
      acao: AcaoAuditoria.UPDATE,
      entidade: 'User',
      entidadeId: userId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      descricao: 'Senha alterada pelo próprio usuário.',
    });

    return { ok: true };
  }
}
