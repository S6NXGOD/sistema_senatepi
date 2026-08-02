import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AcaoAuditoria, Prisma, StatusParcela, TipoCobranca, TipoMovimentacao } from '@prisma/client';
import * as QRCode from 'qrcode';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { gerarPixCopiaECola } from '../../common/utils/pix.util';
import {
  BaixarParcelaDto,
  ConfiguracaoSindicatoDto,
  GravarCobrancaDto,
  ListarParcelasQueryDto,
  ListarPorFiliadoQueryDto,
  SimularCobrancaDto,
} from './dto/cobrancas.dto';

/** Contexto de request para auditoria (ip/user-agent/usuário logado). */
interface Ctx {
  ip?: string;
  userAgent?: string;
  userId?: string;
}

@Injectable()
export class CobrancasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------------
  // Helpers de data e dinheiro
  // -------------------------------------------------------------------------

  /** Soma `months` a uma data "YYYY-MM-DD", ajustando o dia ao fim do mês. */
  private addMonthsISO(iso: string, months: number): string {
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
    const idx = m - 1 + months;
    const ty = y + Math.floor(idx / 12);
    const tm = ((idx % 12) + 12) % 12;
    const ultimoDia = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
    const td = Math.min(d, ultimoDia);
    return new Date(Date.UTC(ty, tm, td)).toISOString().slice(0, 10);
  }

  /** Converte "YYYY-MM-DD" em Date (meia-noite UTC) para colunas @db.Date. */
  private paraData(iso: string): Date {
    return new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
  }

  /** Divide o total em N parcelas em centavos (distribui o resto nas primeiras). */
  private dividirValor(valorTotal: number, n: number): number[] {
    const totalCents = Math.round(valorTotal * 100);
    const base = Math.floor(totalCents / n);
    const resto = totalCents - base * n;
    return Array.from({ length: n }, (_, i) => (base + (i < resto ? 1 : 0)) / 100);
  }

  private hojeUTC(): Date {
    const n = new Date();
    return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
  }

  private arred(x: number): number {
    return Number(x.toFixed(2));
  }

  // -------------------------------------------------------------------------
  // 1) Simulação (não persiste)
  // -------------------------------------------------------------------------

  simular(dto: SimularCobrancaDto) {
    const valores = this.dividirValor(dto.valorTotal, dto.quantidadeParcelas);
    const parcelas = valores.map((valor, i) => ({
      numero: i + 1,
      dataCompetencia: this.addMonthsISO(dto.dataCompetenciaInicial, i),
      dataVencimento: this.addMonthsISO(dto.dataVencimentoInicial, i),
      valor,
      status: StatusParcela.PENDENTE,
    }));
    return {
      tipo: dto.tipo ?? TipoCobranca.MENSALIDADE,
      quantidadeParcelas: dto.quantidadeParcelas,
      valorTotal: this.arred(parcelas.reduce((s, p) => s + p.valor, 0)),
      parcelas,
    };
  }

  // -------------------------------------------------------------------------
  // 2) Gravação (cobrança pai + parcelas em transação)
  // -------------------------------------------------------------------------

  async gravar(dto: GravarCobrancaDto, ctx: Ctx) {
    const filiado = await this.prisma.filiado.findUnique({
      where: { id: dto.filiadoId },
      select: { id: true, nomeCompleto: true },
    });
    if (!filiado) throw new NotFoundException('Filiado não encontrado.');

    const parcelas = dto.parcelas.map((p, i) => ({
      numero: p.numero ?? i + 1,
      dataCompetencia: this.paraData(p.dataCompetencia),
      dataVencimento: this.paraData(p.dataVencimento),
      valor: p.valor,
    }));
    const valorTotal = this.arred(parcelas.reduce((s, p) => s + p.valor, 0));

    const cobranca = await this.prisma.$transaction((tx) =>
      tx.cobranca.create({
        data: {
          filiadoId: filiado.id,
          tipo: dto.tipo ?? TipoCobranca.MENSALIDADE,
          descricao: dto.descricao,
          valorTotal,
          criadaPor: ctx.userId,
          parcelas: { create: parcelas },
        },
        include: { parcelas: { orderBy: { numero: 'asc' } } },
      }),
    );

    await this.audit.registrar({
      userId: ctx.userId ?? null,
      acao: AcaoAuditoria.CREATE,
      entidade: 'Cobranca',
      entidadeId: cobranca.id,
      descricao: `Cobrança gerada (${parcelas.length} parcela[s], total R$ ${valorTotal.toFixed(2)}) para ${filiado.nomeCompleto}`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { filiadoId: filiado.id, parcelas: parcelas.length, valorTotal },
    });

    return cobranca;
  }

  // -------------------------------------------------------------------------
  // 3) Histórico financeiro do filiado (LGPD: só o necessário para gestão)
  // -------------------------------------------------------------------------

  async historicoFiliado(filiadoId: string) {
    const filiado = await this.prisma.filiado.findUnique({
      where: { id: filiadoId },
      // LGPD (Lei 13.709/2018): apenas identificação mínima p/ gestão financeira.
      select: { id: true, nomeCompleto: true, matricula: true },
    });
    if (!filiado) throw new NotFoundException('Filiado não encontrado.');

    const cobrancas = await this.prisma.cobranca.findMany({
      where: { filiadoId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        tipo: true,
        descricao: true,
        valorTotal: true,
        createdAt: true,
        parcelas: {
          orderBy: { numero: 'asc' },
          select: {
            id: true,
            numero: true,
            dataCompetencia: true,
            dataVencimento: true,
            valor: true,
            status: true,
            dataPagamento: true,
          },
        },
      },
    });

    const resumo = this.resumoFinanceiro(cobrancas.flatMap((c) => c.parcelas), this.hojeUTC());
    return { filiado, cobrancas, resumo };
  }

  /**
   * O filiado está em dia com a contribuição?
   *
   * Existe para que OUTROS módulos (hoje o check-in do Plenário Virtual)
   * consultem a adimplência sem reimplementar o critério. A definição de
   * "vencida" vive num lugar só — `resumoFinanceiro`, logo abaixo — e é
   * `status = VENCIDO` OU `pendente com vencimento já passado`.
   *
   * Uma segunda implementação em outro módulo divergiria com o tempo, e no dia
   * em que divergisse alguém seria barrado numa assembleia por um critério que
   * o financeiro não reconhece. Por isso este método é público e aquele
   * continua privado.
   *
   * Quem não tem cobrança nenhuma é considerado ADIMPLENTE: a ausência de
   * carnê é o caso da maioria da base histórica, e tratá-la como dívida
   * barraria da assembleia justamente quem nunca deveu nada.
   */
  async situacaoFinanceira(filiadoId: string) {
    const parcelas = await this.prisma.parcelaCobranca.findMany({
      where: { cobranca: { filiadoId } },
      select: { valor: true, status: true, dataVencimento: true },
    });

    const resumo = this.resumoFinanceiro(parcelas, this.hojeUTC());
    return {
      adimplente: resumo.qtdVencido === 0,
      parcelasVencidas: resumo.qtdVencido,
      totalVencido: resumo.totalVencido,
      temCobrancas: parcelas.length > 0,
    };
  }

  /** Consolida totais por situação (vencido = em aberto além do vencimento). */
  private resumoFinanceiro(
    parcelas: { valor: unknown; status: StatusParcela; dataVencimento: Date }[],
    hoje: Date,
  ) {
    let totalPago = 0;
    let totalEmAberto = 0;
    let totalVencido = 0;
    let qtdPago = 0;
    let qtdPendente = 0;
    let qtdVencido = 0;
    let qtdCancelado = 0;

    for (const p of parcelas) {
      const v = Number(p.valor);
      if (p.status === StatusParcela.PAGO) {
        totalPago += v;
        qtdPago++;
      } else if (p.status === StatusParcela.CANCELADO) {
        qtdCancelado++;
      } else {
        const vencida = p.status === StatusParcela.VENCIDO || new Date(p.dataVencimento) < hoje;
        if (vencida) {
          totalVencido += v;
          qtdVencido++;
        } else {
          totalEmAberto += v;
          qtdPendente++;
        }
      }
    }

    return {
      qtdParcelas: parcelas.length,
      qtdPago,
      qtdPendente,
      qtdVencido,
      qtdCancelado,
      totalPago: this.arred(totalPago),
      totalEmAberto: this.arred(totalEmAberto),
      totalVencido: this.arred(totalVencido),
    };
  }

  // -------------------------------------------------------------------------
  // Lista GERAL de parcelas (gestão) com filtros: status, mês, busca por filiado.
  // LGPD: só campos necessários à gestão/cobrança (inclui telefone p/ WhatsApp).
  // -------------------------------------------------------------------------

  async listarParcelas(filtro: ListarParcelasQueryDto) {
    const hoje = this.hojeUTC();
    const and: Prisma.ParcelaCobrancaWhereInput[] = [];

    // "Vencida" = pendente cujo vencimento já passou; "pendente" = a vencer.
    if (filtro.status === StatusParcela.PAGO) and.push({ status: StatusParcela.PAGO });
    else if (filtro.status === StatusParcela.CANCELADO) and.push({ status: StatusParcela.CANCELADO });
    else if (filtro.status === StatusParcela.PENDENTE)
      and.push({ status: StatusParcela.PENDENTE, dataVencimento: { gte: hoje } });
    else if (filtro.status === StatusParcela.VENCIDO)
      and.push({
        status: { in: [StatusParcela.PENDENTE, StatusParcela.VENCIDO] },
        dataVencimento: { lt: hoje },
      });

    if (filtro.mes && /^\d{4}-\d{2}$/.test(filtro.mes)) {
      const [y, m] = filtro.mes.split('-').map(Number);
      and.push({
        dataVencimento: { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) },
      });
    }

    const busca = filtro.busca?.trim();
    if (busca) {
      and.push({
        cobranca: {
          filiado: {
            OR: [
              { nomeCompleto: { contains: busca, mode: 'insensitive' } },
              { matricula: { contains: busca, mode: 'insensitive' } },
              { cpf: { contains: busca.replace(/\D/g, '') || busca } },
            ],
          },
        },
      });
    }

    const parcelas = await this.prisma.parcelaCobranca.findMany({
      where: and.length ? { AND: and } : {},
      orderBy: [{ dataVencimento: 'asc' }, { numero: 'asc' }],
      take: 300,
      select: {
        id: true,
        numero: true,
        valor: true,
        dataCompetencia: true,
        dataVencimento: true,
        status: true,
        dataPagamento: true,
        cobrancaId: true,
        cobranca: {
          select: {
            tipo: true,
            filiado: {
              select: { id: true, nomeCompleto: true, matricula: true, telefonePrincipal: true },
            },
          },
        },
      },
    });

    return parcelas.map((p) => ({
      id: p.id,
      numero: p.numero,
      valor: p.valor,
      dataCompetencia: p.dataCompetencia,
      dataVencimento: p.dataVencimento,
      status: p.status,
      dataPagamento: p.dataPagamento,
      cobrancaId: p.cobrancaId,
      tipo: p.cobranca.tipo,
      filiado: p.cobranca.filiado,
    }));
  }

  // -------------------------------------------------------------------------
  // Lista AGRUPADA POR FILIADO (paginada) — escala p/ milhares de filiados.
  // Agrega em SQL (JOIN + GROUP BY) e devolve só os totais/contagens de cada
  // filiado, ordenando os inadimplentes primeiro. LGPD: nome/matrícula/telefone
  // (necessários à gestão/contato), sem demais dados pessoais.
  // -------------------------------------------------------------------------

  async listarPorFiliado(q: ListarPorFiliadoQueryDto) {
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(100, Math.max(5, Number(q.pageSize) || 20));
    const offset = (page - 1) * pageSize;
    const hoje = this.hojeUTC();
    const busca = q.busca?.trim();

    const buscaSql = busca
      ? Prisma.sql`AND (f.nome_completo ILIKE ${`%${busca}%`} OR f.matricula ILIKE ${`%${busca}%`}${
          busca.replace(/\D/g, '')
            ? Prisma.sql` OR f.cpf ILIKE ${`%${busca.replace(/\D/g, '')}%`}`
            : Prisma.empty
        })`
      : Prisma.empty;

    // "Vencida" = VENCIDO ou PENDENTE já passado do vencimento.
    const vencidoExpr = Prisma.sql`(p.status = 'VENCIDO' OR (p.status = 'PENDENTE' AND p.data_vencimento < ${hoje}))`;
    const somenteInadimplentes = q.inadimplentes === 'true';
    const havingSql = somenteInadimplentes
      ? Prisma.sql`HAVING SUM(CASE WHEN ${vencidoExpr} THEN p.valor ELSE 0 END) > 0`
      : Prisma.sql`HAVING COUNT(p.id) FILTER (WHERE p.status <> 'CANCELADO') > 0`;

    const base = Prisma.sql`
      FROM filiados f
      JOIN cobrancas c ON c.filiado_id = f.id
      JOIN parcelas_cobranca p ON p.cobranca_id = c.id
      WHERE 1 = 1 ${buscaSql}
      GROUP BY f.id
      ${havingSql}
    `;

    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string; nome_completo: string; matricula: string; telefone_principal: string | null;
        qtd: number; qtd_vencidas: number;
        total_aberto: string; total_vencido: string; total_pago: string;
        proximo_vencimento: Date | null;
      }>
    >(Prisma.sql`
      SELECT f.id, f.nome_completo, f.matricula, f.telefone_principal,
        COUNT(p.id) FILTER (WHERE p.status <> 'CANCELADO')::int AS qtd,
        COUNT(p.id) FILTER (WHERE ${vencidoExpr})::int AS qtd_vencidas,
        COALESCE(SUM(p.valor) FILTER (WHERE p.status = 'PENDENTE' AND p.data_vencimento >= ${hoje}), 0) AS total_aberto,
        COALESCE(SUM(p.valor) FILTER (WHERE ${vencidoExpr}), 0) AS total_vencido,
        COALESCE(SUM(COALESCE(p.valor_pago, p.valor)) FILTER (WHERE p.status = 'PAGO'), 0) AS total_pago,
        MIN(p.data_vencimento) FILTER (WHERE p.status IN ('PENDENTE', 'VENCIDO')) AS proximo_vencimento
      ${base}
      ORDER BY total_vencido DESC, total_aberto DESC, f.nome_completo ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `);

    const totalRows = await this.prisma.$queryRaw<Array<{ total: number }>>(
      Prisma.sql`SELECT COUNT(*)::int AS total FROM (SELECT f.id ${base}) sub`,
    );
    const total = Number(totalRows[0]?.total ?? 0);

    return {
      items: rows.map((r) => ({
        filiadoId: r.id,
        nomeCompleto: r.nome_completo,
        matricula: r.matricula,
        telefonePrincipal: r.telefone_principal,
        qtdParcelas: Number(r.qtd),
        qtdVencidas: Number(r.qtd_vencidas),
        totalEmAberto: this.arred(Number(r.total_aberto)),
        totalVencido: this.arred(Number(r.total_vencido)),
        totalPago: this.arred(Number(r.total_pago)),
        proximoVencimento: r.proximo_vencimento,
      })),
      total,
      page,
      pageSize,
      totalPaginas: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  // -------------------------------------------------------------------------
  // Exclusão de uma COBRANÇA inteira (contrato + parcelas). Regra: não pode se
  // houver parcela PAGA (existe lançamento financeiro atrelado).
  // -------------------------------------------------------------------------

  async excluirCobranca(id: string, ctx: Ctx, force = false) {
    const cobranca = await this.prisma.cobranca.findUnique({
      where: { id },
      include: {
        parcelas: { select: { status: true, movimentacaoId: true } },
        filiado: { select: { nomeCompleto: true } },
      },
    });
    if (!cobranca) throw new NotFoundException('Cobrança não encontrada.');

    const pagas = cobranca.parcelas.filter((p) => p.status === StatusParcela.PAGO);
    // Sem force: mantém a trava. Com force (só o Administrador chega ao DELETE): exclui
    // mesmo com parcela paga, removendo os lançamentos financeiros vinculados.
    if (pagas.length && !force) {
      throw new BadRequestException(
        'Esta cobrança possui parcela(s) já paga(s) e não pode ser excluída (há lançamento financeiro registrado).',
      );
    }

    const movIds = cobranca.parcelas
      .map((p) => p.movimentacaoId)
      .filter((x): x is string => !!x);

    await this.prisma.$transaction(async (tx) => {
      await tx.cobranca.delete({ where: { id } }); // cascade remove as parcelas
      if (movIds.length) {
        // Remove as movimentações financeiras vinculadas (o saldo é recalculado).
        await tx.movimentacao.deleteMany({ where: { id: { in: movIds } } });
      }
    });

    const forcado = pagas.length > 0 && force;
    await this.audit.registrar({
      userId: ctx.userId ?? null,
      acao: AcaoAuditoria.DELETE,
      entidade: 'Cobranca',
      entidadeId: id,
      descricao: forcado
        ? `Cobrança EXCLUÍDA À FORÇA (${cobranca.parcelas.length} parcela[s], ${pagas.length} paga[s], ${movIds.length} lançamento[s] financeiro[s] removido[s]) de ${cobranca.filiado.nomeCompleto}`
        : `Cobrança excluída (${cobranca.parcelas.length} parcela[s]) de ${cobranca.filiado.nomeCompleto}`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: {
        filiadoId: cobranca.filiadoId,
        parcelas: cobranca.parcelas.length,
        forcado,
        movimentacoesRemovidas: movIds.length,
      },
    });
    return { ok: true, removidas: cobranca.parcelas.length, movimentacoesRemovidas: movIds.length };
  }

  // -------------------------------------------------------------------------
  // Robô de vencimentos: PENDENTE com vencimento < hoje vira VENCIDO (em lote).
  // -------------------------------------------------------------------------

  async marcarParcelasVencidas() {
    const { count } = await this.prisma.parcelaCobranca.updateMany({
      where: { status: StatusParcela.PENDENTE, dataVencimento: { lt: this.hojeUTC() } },
      data: { status: StatusParcela.VENCIDO },
    });
    return count;
  }

  // -------------------------------------------------------------------------
  // 4) Baixa REALISTA da parcela + integração financeira (transação)
  //    - registra valor efetivamente pago (juros/desconto)
  //    - cria a Movimentação de ENTRADA na conta escolhida e vincula à parcela
  // -------------------------------------------------------------------------

  async baixarParcela(id: string, dto: BaixarParcelaDto, ctx: Ctx) {
    const parcela = await this.prisma.parcelaCobranca.findUnique({
      where: { id },
      include: {
        cobranca: {
          select: {
            filiado: { select: { nomeCompleto: true } },
            _count: { select: { parcelas: true } },
          },
        },
      },
    });
    if (!parcela) throw new NotFoundException('Parcela não encontrada.');
    if (parcela.status === StatusParcela.CANCELADO)
      throw new BadRequestException('Parcela cancelada não pode receber baixa.');
    if (parcela.status === StatusParcela.PAGO)
      throw new BadRequestException('Parcela já está paga.');

    const conta = await this.prisma.contaBancaria.findUnique({ where: { id: dto.contaBancariaId } });
    if (!conta || !conta.ativo)
      throw new BadRequestException('Conta bancária de destino inválida ou inativa.');

    const valorPago = Number(dto.valorPago);
    const total = parcela.cobranca._count.parcelas;
    const nome = parcela.cobranca.filiado.nomeCompleto;

    const atualizada = await this.prisma.$transaction(async (tx) => {
      // 1) Movimentação financeira de ENTRADA na conta escolhida.
      const mov = await tx.movimentacao.create({
        data: {
          contaBancariaId: conta.id,
          tipo: TipoMovimentacao.ENTRADA,
          valor: valorPago,
          descricao: `Recebimento Parcela ${parcela.numero}/${total} - ${nome}`,
          origem: 'COBRANCA',
          criadaPor: ctx.userId,
        },
      });
      // 2) Baixa a parcela, guardando o valor real e o vínculo com a movimentação.
      return tx.parcelaCobranca.update({
        where: { id },
        data: {
          status: StatusParcela.PAGO,
          dataPagamento: new Date(),
          valorPago,
          movimentacaoId: mov.id,
        },
      });
    });

    await this.audit.registrar({
      userId: ctx.userId ?? null,
      acao: AcaoAuditoria.UPDATE,
      entidade: 'ParcelaCobranca',
      entidadeId: id,
      descricao: `Baixa da parcela ${parcela.numero} (recebido R$ ${valorPago.toFixed(2)}) → conta ${conta.nome}`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { cobrancaId: parcela.cobrancaId, contaBancariaId: conta.id, movimentacaoId: atualizada.movimentacaoId },
    });
    return atualizada;
  }

  // -------------------------------------------------------------------------
  // Mini-dashboard de inadimplência (mês corrente, por vencimento) — só agregados
  // (LGPD: nenhum dado pessoal é retornado, apenas somatórios/contagens).
  // -------------------------------------------------------------------------

  async dashboard() {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const ini = new Date(Date.UTC(y, m, 1));
    const fim = new Date(Date.UTC(y, m + 1, 1));
    const hoje = this.hojeUTC();

    const parcelas = await this.prisma.parcelaCobranca.findMany({
      where: { dataVencimento: { gte: ini, lt: fim }, status: { not: StatusParcela.CANCELADO } },
      select: { valor: true, valorPago: true, status: true, dataVencimento: true },
    });

    let receitaPrevista = 0;
    let receitaRealizada = 0;
    let totalVencido = 0;
    let qtdVencido = 0;

    for (const p of parcelas) {
      const v = Number(p.valor);
      if (p.status === StatusParcela.PAGO) {
        receitaRealizada += Number(p.valorPago ?? p.valor);
      } else {
        const venceu = p.status === StatusParcela.VENCIDO || new Date(p.dataVencimento) < hoje;
        if (venceu) {
          totalVencido += v;
          qtdVencido++;
        } else {
          receitaPrevista += v;
        }
      }
    }

    const base = receitaPrevista + receitaRealizada + totalVencido;
    const taxaInadimplencia = base > 0 ? Number(((totalVencido / base) * 100).toFixed(1)) : 0;

    return {
      mes: `${y}-${String(m + 1).padStart(2, '0')}`,
      receitaPrevista: this.arred(receitaPrevista),
      receitaRealizada: this.arred(receitaRealizada),
      totalVencido: this.arred(totalVencido),
      qtdVencido,
      qtdMes: parcelas.length,
      taxaInadimplencia,
    };
  }

  // -------------------------------------------------------------------------
  // 5) Exclusão/cancelamento de parcela (regra rígida: PAGO não pode)
  // -------------------------------------------------------------------------

  async excluirParcela(id: string, ctx: Ctx, force = false) {
    const parcela = await this.prisma.parcelaCobranca.findUnique({ where: { id } });
    if (!parcela) throw new NotFoundException('Parcela não encontrada.');
    // Sem force: mantém a trava. Com force (Administrador): cancela mesmo PAGA,
    // removendo o lançamento financeiro vinculado.
    if (parcela.status === StatusParcela.PAGO && !force)
      throw new BadRequestException('Parcela já PAGA não pode ser excluída ou cancelada.');
    if (parcela.status === StatusParcela.CANCELADO) return parcela;

    const forcado = parcela.status === StatusParcela.PAGO && force;
    const cancelada = await this.prisma.$transaction(async (tx) => {
      if (forcado && parcela.movimentacaoId) {
        await tx.movimentacao.deleteMany({ where: { id: parcela.movimentacaoId } });
      }
      return tx.parcelaCobranca.update({
        where: { id },
        data: {
          status: StatusParcela.CANCELADO,
          ...(forcado ? { valorPago: null, dataPagamento: null, movimentacaoId: null } : {}),
        },
      });
    });
    await this.audit.registrar({
      userId: ctx.userId ?? null,
      acao: AcaoAuditoria.DELETE,
      entidade: 'ParcelaCobranca',
      entidadeId: id,
      descricao: forcado
        ? `Parcela ${parcela.numero} CANCELADA À FORÇA (lançamento financeiro removido)`
        : `Parcela ${parcela.numero} cancelada`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { cobrancaId: parcela.cobrancaId, forcado },
    });
    return cancelada;
  }

  // -------------------------------------------------------------------------
  // PIX Copia e Cola de uma parcela (usa a config + PixUtils)
  // -------------------------------------------------------------------------

  async gerarPixParcela(id: string) {
    const parcela = await this.prisma.parcelaCobranca.findUnique({
      where: { id },
      include: { cobranca: { include: { filiado: { select: { matricula: true } } } } },
    });
    if (!parcela) throw new NotFoundException('Parcela não encontrada.');

    const cfg = await this.obterConfig();
    if (!cfg?.pixChave)
      throw new BadRequestException('Configure a chave PIX do sindicato antes de gerar o carnê.');

    const identificador = `${parcela.cobranca.filiado.matricula ?? 'SENATEPI'}-${parcela.numero}`;
    const copiaECola = gerarPixCopiaECola({
      chave: cfg.pixChave,
      nome: cfg.pixNomeRecebedor ?? 'SENATEPI',
      cidade: cfg.pixCidade ?? 'TERESINA',
      valor: Number(parcela.valor),
      identificador,
    });
    // QR Code (PNG data URL) do próprio Copia e Cola — usado no carnê/impressão.
    const qrDataUrl = await QRCode.toDataURL(copiaECola, { width: 280, margin: 1 });
    return {
      parcelaId: parcela.id,
      numero: parcela.numero,
      valor: Number(parcela.valor),
      identificador,
      copiaECola,
      qrDataUrl,
    };
  }

  // -------------------------------------------------------------------------
  // Dados agregados para IMPRESSÃO do carnê (config + filiado + parcelas + PIX)
  // -------------------------------------------------------------------------

  async dadosCarne(cobrancaId: string) {
    const cobranca = await this.prisma.cobranca.findUnique({
      where: { id: cobrancaId },
      include: {
        filiado: { select: { nomeCompleto: true, cpf: true, matricula: true } },
        parcelas: { orderBy: { numero: 'asc' } },
      },
    });
    if (!cobranca) throw new NotFoundException('Cobrança não encontrada.');

    const cfg = await this.obterConfig();
    const totalParcelas = cobranca.parcelas.length;

    const parcelas = cobranca.parcelas.map((p) => {
      let copiaECola: string | null = null;
      if (cfg?.pixChave) {
        copiaECola = gerarPixCopiaECola({
          chave: cfg.pixChave,
          nome: cfg.pixNomeRecebedor ?? 'SENATEPI',
          cidade: cfg.pixCidade ?? 'TERESINA',
          valor: Number(p.valor),
          identificador: `${cobranca.filiado.matricula ?? 'SEN'}-${p.numero}`,
        });
      }
      return {
        id: p.id,
        numero: p.numero,
        valor: Number(p.valor),
        dataCompetencia: p.dataCompetencia,
        dataVencimento: p.dataVencimento,
        status: p.status,
        copiaECola,
      };
    });

    return {
      config: cfg
        ? {
            logoUrl: cfg.logoUrl,
            assinaturaPresidenteUrl: cfg.assinaturaPresidenteUrl,
            textoRodapeCarne: cfg.textoRodapeCarne,
            pixNomeRecebedor: cfg.pixNomeRecebedor,
            pixChave: cfg.pixChave,
          }
        : null,
      filiado: cobranca.filiado,
      cobranca: {
        id: cobranca.id,
        tipo: cobranca.tipo,
        descricao: cobranca.descricao,
        totalParcelas,
      },
      parcelas,
    };
  }

  // -------------------------------------------------------------------------
  // Configuração do sindicato (registro único)
  // -------------------------------------------------------------------------

  obterConfig() {
    return this.prisma.configuracaoSindicato.findFirst({ orderBy: { createdAt: 'asc' } });
  }

  async salvarConfig(dto: ConfiguracaoSindicatoDto, ctx: Ctx) {
    const existente = await this.obterConfig();
    const salvo = existente
      ? await this.prisma.configuracaoSindicato.update({ where: { id: existente.id }, data: dto })
      : await this.prisma.configuracaoSindicato.create({ data: dto });

    await this.audit.registrar({
      userId: ctx.userId ?? null,
      acao: AcaoAuditoria.UPDATE,
      entidade: 'ConfiguracaoSindicato',
      entidadeId: salvo.id,
      descricao: 'Configuração do sindicato (carnê/PIX) atualizada',
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: {},
    });
    return salvo;
  }
}
