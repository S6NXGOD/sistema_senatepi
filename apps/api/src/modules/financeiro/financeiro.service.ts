import { Injectable } from '@nestjs/common';
import { AcaoAuditoria } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { CriarContaBancariaDto } from './dto/financeiro.dto';

interface Ctx {
  ip?: string;
  userAgent?: string;
  userId?: string;
}

@Injectable()
export class FinanceiroService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Contas ativas para seleção (baixa de parcelas, lançamentos). */
  listarContas() {
    return this.prisma.contaBancaria.findMany({
      where: { ativo: true },
      orderBy: { nome: 'asc' },
      select: { id: true, nome: true, instituicao: true },
    });
  }

  async criarConta(dto: CriarContaBancariaDto, ctx: Ctx) {
    const conta = await this.prisma.contaBancaria.create({
      data: { nome: dto.nome.trim(), instituicao: dto.instituicao?.trim() || null },
    });
    await this.audit.registrar({
      userId: ctx.userId ?? null,
      acao: AcaoAuditoria.CREATE,
      entidade: 'ContaBancaria',
      entidadeId: conta.id,
      descricao: `Conta bancária criada: ${conta.nome}`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: {},
    });
    return conta;
  }
}
