import { Injectable, NotFoundException } from '@nestjs/common';
import { AcaoAuditoria, DesfechoAtendimento, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import {
  CreateAtendimentoDto,
  ListAtendimentosQueryDto,
} from './dto/atendimentos.dto';

interface Ctx {
  ip?: string;
  userAgent?: string;
  userId?: string;
}

/** Campos mínimos do filiado exibidos na LISTA (LGPD: só o necessário à triagem). */
const filiadoLista = {
  select: { id: true, nomeCompleto: true, matricula: true, telefonePrincipal: true },
} as const;

@Injectable()
export class AtendimentosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------------
  // Registro do atendimento (data/hora/usuário automáticos)
  // -------------------------------------------------------------------------

  async criar(dto: CreateAtendimentoDto, ctx: Ctx) {
    const filiado = await this.prisma.filiado.findUnique({
      where: { id: dto.filiadoId },
      select: { id: true, nomeCompleto: true },
    });
    if (!filiado) throw new NotFoundException('Filiado não encontrado.');

    const encaminhado = dto.desfecho === DesfechoAtendimento.ENCAMINHADO;
    const atendimento = await this.prisma.atendimento.create({
      data: {
        filiadoId: filiado.id,
        atendentePorId: ctx.userId!, // usuário logado (automático)
        canal: dto.canal,
        descricao: dto.descricao.trim(),
        desfecho: dto.desfecho,
        setor: encaminhado ? dto.setor : null,
        responsavel: encaminhado ? dto.responsavel?.trim() || null : null,
      },
      include: { filiado: filiadoLista, atendente: { select: { id: true, nome: true } } },
    });

    await this.audit.registrar({
      userId: ctx.userId ?? null,
      acao: AcaoAuditoria.CREATE,
      entidade: 'Atendimento',
      entidadeId: atendimento.id,
      descricao: `Atendimento (${dto.canal}) registrado para ${filiado.nomeCompleto} — ${dto.desfecho}`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { filiadoId: filiado.id, canal: dto.canal, desfecho: dto.desfecho },
    });
    return atendimento;
  }

  // -------------------------------------------------------------------------
  // Listagem com filtros (status, canal, período, busca) + paginação
  // -------------------------------------------------------------------------

  async listar(q: ListAtendimentosQueryDto) {
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(100, Math.max(5, Number(q.pageSize) || 20));
    const busca = q.busca?.trim();

    const and: Prisma.AtendimentoWhereInput[] = [];
    if (q.desfecho) and.push({ desfecho: q.desfecho });
    if (q.canal) and.push({ canal: q.canal });
    if (busca) {
      and.push({
        filiado: {
          OR: [
            { nomeCompleto: { contains: busca, mode: 'insensitive' } },
            { matricula: { contains: busca, mode: 'insensitive' } },
            { cpf: { contains: busca.replace(/\D/g, '') || busca } },
          ],
        },
      });
    }
    const range = this.intervaloDatas(q.dataInicio, q.dataFim);
    if (range) and.push({ createdAt: range });

    const where: Prisma.AtendimentoWhereInput = and.length ? { AND: and } : {};

    const [total, items] = await this.prisma.$transaction([
      this.prisma.atendimento.count({ where }),
      this.prisma.atendimento.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, canal: true, desfecho: true, setor: true, responsavel: true,
          descricao: true, createdAt: true,
          filiado: filiadoLista,
          atendente: { select: { id: true, nome: true } },
        },
      }),
    ]);

    return { items, total, page, pageSize, totalPaginas: Math.max(1, Math.ceil(total / pageSize)) };
  }

  // -------------------------------------------------------------------------
  // Dossiê completo (gaveta): dados do filiado + desfecho + histórico
  // -------------------------------------------------------------------------

  async detalhe(id: string) {
    const atendimento = await this.prisma.atendimento.findUnique({
      where: { id },
      include: {
        atendente: { select: { id: true, nome: true } },
        filiado: {
          // Dados de contato necessários à triagem e à atualização cadastral.
          select: {
            id: true, nomeCompleto: true, matricula: true, cpf: true, situacao: true,
            telefonePrincipal: true, telefoneSecundario: true, email: true,
            cep: true, endereco: true, numero: true, complemento: true, bairro: true,
            cidade: true, estado: true,
          },
        },
      },
    });
    if (!atendimento) throw new NotFoundException('Atendimento não encontrado.');

    // Histórico: outros atendimentos do mesmo filiado (contexto), mais recentes.
    const historico = await this.prisma.atendimento.findMany({
      where: { filiadoId: atendimento.filiado.id, id: { not: id } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true, canal: true, desfecho: true, setor: true, descricao: true, createdAt: true,
        atendente: { select: { nome: true } },
      },
    });

    return { atendimento, historico };
  }

  /** Converte "YYYY-MM-DD" (início/fim) num filtro de intervalo em createdAt. */
  private intervaloDatas(inicio?: string, fim?: string): Prisma.DateTimeFilter | null {
    const range: Prisma.DateTimeFilter = {};
    if (inicio && /^\d{4}-\d{2}-\d{2}$/.test(inicio)) range.gte = new Date(`${inicio}T00:00:00.000Z`);
    if (fim && /^\d{4}-\d{2}-\d{2}$/.test(fim)) {
      const d = new Date(`${fim}T00:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      range.lt = d;
    }
    return range.gte || range.lt ? range : null;
  }
}
