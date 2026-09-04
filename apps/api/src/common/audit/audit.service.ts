import { Injectable } from '@nestjs/common';
import { AcaoAuditoria, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { marcarAuditadoPeloServico } from './audit.contexto';

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

  /**
   * Grava um ato no registro de auditoria.
   *
   * MARCAR É PARTE DE GRAVAR. Quem chama isto está contando o que aconteceu em
   * português; a partir daqui o `AuditInterceptor` cala a boca para esta
   * requisição, em vez de acrescentar uma segunda linha dizendo
   * `POST /api/...`. Era essa duplicação que fazia 52% do log ser ilegível.
   */
  async registrar(dados: RegistroAuditoria): Promise<void> {
    marcarAuditadoPeloServico();
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
