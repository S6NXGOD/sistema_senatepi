import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AcaoAuditoria, Prisma, StatusCompromisso } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { TiposEventoService } from './tipos-evento.service';
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
const responsavelSel = { select: { id: true, nome: true, avatarUrl: true } } as const;
const processoSel = { select: { id: true, numeroCNJ: true } } as const;

/** Campos expostos nos cards (Kanban/Calendário/Alertas). */
const cardSelect = {
  id: true, titulo: true, tipo: true, status: true, inicio: true, fim: true,
  local: true, descricao: true, urgente: true, iniciadoEm: true,
  dataOriginal: true, atendimentoId: true,
  filiado: filiadoCard, responsavel: responsavelSel, processo: processoSel,
} as const;

@Injectable()
export class AgendaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tipos: TiposEventoService,
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
    await this.tipos.garantirSlugValido(dto.tipo);
    await this.validarVinculos(dto.responsavelId, dto.filiadoId, dto.atendimentoId, dto.processoId);
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
        local: dto.local?.trim() || null,
        descricao: dto.descricao?.trim() || null,
        observacoesInternas: dto.observacoesInternas?.trim() || null,
        urgente: dto.urgente ?? false,
        responsavelId: dto.responsavelId,
        filiadoId: dto.filiadoId || null,
        atendimentoId: dto.atendimentoId || null,
        processoId: dto.processoId || null,
        criadoPor: ctx.userId,
      },
      select: cardSelect,
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
      select: cardSelect,
    });
  }

  // -------------------------------------------------------------------------
  // Alertas: "Aguardando interação" (venceu há +3h e ainda em aberto) e
  //          "Próximas 24 horas" (agendados para o próximo dia).
  // -------------------------------------------------------------------------

  async alertas() {
    const agora = new Date();
    const menos3h = new Date(agora.getTime() - 3 * 3600 * 1000);
    const mais24h = new Date(agora.getTime() + 24 * 3600 * 1000);
    const abertos: Prisma.CompromissoWhereInput = {
      status: { in: [StatusCompromisso.PENDENTE, StatusCompromisso.EM_ANDAMENTO] },
    };

    const [aguardando, proximas24h] = await Promise.all([
      this.prisma.compromisso.findMany({
        where: { AND: [abertos, { inicio: { lt: menos3h } }] },
        orderBy: { inicio: 'asc' },
        take: 50,
        select: cardSelect,
      }),
      this.prisma.compromisso.findMany({
        where: { AND: [abertos, { inicio: { gte: agora, lte: mais24h } }] },
        orderBy: { inicio: 'asc' },
        take: 50,
        select: cardSelect,
      }),
    ]);
    return { aguardando, proximas24h };
  }

  async detalhe(id: string) {
    const compromisso = await this.prisma.compromisso.findUnique({
      where: { id },
      include: {
        // Detalhe expõe mais do filiado (contato) — a tela é de trabalho interno.
        filiado: {
          select: {
            id: true, nomeCompleto: true, matricula: true, cpf: true,
            telefonePrincipal: true, email: true, formacao: true,
          },
        },
        responsavel: { select: { id: true, nome: true, nomeExibicao: true, avatarUrl: true, role: true } },
        processo: { select: { id: true, numeroCNJ: true, classeProcessual: true } },
        // Triagem de origem: canal, demanda e QUEM registrou (atendente).
        atendimento: {
          select: {
            id: true, numero: true, canal: true, desfecho: true, descricao: true, createdAt: true,
            atendente: { select: { id: true, nome: true, nomeExibicao: true } },
          },
        },
      },
    });
    if (!compromisso) throw new NotFoundException('Compromisso não encontrado.');

    // "Criado por" — o campo guarda o id do usuário que registrou o evento.
    let criadoPorNome: string | null = null;
    if (compromisso.criadoPor) {
      const u = await this.prisma.user.findUnique({
        where: { id: compromisso.criadoPor },
        select: { nome: true, nomeExibicao: true },
      });
      criadoPorNome = u?.nomeExibicao || u?.nome || null;
    }
    return { ...compromisso, criadoPorNome };
  }

  // -------------------------------------------------------------------------
  // Edição — com TRAVA da data original na 1ª remarcação (auditoria de prazos)
  // -------------------------------------------------------------------------

  async atualizar(id: string, dto: UpdateCompromissoDto, ctx: Ctx) {
    const atual = await this.prisma.compromisso.findUnique({ where: { id } });
    if (!atual) throw new NotFoundException('Compromisso não encontrado.');
    if (dto.tipo) await this.tipos.garantirSlugValido(dto.tipo);

    if (dto.responsavelId || dto.filiadoId !== undefined || dto.atendimentoId !== undefined || dto.processoId !== undefined) {
      await this.validarVinculos(
        dto.responsavelId ?? atual.responsavelId,
        dto.filiadoId === undefined ? undefined : dto.filiadoId,
        dto.atendimentoId === undefined ? undefined : dto.atendimentoId,
        dto.processoId === undefined ? undefined : dto.processoId,
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
        local: dto.local === undefined ? undefined : dto.local?.trim() || null,
        descricao: dto.descricao === undefined ? undefined : dto.descricao?.trim() || null,
        observacoesInternas: dto.observacoesInternas === undefined ? undefined : dto.observacoesInternas?.trim() || null,
        urgente: dto.urgente,
        responsavelId: dto.responsavelId,
        filiadoId: dto.filiadoId === undefined ? undefined : dto.filiadoId || null,
        atendimentoId: dto.atendimentoId === undefined ? undefined : dto.atendimentoId || null,
        processoId: dto.processoId === undefined ? undefined : dto.processoId || null,
        ...(dataOriginal ? { dataOriginal } : {}),
      },
      select: cardSelect,
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
    const atual = await this.prisma.compromisso.findUnique({
      where: { id },
      select: { id: true, iniciadoEm: true },
    });
    if (!atual) throw new NotFoundException('Compromisso não encontrado.');

    // Ao INICIAR (EM_ANDAMENTO), carimba o horário para o cronômetro/alertas —
    // só na 1ª vez. Ao voltar para PENDENTE, zera o cronômetro.
    let iniciadoEm: Date | null | undefined;
    if (dto.status === 'EM_ANDAMENTO' && !atual.iniciadoEm) iniciadoEm = new Date();
    else if (dto.status === 'PENDENTE') iniciadoEm = null;

    const compromisso = await this.prisma.compromisso.update({
      where: { id },
      data: { status: dto.status, ...(iniciadoEm !== undefined ? { iniciadoEm } : {}) },
      select: cardSelect,
    });
    await this.auditar(AcaoAuditoria.UPDATE, id, `Status do compromisso → ${dto.status}`, ctx, { status: dto.status });
    return compromisso;
  }

  async remover(id: string, ctx: Ctx) {
    const c = await this.prisma.compromisso.findUnique({ where: { id }, select: { id: true, titulo: true } });
    if (!c) throw new NotFoundException('Compromisso não encontrado.');
    await this.prisma.compromisso.delete({ where: { id } });
    await this.auditar(AcaoAuditoria.DELETE, id, `Compromisso excluído: ${c.titulo}`, ctx, {});
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async validarVinculos(responsavelId?: string, filiadoId?: string, atendimentoId?: string, processoId?: string) {
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
    if (processoId) {
      const p = await this.prisma.processo.findUnique({ where: { id: processoId }, select: { id: true } });
      if (!p) throw new BadRequestException('Processo inválido.');
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
