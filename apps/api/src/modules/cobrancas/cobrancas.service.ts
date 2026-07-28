import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AcaoAuditoria, StatusParcela, TipoCobranca } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { gerarPixCopiaECola } from '../../common/utils/pix.util';
import {
  ConfiguracaoSindicatoDto,
  GravarCobrancaDto,
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
  // 4) Baixa manual de parcela
  // -------------------------------------------------------------------------

  async baixarParcela(id: string, ctx: Ctx) {
    const parcela = await this.prisma.parcelaCobranca.findUnique({ where: { id } });
    if (!parcela) throw new NotFoundException('Parcela não encontrada.');
    if (parcela.status === StatusParcela.CANCELADO)
      throw new BadRequestException('Parcela cancelada não pode receber baixa.');
    if (parcela.status === StatusParcela.PAGO) return parcela; // idempotente

    const atualizada = await this.prisma.parcelaCobranca.update({
      where: { id },
      data: { status: StatusParcela.PAGO, dataPagamento: new Date() },
    });
    await this.audit.registrar({
      userId: ctx.userId ?? null,
      acao: AcaoAuditoria.UPDATE,
      entidade: 'ParcelaCobranca',
      entidadeId: id,
      descricao: `Baixa manual da parcela ${parcela.numero} (R$ ${Number(parcela.valor).toFixed(2)})`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { cobrancaId: parcela.cobrancaId },
    });
    return atualizada;
  }

  // -------------------------------------------------------------------------
  // 5) Exclusão/cancelamento de parcela (regra rígida: PAGO não pode)
  // -------------------------------------------------------------------------

  async excluirParcela(id: string, ctx: Ctx) {
    const parcela = await this.prisma.parcelaCobranca.findUnique({ where: { id } });
    if (!parcela) throw new NotFoundException('Parcela não encontrada.');
    if (parcela.status === StatusParcela.PAGO)
      throw new BadRequestException('Parcela já PAGA não pode ser excluída ou cancelada.');
    if (parcela.status === StatusParcela.CANCELADO) return parcela;

    // Cancelamento lógico (preserva o histórico financeiro para auditoria/LGPD).
    const cancelada = await this.prisma.parcelaCobranca.update({
      where: { id },
      data: { status: StatusParcela.CANCELADO },
    });
    await this.audit.registrar({
      userId: ctx.userId ?? null,
      acao: AcaoAuditoria.DELETE,
      entidade: 'ParcelaCobranca',
      entidadeId: id,
      descricao: `Parcela ${parcela.numero} cancelada`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { cobrancaId: parcela.cobrancaId },
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
    return {
      parcelaId: parcela.id,
      numero: parcela.numero,
      valor: Number(parcela.valor),
      identificador,
      copiaECola,
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
