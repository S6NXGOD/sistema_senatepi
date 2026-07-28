import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AcaoAuditoria, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import {
  CreateCompromissoDto,
  ListCompromissosQueryDto,
  MudarStatusDto,
  UpdateCompromissoDto,
} from './dto/agenda.dto';

interface Ctx {
  ip?: string;
  userAgent?: string;
  userId?: string;
}

/** LGPD: nos cards da agenda expomos só o mínimo do filiado (nome/matrícula). */
const filiadoCard = { select: { id: true, nomeCompleto: true, matricula: true } } as const;
const responsavelSel = { select: { id: true, nome: true } } as const;

@Injectable()
export class AgendaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Usuários ativos que podem ser responsáveis por um compromisso. */
  listarResponsaveis() {
    return this.prisma.user.findMany({
      where: { ativo: true },
      orderBy: { nome: 'asc' },
      select: { id: true, nome: true, role: true },
    });
  }

  // -------------------------------------------------------------------------
  // Criação
  // -------------------------------------------------------------------------

  async criar(dto: CreateCompromissoDto, ctx: Ctx) {
    await this.validarVinculos(dto.responsavelId, dto.filiadoId, dto.atendimentoId);
    const inicio = new Date(dto.inicio);
    const fim = new Date(dto.fim);
    if (fim < inicio) throw new BadRequestException('O fim não pode ser antes do início.');

    const compromisso = await this.prisma.compromisso.create({
      data: {
        titulo: dto.titulo.trim(),
        tipo: dto.tipo,
        status: dto.status ?? undefined,
        inicio,
        fim,
        descricao: dto.descricao?.trim() || null,
        responsavelId: dto.responsavelId,
        filiadoId: dto.filiadoId || null,
        atendimentoId: dto.atendimentoId || null,
        criadoPor: ctx.userId,
      },
      include: { filiado: filiadoCard, responsavel: responsavelSel, atendimento: { select: { id: true } } },
    });

    await this.auditar(AcaoAuditoria.CREATE, compromisso.id, `Compromisso criado: ${compromisso.titulo}`, ctx, {
      tipo: dto.tipo, inicio: inicio.toISOString(),
    });
    return compromisso;
  }

  // -------------------------------------------------------------------------
  // Listagem (Kanban/Calendário) — filtros + intervalo por `inicio`
  // -------------------------------------------------------------------------

  async listar(q: ListCompromissosQueryDto) {
    const and: Prisma.CompromissoWhereInput[] = [];
    if (q.status) and.push({ status: q.status });
    if (q.tipo) and.push({ tipo: q.tipo });
    if (q.responsavelId) and.push({ responsavelId: q.responsavelId });
    if (q.filiadoId) and.push({ filiadoId: q.filiadoId });
    const busca = q.busca?.trim();
    if (busca) {
      and.push({
        OR: [
          { titulo: { contains: busca, mode: 'insensitive' } },
          { filiado: { nomeCompleto: { contains: busca, mode: 'insensitive' } } },
        ],
      });
    }
    const range: Prisma.DateTimeFilter = {};
    if (q.dataInicio) range.gte = new Date(q.dataInicio);
    if (q.dataFim) range.lte = new Date(q.dataFim);
    if (range.gte || range.lte) and.push({ inicio: range });

    return this.prisma.compromisso.findMany({
      where: and.length ? { AND: and } : {},
      orderBy: { inicio: 'asc' },
      take: 500,
      select: {
        id: true, titulo: true, tipo: true, status: true, inicio: true, fim: true,
        descricao: true, dataOriginal: true, atendimentoId: true,
        filiado: filiadoCard,
        responsavel: responsavelSel,
      },
    });
  }

  async detalhe(id: string) {
    const compromisso = await this.prisma.compromisso.findUnique({
      where: { id },
      include: {
        filiado: filiadoCard,
        responsavel: responsavelSel,
        atendimento: { select: { id: true, canal: true, desfecho: true } },
      },
    });
    if (!compromisso) throw new NotFoundException('Compromisso não encontrado.');
    return compromisso;
  }

  // -------------------------------------------------------------------------
  // Edição — com TRAVA da data original na 1ª remarcação (auditoria de prazos)
  // -------------------------------------------------------------------------

  async atualizar(id: string, dto: UpdateCompromissoDto, ctx: Ctx) {
    const atual = await this.prisma.compromisso.findUnique({ where: { id } });
    if (!atual) throw new NotFoundException('Compromisso não encontrado.');

    if (dto.responsavelId || dto.filiadoId !== undefined || dto.atendimentoId !== undefined) {
      await this.validarVinculos(
        dto.responsavelId ?? atual.responsavelId,
        dto.filiadoId === undefined ? undefined : dto.filiadoId,
        dto.atendimentoId === undefined ? undefined : dto.atendimentoId,
      );
    }

    const novoInicio = dto.inicio ? new Date(dto.inicio) : atual.inicio;
    const novoFim = dto.fim ? new Date(dto.fim) : atual.fim;
    if (novoFim < novoInicio) throw new BadRequestException('O fim não pode ser antes do início.');

    // Remarcação: se a data de início mudou e ainda não há original, TRAVA a original.
    const remarcado = dto.inicio != null && novoInicio.getTime() !== atual.inicio.getTime();
    const dataOriginal = remarcado && !atual.dataOriginal ? atual.inicio : undefined;

    const compromisso = await this.prisma.compromisso.update({
      where: { id },
      data: {
        titulo: dto.titulo?.trim(),
        tipo: dto.tipo,
        status: dto.status,
        inicio: dto.inicio ? novoInicio : undefined,
        fim: dto.fim ? novoFim : undefined,
        descricao: dto.descricao === undefined ? undefined : dto.descricao?.trim() || null,
        responsavelId: dto.responsavelId,
        filiadoId: dto.filiadoId === undefined ? undefined : dto.filiadoId || null,
        atendimentoId: dto.atendimentoId === undefined ? undefined : dto.atendimentoId || null,
        ...(dataOriginal ? { dataOriginal } : {}),
      },
      include: { filiado: filiadoCard, responsavel: responsavelSel, atendimento: { select: { id: true } } },
    });

    if (remarcado) {
      // Trilha de auditoria da remarcação — nunca apagamos as datas antigas.
      await this.auditar(AcaoAuditoria.UPDATE, id, `Compromisso REMARCADO: ${atual.inicio.toISOString()} → ${novoInicio.toISOString()}`, ctx, {
        de: atual.inicio.toISOString(),
        para: novoInicio.toISOString(),
        dataOriginal: (compromisso.dataOriginal ?? atual.inicio).toISOString(),
      });
    } else {
      await this.auditar(AcaoAuditoria.UPDATE, id, `Compromisso atualizado: ${compromisso.titulo}`, ctx, {});
    }
    return compromisso;
  }

  async mudarStatus(id: string, dto: MudarStatusDto, ctx: Ctx) {
    const atual = await this.prisma.compromisso.findUnique({ where: { id }, select: { id: true } });
    if (!atual) throw new NotFoundException('Compromisso não encontrado.');
    const compromisso = await this.prisma.compromisso.update({
      where: { id },
      data: { status: dto.status },
      include: { filiado: filiadoCard, responsavel: responsavelSel, atendimento: { select: { id: true } } },
    });
    await this.auditar(AcaoAuditoria.UPDATE, id, `Status do compromisso → ${dto.status}`, ctx, { status: dto.status });
    return compromisso;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async validarVinculos(responsavelId?: string, filiadoId?: string, atendimentoId?: string) {
    if (responsavelId) {
      const u = await this.prisma.user.findUnique({ where: { id: responsavelId }, select: { id: true } });
      if (!u) throw new BadRequestException('Responsável inválido.');
    }
    if (filiadoId) {
      const f = await this.prisma.filiado.findUnique({ where: { id: filiadoId }, select: { id: true } });
      if (!f) throw new BadRequestException('Filiado inválido.');
    }
    if (atendimentoId) {
      const a = await this.prisma.atendimento.findUnique({ where: { id: atendimentoId }, select: { id: true } });
      if (!a) throw new BadRequestException('Atendimento inválido.');
    }
  }

  private auditar(acao: AcaoAuditoria, entidadeId: string, descricao: string, ctx: Ctx, metadata: Prisma.InputJsonValue) {
    return this.audit.registrar({
      userId: ctx.userId ?? null,
      acao,
      entidade: 'Compromisso',
      entidadeId,
      descricao,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata,
    });
  }
}
