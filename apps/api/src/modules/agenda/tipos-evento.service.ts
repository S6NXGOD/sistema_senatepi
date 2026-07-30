import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AcaoAuditoria, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { CORES_TIPO, CriarTipoEventoDto, AtualizarTipoEventoDto } from './dto/tipos-evento.dto';

interface Ctx {
  userId?: string;
  ip?: string;
  userAgent?: string;
}

const SELECT = {
  id: true, slug: true, nome: true, cor: true, ordem: true, ativo: true, sistema: true,
} satisfies Prisma.TipoCompromissoSelect;

/**
 * Nome -> slug estavel (MAIUSCULAS, sem acento, so A-Z/0-9/_).
 * NFD separa a letra-base do acento; removemos tudo que nao for ASCII basico
 * (as marcas combinantes viram nao-ASCII) e normalizamos para A-Z0-9_.
 * (Comentario/regex em ASCII de proposito: caracteres combinantes literais no
 * fonte sao fragilizados por ferramentas de edicao.)
 */
function slugificar(nome: string): string {
  const semAcento = nome.normalize('NFD').replace(/[^\x00-\x7F]/g, '');
  const base = semAcento
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return base || 'TIPO';
}

@Injectable()
export class TiposEventoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  listar(incluirInativos = false) {
    return this.prisma.tipoCompromisso.findMany({
      where: incluirInativos ? {} : { ativo: true },
      orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
      select: SELECT,
    });
  }

  async criar(dto: CriarTipoEventoDto, ctx: Ctx) {
    const cor = this.validarCor(dto.cor);
    const slug = await this.slugUnico(slugificar(dto.nome));
    const ordem = dto.ordem ?? (await this.proximaOrdem());

    const tipo = await this.prisma.tipoCompromisso.create({
      data: { slug, nome: dto.nome.trim(), cor, ordem, sistema: false },
      select: SELECT,
    });
    await this.auditar(AcaoAuditoria.CREATE, tipo.id, ctx, `Tipo de evento "${tipo.nome}" criado`);
    return tipo;
  }

  async atualizar(id: string, dto: AtualizarTipoEventoDto, ctx: Ctx) {
    const atual = await this.prisma.tipoCompromisso.findUnique({ where: { id }, select: SELECT });
    if (!atual) throw new NotFoundException('Tipo de evento não encontrado.');

    const tipo = await this.prisma.tipoCompromisso.update({
      where: { id },
      data: {
        nome: dto.nome?.trim(),
        cor: dto.cor !== undefined ? this.validarCor(dto.cor) : undefined,
        ordem: dto.ordem,
        ativo: dto.ativo,
      },
      select: SELECT,
    });
    await this.auditar(AcaoAuditoria.UPDATE, id, ctx, `Tipo de evento "${tipo.nome}" atualizado`);
    return tipo;
  }

  async remover(id: string, ctx: Ctx) {
    const tipo = await this.prisma.tipoCompromisso.findUnique({ where: { id }, select: SELECT });
    if (!tipo) throw new NotFoundException('Tipo de evento não encontrado.');
    if (tipo.sistema) {
      throw new BadRequestException('Tipos padrão do sistema não podem ser excluídos — você pode ocultá-los (desativar).');
    }
    const emUso = await this.prisma.compromisso.count({ where: { tipo: tipo.slug } });
    if (emUso > 0) {
      throw new ConflictException(
        `Este tipo está em uso por ${emUso} evento(s). Desative-o em vez de excluir para preservar o histórico.`,
      );
    }
    await this.prisma.tipoCompromisso.delete({ where: { id } });
    await this.auditar(AcaoAuditoria.DELETE, id, ctx, `Tipo de evento "${tipo.nome}" excluído`);
    return { ok: true };
  }

  /** Valida que `slug` existe e está ativo (usado ao criar/editar compromissos). */
  async garantirSlugValido(slug: string) {
    const tipo = await this.prisma.tipoCompromisso.findUnique({ where: { slug }, select: { ativo: true } });
    if (!tipo) throw new BadRequestException('Tipo de evento inválido.');
    if (!tipo.ativo) throw new BadRequestException('Este tipo de evento está desativado.');
  }

  // -------------------------------------------------------------------------

  private validarCor(cor?: string): string {
    if (!cor) return 'slate';
    return (CORES_TIPO as readonly string[]).includes(cor) ? cor : 'slate';
  }

  private async proximaOrdem(): Promise<number> {
    const ultimo = await this.prisma.tipoCompromisso.aggregate({ _max: { ordem: true } });
    return (ultimo._max.ordem ?? 0) + 1;
  }

  private async slugUnico(base: string): Promise<string> {
    let slug = base;
    let n = 1;
    while (await this.prisma.tipoCompromisso.findUnique({ where: { slug }, select: { id: true } })) {
      n += 1;
      slug = `${base}_${n}`.slice(0, 40);
    }
    return slug;
  }

  private auditar(acao: AcaoAuditoria, entidadeId: string, ctx: Ctx, descricao: string) {
    return this.audit.registrar({
      userId: ctx.userId ?? null, acao, entidade: 'TipoCompromisso', entidadeId, descricao,
      ip: ctx.ip, userAgent: ctx.userAgent, metadata: {},
    });
  }
}
