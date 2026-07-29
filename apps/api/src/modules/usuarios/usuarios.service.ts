import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { AcaoAuditoria, Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { PRESETS_PERFIL, sanitizarPermissoes } from '../../common/permissions/permissoes.constants';
import { CriarUsuarioDto, AtualizarUsuarioDto } from './dto/usuarios.dto';

interface Ctx {
  userId?: string;
  ip?: string;
  userAgent?: string;
}

/** Campos expostos de um usuário (NUNCA o hash da senha). */
const USER_SELECT = {
  id: true, nome: true, nomeExibicao: true, email: true, username: true,
  role: true, permissoes: true, ativo: true, avatarUrl: true,
  ultimoLoginEm: true, createdAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsuariosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listar(busca?: string) {
    const termo = busca?.trim();
    const where: Prisma.UserWhereInput = termo
      ? {
          OR: [
            { nome: { contains: termo, mode: 'insensitive' } },
            { email: { contains: termo, mode: 'insensitive' } },
            { username: { contains: termo, mode: 'insensitive' } },
          ],
        }
      : {};
    return this.prisma.user.findMany({ where, orderBy: { nome: 'asc' }, select: USER_SELECT });
  }

  async detalhe(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: USER_SELECT });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    return user;
  }

  async criar(dto: CriarUsuarioDto, ctx: Ctx) {
    const email = dto.email.trim().toLowerCase();
    const username = dto.username.trim();
    await this.garantirUnico(email, username);

    // Sem matriz explícita → usa o preset do perfil.
    const permissoes = dto.permissoes
      ? sanitizarPermissoes(dto.permissoes)
      : PRESETS_PERFIL[dto.role];

    const user = await this.prisma.user.create({
      data: {
        nome: dto.nome.trim(),
        nomeExibicao: dto.nomeExibicao?.trim() || null,
        email,
        username,
        senhaHash: await bcrypt.hash(dto.senha, 12),
        role: dto.role,
        ativo: dto.ativo ?? true,
        permissoes: permissoes as Prisma.InputJsonValue,
      },
      select: USER_SELECT,
    });

    await this.audit.registrar({
      userId: ctx.userId ?? null, acao: AcaoAuditoria.CREATE, entidade: 'User', entidadeId: user.id,
      descricao: `Usuário "${user.nome}" (${user.role}) criado`, ip: ctx.ip, userAgent: ctx.userAgent,
      metadata: { role: user.role },
    });
    return user;
  }

  async atualizar(id: string, dto: AtualizarUsuarioDto, ctx: Ctx) {
    const alvo = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true },
    });
    if (!alvo) throw new NotFoundException('Usuário não encontrado.');

    const ehProprio = ctx.userId === id;
    // Trava anti-lockout: o admin não pode rebaixar/desativar a si mesmo.
    if (ehProprio && dto.role && dto.role !== UserRole.ADMINISTRADOR) {
      throw new BadRequestException('Você não pode alterar o próprio perfil de Administrador.');
    }
    if (ehProprio && dto.ativo === false) {
      throw new BadRequestException('Você não pode desativar a própria conta.');
    }
    // Não permite remover o último Administrador ativo.
    if (alvo.role === UserRole.ADMINISTRADOR && (dto.role && dto.role !== UserRole.ADMINISTRADOR || dto.ativo === false)) {
      await this.garantirNaoEUltimoAdmin(id);
    }

    const email = dto.email?.trim().toLowerCase();
    const username = dto.username?.trim();
    if (email || username) await this.garantirUnico(email, username, id);

    const data: Prisma.UserUpdateInput = {
      nome: dto.nome?.trim(),
      nomeExibicao: dto.nomeExibicao === undefined ? undefined : dto.nomeExibicao.trim() || null,
      email,
      username,
      role: dto.role,
      ativo: dto.ativo,
    };
    if (dto.senha) data.senhaHash = await bcrypt.hash(dto.senha, 12);
    if (dto.permissoes !== undefined) {
      data.permissoes = sanitizarPermissoes(dto.permissoes) as Prisma.InputJsonValue;
    }

    const user = await this.prisma.user.update({ where: { id }, data, select: USER_SELECT });
    await this.audit.registrar({
      userId: ctx.userId ?? null, acao: AcaoAuditoria.UPDATE, entidade: 'User', entidadeId: id,
      descricao: `Usuário "${user.nome}" atualizado`, ip: ctx.ip, userAgent: ctx.userAgent,
      metadata: { role: user.role, senhaRedefinida: !!dto.senha },
    });
    return user;
  }

  async excluir(id: string, ctx: Ctx) {
    if (ctx.userId === id) {
      throw new BadRequestException('Você não pode excluir a própria conta.');
    }
    const alvo = await this.prisma.user.findUnique({ where: { id }, select: { id: true, nome: true, role: true } });
    if (!alvo) throw new NotFoundException('Usuário não encontrado.');
    if (alvo.role === UserRole.ADMINISTRADOR) await this.garantirNaoEUltimoAdmin(id);

    await this.prisma.user.delete({ where: { id } });
    await this.audit.registrar({
      userId: ctx.userId ?? null, acao: AcaoAuditoria.DELETE, entidade: 'User', entidadeId: id,
      descricao: `Usuário "${alvo.nome}" excluído`, ip: ctx.ip, userAgent: ctx.userAgent, metadata: {},
    });
    return { ok: true };
  }

  // -------------------------------------------------------------------------

  private async garantirUnico(email?: string, username?: string, ignorarId?: string) {
    if (email) {
      const existe = await this.prisma.user.findFirst({
        where: { email, id: ignorarId ? { not: ignorarId } : undefined },
        select: { id: true },
      });
      if (existe) throw new ConflictException('Já existe um usuário com este e-mail.');
    }
    if (username) {
      const existe = await this.prisma.user.findFirst({
        where: { username, id: ignorarId ? { not: ignorarId } : undefined },
        select: { id: true },
      });
      if (existe) throw new ConflictException('Já existe um usuário com este login.');
    }
  }

  private async garantirNaoEUltimoAdmin(id: string) {
    const outrosAdmins = await this.prisma.user.count({
      where: { role: UserRole.ADMINISTRADOR, ativo: true, id: { not: id } },
    });
    if (outrosAdmins === 0) {
      throw new ForbiddenException('Não é possível remover o último Administrador ativo do sistema.');
    }
  }
}
