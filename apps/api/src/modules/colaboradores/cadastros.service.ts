import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AcaoAuditoria, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import {
  AtualizarCargoDto, AtualizarDepartamentoDto, CargoDto, DepartamentoDto,
} from './dto/cadastros.dto';

interface Ctx {
  userId?: string;
  ip?: string;
  userAgent?: string;
}

/**
 * Listas de apoio de Colaboradores: Departamentos e Cargos.
 *
 * Duas mudanças em relação ao antigo "Cadastros Base":
 *
 *  • EMPRESAS saiu. Era a mesma tabela do módulo Patronal, e o `delete` daqui
 *    levava junto, em cascata, todas as contribuições patronais da empresa —
 *    sem auditoria e sem aviso. Quem cuida de empresa é `/empresas`.
 *
 *  • Ganhou AUDITORIA. Este CRUD não registrava nada; renomear um cargo usado
 *    por 40 colaboradores era invisível.
 *
 * Exclusão continua bloqueada (409) quando o registro está em uso — aqui a
 * trava é real: `cargo_id`/`departamento_id` são NOT NULL em `colaboradores`,
 * então o banco devolve P2003 de verdade.
 */
@Injectable()
export class CadastrosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---- Departamentos ----

  listarDepartamentos(incluirInativos = false) {
    return this.prisma.departamento.findMany({
      where: incluirInativos ? {} : { ativo: true },
      orderBy: { nome: 'asc' },
    });
  }

  async criarDepartamento(dto: DepartamentoDto, ctx: Ctx) {
    try {
      const d = await this.prisma.departamento.create({ data: { nome: dto.nome.trim() } });
      await this.auditar(AcaoAuditoria.CREATE, 'Departamento', d.id, `Departamento "${d.nome}" criado`, ctx);
      return d;
    } catch (e) {
      this.conflito(e, 'Já existe um departamento com este nome.');
    }
  }

  async atualizarDepartamento(id: string, dto: AtualizarDepartamentoDto, ctx: Ctx) {
    try {
      const d = await this.prisma.departamento.update({
        where: { id },
        data: { nome: dto.nome?.trim(), ativo: dto.ativo },
      });
      await this.auditar(
        AcaoAuditoria.UPDATE, 'Departamento', d.id,
        this.descreverEdicao('Departamento', d.nome, dto), ctx,
      );
      return d;
    } catch (e) {
      this.conflito(e, 'Já existe um departamento com este nome.');
    }
  }

  async removerDepartamento(id: string, ctx: Ctx) {
    const alvo = await this.prisma.departamento.findUnique({ where: { id }, select: { nome: true } });
    try {
      await this.prisma.departamento.delete({ where: { id } });
      await this.auditar(
        AcaoAuditoria.DELETE, 'Departamento', id,
        `Departamento "${alvo?.nome ?? id}" excluído`, ctx,
      );
      return { ok: true };
    } catch (e) {
      this.aoRemover(e, 'Departamento');
    }
  }

  // ---- Cargos ----

  listarCargos(incluirInativos = false) {
    return this.prisma.cargo.findMany({
      where: incluirInativos ? {} : { ativo: true },
      orderBy: { nome: 'asc' },
    });
  }

  async criarCargo(dto: CargoDto, ctx: Ctx) {
    try {
      const c = await this.prisma.cargo.create({ data: { nome: dto.nome.trim() } });
      await this.auditar(AcaoAuditoria.CREATE, 'Cargo', c.id, `Cargo "${c.nome}" criado`, ctx);
      return c;
    } catch (e) {
      this.conflito(e, 'Já existe um cargo com este nome.');
    }
  }

  async atualizarCargo(id: string, dto: AtualizarCargoDto, ctx: Ctx) {
    try {
      const c = await this.prisma.cargo.update({
        where: { id },
        data: { nome: dto.nome?.trim(), ativo: dto.ativo },
      });
      await this.auditar(
        AcaoAuditoria.UPDATE, 'Cargo', c.id,
        this.descreverEdicao('Cargo', c.nome, dto), ctx,
      );
      return c;
    } catch (e) {
      this.conflito(e, 'Já existe um cargo com este nome.');
    }
  }

  async removerCargo(id: string, ctx: Ctx) {
    const alvo = await this.prisma.cargo.findUnique({ where: { id }, select: { nome: true } });
    try {
      await this.prisma.cargo.delete({ where: { id } });
      await this.auditar(AcaoAuditoria.DELETE, 'Cargo', id, `Cargo "${alvo?.nome ?? id}" excluído`, ctx);
      return { ok: true };
    } catch (e) {
      this.aoRemover(e, 'Cargo');
    }
  }

  // -------------------------------------------------------------------------

  /** Descrição legível da edição — ocultar/reativar é o que mais importa ver. */
  private descreverEdicao(
    entidade: string,
    nome: string,
    dto: AtualizarDepartamentoDto,
  ): string {
    if (dto.ativo === false) return `${entidade} "${nome}" ocultado (não aparece mais nos formulários)`;
    if (dto.ativo === true) return `${entidade} "${nome}" reativado`;
    return `${entidade} renomeado para "${nome}"`;
  }

  private conflito(e: unknown, msgUnico: string): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2002') throw new ConflictException(msgUnico);
      if (e.code === 'P2025') throw new NotFoundException('Registro não encontrado.');
    }
    throw e as Error;
  }

  private aoRemover(e: unknown, label: string): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2003') {
        throw new ConflictException(
          `${label} está em uso por colaboradores e não pode ser excluído. Oculte-o para tirá-lo dos formulários sem perder o histórico.`,
        );
      }
      if (e.code === 'P2025') throw new NotFoundException(`${label} não encontrado.`);
    }
    throw e as Error;
  }

  private auditar(
    acao: AcaoAuditoria,
    entidade: string,
    entidadeId: string,
    descricao: string,
    ctx: Ctx,
  ) {
    return this.audit.registrar({
      userId: ctx.userId ?? null,
      acao,
      entidade,
      entidadeId,
      descricao,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: {},
    });
  }
}
