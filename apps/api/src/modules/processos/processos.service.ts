import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AcaoAuditoria, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { DatajudService } from './datajud.service';
import {
  AtualizarProcessoDto,
  ListProcessosQueryDto,
  SincronizarProcessoDto,
} from './dto/processos.dto';

interface Ctx {
  ip?: string;
  userAgent?: string;
  userId?: string;
}

/** LGPD: nas listas mostramos só o mínimo do filiado (nome/matrícula). */
const filiadoSel = { select: { id: true, nomeCompleto: true, matricula: true } } as const;
const advogadoSel = { select: { id: true, nome: true } } as const;

@Injectable()
export class ProcessosService {
  private readonly logger = new Logger(ProcessosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly datajud: DatajudService,
  ) {}

  // -------------------------------------------------------------------------
  // Sincronização: consulta o DATAJUD e ESPELHA (cache) no banco local.
  // -------------------------------------------------------------------------

  async sincronizar(dto: SincronizarProcessoDto, ctx: Ctx) {
    if (dto.filiadoId) await this.garantir('filiado', dto.filiadoId);
    if (dto.advogadoId) await this.garantir('user', dto.advogadoId);

    const dados = await this.datajud.buscarProcessoPorNPU(dto.numeroCNJ, dto.tribunal);
    if (!dados) {
      throw new NotFoundException('Processo não localizado no DATAJUD para o tribunal informado.');
    }

    const numero = dados.numeroCNJ;
    const metadados = {
      classeProcessual: dados.classeProcessual,
      assuntoPrincipal: dados.assuntoPrincipal,
      orgaoJulgador: dados.orgaoJulgador,
      tribunal: dados.tribunal ?? dto.tribunal.toUpperCase(),
      dataDistribuicao: dados.dataDistribuicao ? new Date(dados.dataDistribuicao) : null,
      valorCausa: dados.valorCausa ?? null,
      grau: dados.grau,
      ultimaSincronizacao: new Date(),
    };

    const existente = await this.prisma.processo.findUnique({ where: { numeroCNJ: numero }, select: { id: true } });

    const processo = await this.prisma.$transaction(async (tx) => {
      const p = await tx.processo.upsert({
        where: { numeroCNJ: numero },
        create: {
          numeroCNJ: numero,
          filiadoId: dto.filiadoId || null,
          advogadoId: dto.advogadoId || null,
          statusInterno: dto.statusInterno ?? undefined,
          ...metadados,
        },
        update: {
          ...(dto.filiadoId !== undefined ? { filiadoId: dto.filiadoId || null } : {}),
          ...(dto.advogadoId !== undefined ? { advogadoId: dto.advogadoId || null } : {}),
          ...(dto.statusInterno ? { statusInterno: dto.statusInterno } : {}),
          ...metadados,
        },
      });

      // Cache das movimentações: substitui o conjunto (apaga e regrava).
      await tx.movimentacaoProcessual.deleteMany({ where: { processoId: p.id } });
      if (dados.movimentacoes.length) {
        await tx.movimentacaoProcessual.createMany({
          data: dados.movimentacoes.map((m) => ({
            processoId: p.id,
            dataMovimento: new Date(m.dataMovimento),
            descricao: m.descricao,
            codigoMovimento: m.codigoMovimento,
          })),
        });
      }
      return p;
    });

    await this.audit.registrar({
      userId: ctx.userId ?? null,
      acao: existente ? AcaoAuditoria.UPDATE : AcaoAuditoria.CREATE,
      entidade: 'Processo',
      entidadeId: processo.id,
      descricao: `Processo ${numero} sincronizado do DATAJUD (${metadados.tribunal}, ${dados.movimentacoes.length} mov.)`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { numeroCNJ: numero, tribunal: metadados.tribunal, movimentacoes: dados.movimentacoes.length },
    });

    return this.detalhe(processo.id);
  }

  // -------------------------------------------------------------------------
  // Listagem (cache local — sem consulta ao vivo) + filtros e paginação
  // -------------------------------------------------------------------------

  async listar(q: ListProcessosQueryDto) {
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(100, Math.max(5, Number(q.pageSize) || 20));
    const and: Prisma.ProcessoWhereInput[] = [];
    if (q.statusInterno) and.push({ statusInterno: q.statusInterno });
    if (q.tribunal) and.push({ tribunal: { equals: q.tribunal, mode: 'insensitive' } });
    if (q.filiadoId) and.push({ filiadoId: q.filiadoId });
    if (q.advogadoId) and.push({ advogadoId: q.advogadoId });
    const busca = q.busca?.trim();
    if (busca) {
      and.push({
        OR: [
          { numeroCNJ: { contains: busca.replace(/\D/g, '') || busca } },
          { classeProcessual: { contains: busca, mode: 'insensitive' } },
          { assuntoPrincipal: { contains: busca, mode: 'insensitive' } },
          { filiado: { nomeCompleto: { contains: busca, mode: 'insensitive' } } },
        ],
      });
    }
    const where: Prisma.ProcessoWhereInput = and.length ? { AND: and } : {};

    const [total, items] = await this.prisma.$transaction([
      this.prisma.processo.count({ where }),
      this.prisma.processo.findMany({
        where,
        orderBy: { ultimaSincronizacao: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, numeroCNJ: true, classeProcessual: true, assuntoPrincipal: true,
          orgaoJulgador: true, tribunal: true, grau: true, dataDistribuicao: true,
          valorCausa: true, statusInterno: true, ultimaSincronizacao: true,
          filiado: filiadoSel, advogado: advogadoSel,
          _count: { select: { movimentacoes: true } },
        },
      }),
    ]);

    return { items, total, page, pageSize, totalPaginas: Math.max(1, Math.ceil(total / pageSize)) };
  }

  async detalhe(id: string) {
    const processo = await this.prisma.processo.findUnique({
      where: { id },
      include: {
        filiado: filiadoSel,
        advogado: advogadoSel,
        movimentacoes: { orderBy: { dataMovimento: 'desc' } },
      },
    });
    if (!processo) throw new NotFoundException('Processo não encontrado.');
    return processo;
  }

  async atualizar(id: string, dto: AtualizarProcessoDto, ctx: Ctx) {
    const atual = await this.prisma.processo.findUnique({ where: { id }, select: { id: true } });
    if (!atual) throw new NotFoundException('Processo não encontrado.');
    if (dto.filiadoId) await this.garantir('filiado', dto.filiadoId);
    if (dto.advogadoId) await this.garantir('user', dto.advogadoId);

    await this.prisma.processo.update({
      where: { id },
      data: {
        statusInterno: dto.statusInterno,
        filiadoId: dto.filiadoId === undefined ? undefined : dto.filiadoId || null,
        advogadoId: dto.advogadoId === undefined ? undefined : dto.advogadoId || null,
      },
    });
    await this.audit.registrar({
      userId: ctx.userId ?? null, acao: AcaoAuditoria.UPDATE, entidade: 'Processo', entidadeId: id,
      descricao: 'Dados internos do processo atualizados', ip: ctx.ip, userAgent: ctx.userAgent, metadata: {},
    });
    return this.detalhe(id);
  }

  private async garantir(tipo: 'filiado' | 'user', id: string) {
    const achou =
      tipo === 'filiado'
        ? await this.prisma.filiado.findUnique({ where: { id }, select: { id: true } })
        : await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!achou) throw new BadRequestException(`${tipo === 'filiado' ? 'Filiado' : 'Advogado'} inválido.`);
  }
}
