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
import { StorageService } from '../../common/storage/storage.service';
import { ImageService } from '../../common/storage/image.service';
import { ChangePasswordDto, UpdateProfileDto } from './dto/profile.dto';

interface Ctx {
  ip?: string;
  userAgent?: string;
}

// Campos do perfil (NUNCA expõe o hash da senha). avatarKey é interno.
const PERFIL_SELECT = {
  id: true,
  nome: true,
  email: true,
  username: true,
  avatarUrl: true,
  avatarKey: true,
  role: true,
  ativo: true,
  ultimoLoginEm: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

type UserRaw = Prisma.UserGetPayload<{ select: typeof PERFIL_SELECT }>;

@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly image: ImageService,
  ) {}

  /**
   * Monta a resposta pública: `avatarUrl` vira a URL da foto ENVIADA (via key no
   * storage) quando houver; senão, usa a URL informada manualmente. `avatarKey`
   * é interno e não é exposto.
   */
  private async apresentar(user: UserRaw) {
    const { avatarKey, ...resto } = user;
    const avatarUrl = avatarKey
      ? await this.storage.getSignedUrl(avatarKey).catch(() => resto.avatarUrl)
      : resto.avatarUrl;
    return { ...resto, avatarUrl };
  }

  /** Dados do usuário logado (sem a senha). */
  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: PERFIL_SELECT,
    });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    return this.apresentar(user);
  }

  /**
   * Atualiza nome, e-mail, username e avatarUrl (URL manual) do próprio usuário.
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
      username: dto.username !== undefined ? username || null : undefined,
    };

    // Informar uma URL manual substitui (e apaga) uma foto enviada por upload.
    if (dto.avatarUrl !== undefined) {
      const atual = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { avatarKey: true },
      });
      if (atual?.avatarKey) void this.storage.delete(atual.avatarKey).catch(() => undefined);
      data.avatarUrl = dto.avatarUrl.trim() || null;
      data.avatarKey = null;
    }

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
      return this.apresentar(user);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const alvo = (e.meta?.target as string[])?.join(', ') ?? 'dado';
        throw new ConflictException(`Já existe outro usuário com este ${alvo}.`);
      }
      throw e;
    }
  }

  /** Envia/substitui a foto de perfil (upload). Processada em WebP 400×400. */
  async atualizarAvatar(userId: string, arquivo: Buffer, ctx: Ctx) {
    const atual = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarKey: true },
    });
    if (!atual) throw new NotFoundException('Usuário não encontrado.');

    const avatarKey = await this.image.processarAvatar(arquivo, `usuarios/${userId}`);
    if (atual.avatarKey) void this.storage.delete(atual.avatarKey).catch(() => undefined);

    const user = await this.prisma.user.update({
      where: { id: userId },
      // A foto enviada tem precedência: limpa a URL manual.
      data: { avatarKey, avatarUrl: null },
      select: PERFIL_SELECT,
    });
    await this.audit.registrar({
      userId,
      acao: AcaoAuditoria.UPDATE,
      entidade: 'User',
      entidadeId: userId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      descricao: 'Foto de perfil atualizada (upload).',
    });
    return this.apresentar(user);
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
