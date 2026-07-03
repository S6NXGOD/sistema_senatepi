import { Injectable } from '@nestjs/common';
import { AcaoAuditoria, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface RegistroAuditoria {
  userId?: string | null;
  acao: AcaoAuditoria;
  entidade?: string;
  entidadeId?: string;
  descricao?: string;
  ip?: string;
  userAgent?: string;
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async registrar(dados: RegistroAuditoria): Promise<void> {
    await this.prisma.auditoria.create({
      data: {
        userId: dados.userId ?? null,
        acao: dados.acao,
        entidade: dados.entidade,
        entidadeId: dados.entidadeId,
        descricao: dados.descricao,
        ip: dados.ip,
        userAgent: dados.userAgent,
        metadata: dados.metadata,
      },
    });
  }
}
