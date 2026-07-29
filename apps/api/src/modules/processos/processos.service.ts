import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AcaoAuditoria, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { DatajudService, ParteDatajud, ProcessoDatajud } from './datajud.service';
import {
  AtualizarProcessoDto,
  ImportarProcessoDto,
  ListProcessosQueryDto,
} from './dto/processos.dto';
import { CpfMatcherUtils } from './utils/cpf-matcher.util';
import { NpuUtils } from './utils/npu.util';

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
  // 1) IMPORTAR (On-Demand): consulta o DATAJUD e CRIA o cache local.
  //    Se o processo já existe → 409 (use "Sincronizar" para atualizar).
  // -------------------------------------------------------------------------

  async importar(dto: ImportarProcessoDto, ctx: Ctx) {
    const numero = (dto.numeroCNJ || '').replace(/\D/g, '');
    if (numero.length !== 20) {
      throw new BadRequestException('NPU inválido — informe os 20 dígitos do número único (CNJ).');
    }

    // (a) Já existe localmente? → conflito.
    const existente = await this.prisma.processo.findUnique({
      where: { numeroCNJ: numero },
      select: { id: true },
    });
    if (existente) {
      throw new ConflictException(
        'Processo já importado — use "Sincronizar" para atualizar as movimentações.',
      );
    }

    if (dto.filiadoId) await this.garantir('filiado', dto.filiadoId);
    if (dto.advogadoId) await this.garantir('user', dto.advogadoId);

    // (b) Tribunal: usa o informado ou deriva do próprio NPU.
    const sigla = dto.tribunal?.trim() || NpuUtils.siglaTribunal(numero);
    if (!sigla) {
      throw new BadRequestException(
        'Não foi possível identificar o tribunal a partir do NPU; informe a sigla (ex.: TJPI, TRF1, TRT22).',
      );
    }

    // (c) Busca no DATAJUD (timeout/erros do CNJ tratados no DatajudService).
    const dados = await this.datajud.buscarProcessoPorNPU(numero, sigla);
    if (!dados) {
      throw new NotFoundException('Processo não localizado no DATAJUD para o tribunal informado.');
    }

    // (d) Cria Processo + Movimentações numa única transação.
    const processo = await this.prisma.$transaction(async (tx) => {
      const p = await tx.processo.create({
        data: {
          numeroCNJ: numero,
          filiadoId: dto.filiadoId || null,
          advogadoId: dto.advogadoId || null,
          statusInterno: dto.statusInterno ?? undefined,
          ...this.metadados(dados, sigla),
        },
      });
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
      acao: AcaoAuditoria.CREATE,
      entidade: 'Processo',
      entidadeId: processo.id,
      descricao: `Processo ${numero} importado do DATAJUD (${sigla.toUpperCase()}, ${dados.movimentacoes.length} mov.)`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { numeroCNJ: numero, tribunal: sigla.toUpperCase(), movimentacoes: dados.movimentacoes.length },
    });

    // (e) Resposta com partes desmascaradas (apenas o filiado vinculado — LGPD).
    const detalhe = await this.detalhe(processo.id);
    const partes = await this.desmascararPartes(dados.partes, dto.filiadoId);
    return { ...detalhe, partes };
  }

  // -------------------------------------------------------------------------
  // 3) RESSINCRONIZAR (PATCH /:id/sincronizar): rebusca no DATAJUD e insere
  //    APENAS as movimentações ausentes; atualiza `ultimaSincronizacao`.
  // -------------------------------------------------------------------------

  async ressincronizar(id: string, ctx: Ctx) {
    const proc = await this.prisma.processo.findUnique({
      where: { id },
      select: {
        id: true,
        numeroCNJ: true,
        tribunal: true,
        filiadoId: true,
        movimentacoes: { select: { dataMovimento: true, descricao: true, codigoMovimento: true } },
      },
    });
    if (!proc) throw new NotFoundException('Processo não encontrado.');

    const sigla = proc.tribunal?.trim() || NpuUtils.siglaTribunal(proc.numeroCNJ);
    if (!sigla) {
      throw new BadRequestException('Tribunal do processo desconhecido; não é possível sincronizar.');
    }

    const dados = await this.datajud.buscarProcessoPorNPU(proc.numeroCNJ, sigla);

    // Se o CNJ não devolveu nada agora, apenas registra a tentativa (sem apagar cache).
    if (!dados) {
      await this.prisma.processo.update({ where: { id }, data: { ultimaSincronizacao: new Date() } });
      return { ...(await this.detalhe(id)), novasMovimentacoes: 0 };
    }

    // Deduplicação por (timestamp | código | descrição).
    const chave = (dm: Date | string, cod: number | null | undefined, desc: string) =>
      `${new Date(dm).getTime()}|${cod ?? ''}|${desc}`;
    const existentes = new Set(
      proc.movimentacoes.map((m) => chave(m.dataMovimento, m.codigoMovimento, m.descricao)),
    );
    const novas = dados.movimentacoes.filter(
      (m) => !existentes.has(chave(m.dataMovimento, m.codigoMovimento, m.descricao)),
    );

    await this.prisma.$transaction(async (tx) => {
      if (novas.length) {
        await tx.movimentacaoProcessual.createMany({
          data: novas.map((m) => ({
            processoId: id,
            dataMovimento: new Date(m.dataMovimento),
            descricao: m.descricao,
            codigoMovimento: m.codigoMovimento,
          })),
        });
      }
      // Refresca metadados públicos + marca a sincronização.
      await tx.processo.update({ where: { id }, data: this.metadados(dados, sigla) });
    });

    await this.audit.registrar({
      userId: ctx.userId ?? null,
      acao: AcaoAuditoria.UPDATE,
      entidade: 'Processo',
      entidadeId: id,
      descricao: `Processo ${proc.numeroCNJ} sincronizado: ${novas.length} nova(s) movimentação(ões)`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { numeroCNJ: proc.numeroCNJ, novasMovimentacoes: novas.length },
    });

    const detalhe = await this.detalhe(id);
    const partes = await this.desmascararPartes(dados.partes, proc.filiadoId ?? undefined);
    return { ...detalhe, novasMovimentacoes: novas.length, partes };
  }

  // -------------------------------------------------------------------------
  // 2) Leituras 100% do cache local (instantâneas)
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

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Metadados públicos do DATAJUD prontos para gravar no Processo. */
  private metadados(dados: ProcessoDatajud, sigla: string) {
    return {
      classeProcessual: dados.classeProcessual,
      assuntoPrincipal: dados.assuntoPrincipal,
      orgaoJulgador: dados.orgaoJulgador,
      tribunal: dados.tribunal ?? sigla.toUpperCase(),
      dataDistribuicao: dados.dataDistribuicao ? new Date(dados.dataDistribuicao) : null,
      valorCausa: dados.valorCausa ?? null,
      grau: dados.grau,
      ultimaSincronizacao: new Date(),
    };
  }

  /**
   * Desmascara o CPF apenas da parte que corresponder ao filiado vinculado.
   * LGPD (Lei nº 13.709/2018): usa somente o CPF do próprio filiado (titular já
   * conhecido) com finalidade de representação/defesa jurídica. Terceiros ficam
   * mascarados.
   */
  private async desmascararPartes(
    partes: ParteDatajud[],
    filiadoId?: string,
  ): Promise<Array<ParteDatajud & { documentoDesmascarado?: boolean }>> {
    if (!Array.isArray(partes) || partes.length === 0) return [];
    const cpfFiliado = filiadoId ? await this.cpfDoFiliado(filiadoId) : null;
    return CpfMatcherUtils.aplicar(partes, cpfFiliado);
  }

  private async cpfDoFiliado(id: string): Promise<string | null> {
    const f = await this.prisma.filiado.findUnique({ where: { id }, select: { cpf: true } });
    return f?.cpf ?? null;
  }

  private async garantir(tipo: 'filiado' | 'user', id: string) {
    const achou =
      tipo === 'filiado'
        ? await this.prisma.filiado.findUnique({ where: { id }, select: { id: true } })
        : await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!achou) throw new BadRequestException(`${tipo === 'filiado' ? 'Filiado' : 'Advogado'} inválido.`);
  }
}
