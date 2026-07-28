import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AcaoAuditoria, Prisma, StatusParcela, TipoCobranca } from '@prisma/client';
import * as QRCode from 'qrcode';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { gerarPixCopiaECola } from '../../common/utils/pix.util';
import {
  ConfiguracaoSindicatoDto,
  GravarCobrancaDto,
  ListarParcelasQueryDto,
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
