import type { Request } from 'express';
import type { AuthUser } from '../decorators/current-user.decorator';

/**
 * QUEM, DE ONDE — o contexto que todo registro de auditoria precisa.
 *
 * Estava escrito à mão em cada controller que auditava, e faltando naqueles que
 * passavam só o NOME do autor (`@CurrentUser('nome')`). A diferença não é
 * cosmética: sem `userId` a linha do log fica sem dono, e o filtro "Quem" da
 * tela de auditoria não a encontra — a alteração existe e some da busca da
 * pessoa que a fez.
 */
export interface CtxAuditoria {
  ip?: string;
  userAgent?: string;
  userId?: string;
  role?: string;
}

export function ctxDaRequisicao(req?: Request, user?: AuthUser): CtxAuditoria {
  return {
    ip: req?.ip,
    userAgent: req?.headers?.['user-agent'] as string | undefined,
    userId: user?.id,
    role: user?.role,
  };
}
