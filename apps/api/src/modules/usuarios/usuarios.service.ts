import { ImageService, StorageService } from '@core/infra';
import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { AcaoAuditoria, Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';

import { PRESETS_PERFIL, sanitizarPermissoes } from '../../common/permissions/permissoes.constants';
import {
  garantirQuePodeAtribuirPerfil,
  garantirQuePodeMexerNoAlvo,
  garantirQueNaoEscalaPrivilegio,
} from './quem-pode-mexer-em-quem';
import { CriarUsuarioDto, AtualizarUsuarioDto } from './dto/usuarios.dto';

/**
 * QUEM ESTÁ AGINDO — e o perfil dele passou a importar.
 *
 * Enquanto o controller inteiro era `@Roles(ADMINISTRADOR)`, todo autor era
 * administrador e o serviço não precisava perguntar. Com o módulo respeitando a
 * matriz, uma coordenação pode chegar aqui — e aí "quem" define o que pode.
 *
 * `role` e `permissoes` vêm do TOKEN, nunca do corpo. Ver
 * `quem-pode-mexer-em-quem.ts` para as quatro travas.
 */
interface Ctx {
  userId?: string;
  role?: UserRole;
  permissoes?: unknown;
  ip?: string;
  userAgent?: string;
}

/** Campos expostos de um usuário (NUNCA o hash da senha). avatarKey é interno. */
const USER_SELECT = {
  id: true, nome: true, nomeExibicao: true, email: true,
  role: true, permissoes: true, ativo: true, avatarUrl: true, avatarKey: true,
  oab: true, oabUf: true,
  ultimoLoginEm: true, createdAt: true,
} satisfies Prisma.UserSelect;

type UserRaw = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

@Injectable()
export class UsuariosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly image: ImageService,
  ) {}

  /**
   * Monta a resposta pública: `avatarUrl` recebe a URL da foto ENVIADA (assinada,
   * a partir da key no storage) quando houver; senão, a URL informada manualmente.
   * `avatarKey` é interno e não é exposto. (Mesma regra do /profile/me — sem isso
   * a foto de quem fez upload não aparecia na listagem de usuários.)
   */
  private async apresentar<T extends { avatarKey: string | null; avatarUrl: string | null }>(user: T) {
    const { avatarKey, ...resto } = user;
    const avatarUrl = avatarKey
      ? await this.storage.getSignedUrl(avatarKey).catch(() => resto.avatarUrl)
      : resto.avatarUrl;
    return { ...resto, avatarUrl } as Omit<T, 'avatarKey'>;
  }

  async listar(busca?: string) {
    const termo = busca?.trim();
    const where: Prisma.UserWhereInput = termo
      ? {
          OR: [
            { nome: { contains: termo, mode: 'insensitive' } },
            { nomeExibicao: { contains: termo, mode: 'insensitive' } },
            { email: { contains: termo, mode: 'insensitive' } },
          ],
        }
      : {};
    const users = await this.prisma.user.findMany({ where, orderBy: { nome: 'asc' }, select: USER_SELECT });
    return Promise.all(users.map((u) => this.apresentar(u)));
  }

  async detalhe(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: USER_SELECT });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    return this.apresentar(user);
  }

  /**
   * Envia/substitui a foto de perfil de um usuário (upload).
   *
   * A TRAVA 3 VALE AQUI TAMBÉM, e é o tipo de porta que se esquece: proteger
   * `atualizar` e deixar o avatar aberto deixaria a coordenação trocar a foto
   * de um Administrador. É pequeno, e é exatamente por isso que passa.
   */
  async atualizarAvatar(id: string, arquivo: Buffer, ctx: Ctx) {
    const atual = await this.prisma.user.findUnique({
      where: { id },
      select: { avatarKey: true, role: true },
    });
    if (!atual) throw new NotFoundException('Usuário não encontrado.');
    garantirQuePodeMexerNoAlvo(ctx, atual.role);

    const avatarKey = await this.image.processarAvatar(arquivo, `usuarios/${id}`);
    if (atual.avatarKey) void this.storage.delete(atual.avatarKey).catch(() => undefined);

    const user = await this.prisma.user.update({
      where: { id },
      data: { avatarKey, avatarUrl: null }, // a foto enviada tem precedência
      select: USER_SELECT,
    });
    await this.audit.registrar({
      userId: ctx.userId ?? null, acao: AcaoAuditoria.UPDATE, entidade: 'User', entidadeId: id,
      descricao: `Foto de "${user.nome}" atualizada (upload)`, ip: ctx.ip, userAgent: ctx.userAgent, metadata: {},
    });
    return this.apresentar(user);
  }

  /** Remove a foto de perfil de um usuário. Mesma trava do upload. */
  async removerAvatar(id: string, ctx: Ctx) {
    const atual = await this.prisma.user.findUnique({
      where: { id },
      select: { avatarKey: true, role: true },
    });
    if (!atual) throw new NotFoundException('Usuário não encontrado.');
    garantirQuePodeMexerNoAlvo(ctx, atual.role);
    if (atual.avatarKey) void this.storage.delete(atual.avatarKey).catch(() => undefined);

    const user = await this.prisma.user.update({
      where: { id },
      data: { avatarKey: null, avatarUrl: null },
      select: USER_SELECT,
    });
    await this.audit.registrar({
      userId: ctx.userId ?? null, acao: AcaoAuditoria.UPDATE, entidade: 'User', entidadeId: id,
      descricao: `Foto de "${user.nome}" removida`, ip: ctx.ip, userAgent: ctx.userAgent, metadata: {},
    });
    return this.apresentar(user);
  }

  async criar(dto: CriarUsuarioDto, ctx: Ctx) {
    // Trava 1: só Administrador cria Administrador.
    garantirQuePodeAtribuirPerfil(ctx, dto.role);

    const email = dto.email.trim().toLowerCase();
    await this.garantirEmailUnico(email);

    // Sem matriz explícita → usa o preset do perfil.
    const permissoes = dto.permissoes
      ? sanitizarPermissoes(dto.permissoes)
      : PRESETS_PERFIL[dto.role];

    /*
      Trava 4, aplicada sobre a matriz JÁ RESOLVIDA — inclusive quando ela veio
      do preset. Sem isto, bastaria omitir `permissoes` e escolher um perfil
      cujo preset seja mais forte que o de quem está criando.
    */
    garantirQueNaoEscalaPrivilegio(ctx, permissoes);

    const user = await this.prisma.user.create({
      data: {
        nome: dto.nome.trim(),
        nomeExibicao: dto.nomeExibicao?.trim() || null,
        email,
        // OAB só faz sentido guardada em dígitos (é a chave do cruzamento).
        oab: dto.oab?.replace(/\D/g, '') || null,
        oabUf: dto.oabUf?.trim().toUpperCase() || null,
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
    return this.apresentar(user);
  }

  async atualizar(id: string, dto: AtualizarUsuarioDto, ctx: Ctx) {
    const alvo = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true },
    });
    if (!alvo) throw new NotFoundException('Usuário não encontrado.');

    // Trava 3: conta de Administrador só é alterada por Administrador. Checa o
    // perfil ATUAL do alvo, não o que vem no corpo — senão bastaria mandar
    // `role: COORDENACAO` no mesmo PATCH para destravar.
    garantirQuePodeMexerNoAlvo(ctx, alvo.role);
    // Trava 2: promover a Administrador é ato de Administrador.
    garantirQuePodeAtribuirPerfil(ctx, dto.role);

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
    if (email) await this.garantirEmailUnico(email, id);

    const data: Prisma.UserUpdateInput = {
      nome: dto.nome?.trim(),
      nomeExibicao: dto.nomeExibicao === undefined ? undefined : dto.nomeExibicao.trim() || null,
      email,
      oab: dto.oab === undefined ? undefined : dto.oab.replace(/\D/g, '') || null,
      oabUf: dto.oabUf === undefined ? undefined : dto.oabUf.trim().toUpperCase() || null,
      role: dto.role,
      ativo: dto.ativo,
    };
    if (dto.senha) data.senhaHash = await bcrypt.hash(dto.senha, 12);
    if (dto.permissoes !== undefined) {
      const pedidas = sanitizarPermissoes(dto.permissoes);
      garantirQueNaoEscalaPrivilegio(ctx, pedidas); // Trava 4.
      data.permissoes = pedidas as Prisma.InputJsonValue;
    }

    const user = await this.prisma.user.update({ where: { id }, data, select: USER_SELECT });
    await this.audit.registrar({
      userId: ctx.userId ?? null, acao: AcaoAuditoria.UPDATE, entidade: 'User', entidadeId: id,
      descricao: `Usuário "${user.nome}" atualizado`, ip: ctx.ip, userAgent: ctx.userAgent,
      metadata: { role: user.role, senhaRedefinida: !!dto.senha },
    });
    return this.apresentar(user);
  }

  async excluir(id: string, ctx: Ctx) {
    if (ctx.userId === id) {
      throw new BadRequestException('Você não pode excluir a própria conta.');
    }
    const alvo = await this.prisma.user.findUnique({ where: { id }, select: { id: true, nome: true, role: true } });
    if (!alvo) throw new NotFoundException('Usuário não encontrado.');
    garantirQuePodeMexerNoAlvo(ctx, alvo.role); // Trava 3.
    if (alvo.role === UserRole.ADMINISTRADOR) await this.garantirNaoEUltimoAdmin(id);

    await this.prisma.user.delete({ where: { id } });
    await this.audit.registrar({
      userId: ctx.userId ?? null, acao: AcaoAuditoria.DELETE, entidade: 'User', entidadeId: id,
      descricao: `Usuário "${alvo.nome}" excluído`, ip: ctx.ip, userAgent: ctx.userAgent, metadata: {},
    });
    return { ok: true };
  }

  // -------------------------------------------------------------------------

  /** O e-mail é o login: precisa ser único no sistema. */
  private async garantirEmailUnico(email: string, ignorarId?: string) {
    const existe = await this.prisma.user.findFirst({
      where: { email, id: ignorarId ? { not: ignorarId } : undefined },
      select: { id: true },
    });
    if (existe) throw new ConflictException('Já existe um usuário com este e-mail.');
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
