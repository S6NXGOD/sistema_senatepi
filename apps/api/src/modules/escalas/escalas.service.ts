import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AcaoAuditoria } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { CriarEscalasDto, ListEscalasQueryDto } from './dto/escalas.dto';

interface Ctx {
  userId?: string;
  ip?: string;
  userAgent?: string;
}

const advogadoSel = { select: { id: true, nome: true, nomeExibicao: true } } as const;

/** Intervalo [gte, lt) do mês (YYYY-MM); padrão: mês atual. Em UTC (coluna @db.Date). */
function rangeMes(mes?: string) {
  const agora = new Date();
  let y = agora.getUTCFullYear();
  let m = agora.getUTCMonth();
  if (mes && /^\d{4}-\d{2}$/.test(mes)) {
    const [yy, mm] = mes.split('-').map(Number);
    y = yy;
    m = mm - 1;
  }
  return { gte: new Date(Date.UTC(y, m, 1)), lt: new Date(Date.UTC(y, m + 1, 1)) };
}

@Injectable()
export class EscalasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Usuários ativos que podem ser escalados (equipe jurídica/geral). */
  listarAdvogados() {
    return this.prisma.user.findMany({
      where: { ativo: true },
      orderBy: { nome: 'asc' },
      select: { id: true, nome: true, nomeExibicao: true, role: true },
    });
  }

  async listar(q: ListEscalasQueryDto) {
    const { gte, lt } = rangeMes(q.mes);
    return this.prisma.escalaAdvogado.findMany({
      where: { data: { gte, lt }, ...(q.advogadoId ? { advogadoId: q.advogadoId } : {}) },
      orderBy: [{ data: 'asc' }, { horaInicio: 'asc' }],
      select: {
        id: true, data: true, horaInicio: true, horaFim: true, observacao: true,
        advogado: advogadoSel,
      },
    });
  }

  async criar(dto: CriarEscalasDto, ctx: Ctx) {
    const adv = await this.prisma.user.findUnique({
      where: { id: dto.advogadoId },
      select: { id: true, nome: true },
    });
    if (!adv) throw new BadRequestException('Advogado inválido.');

    for (const it of dto.itens) {
      if (it.horaFim <= it.horaInicio) {
        throw new BadRequestException(`Em ${it.data}, a hora de fim deve ser após a de início.`);
      }
    }

    const { count } = await this.prisma.escalaAdvogado.createMany({
      data: dto.itens.map((it) => ({
        advogadoId: dto.advogadoId,
        data: new Date(it.data),
        horaInicio: it.horaInicio,
        horaFim: it.horaFim,
        observacao: it.observacao?.trim() || null,
        criadoPor: ctx.userId,
      })),
    });

    await this.audit.registrar({
      userId: ctx.userId ?? null,
      acao: AcaoAuditoria.CREATE,
      entidade: 'EscalaAdvogado',
      entidadeId: dto.advogadoId,
      descricao: `${count} escala(s) cadastrada(s) para ${adv.nome}`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { advogadoId: dto.advogadoId, quantidade: count },
    });
    return { ok: true, criadas: count };
  }

  async remover(id: string, ctx: Ctx) {
    const escala = await this.prisma.escalaAdvogado.findUnique({
      where: { id },
      select: { id: true, data: true, advogado: { select: { nome: true } } },
    });
    if (!escala) throw new NotFoundException('Escala não encontrada.');

    await this.prisma.escalaAdvogado.delete({ where: { id } });
    await this.audit.registrar({
      userId: ctx.userId ?? null,
      acao: AcaoAuditoria.DELETE,
      entidade: 'EscalaAdvogado',
      entidadeId: id,
      descricao: `Escala de ${escala.advogado.nome} (${escala.data.toISOString().slice(0, 10)}) removida`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: {},
    });
    return { ok: true };
  }
}
