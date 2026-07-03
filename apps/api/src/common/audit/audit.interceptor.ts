import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AcaoAuditoria } from '@prisma/client';
import { AuditService } from './audit.service';

const METODO_ACAO: Record<string, AcaoAuditoria | undefined> = {
  POST: AcaoAuditoria.CREATE,
  PUT: AcaoAuditoria.UPDATE,
  PATCH: AcaoAuditoria.UPDATE,
  DELETE: AcaoAuditoria.DELETE,
};

/**
 * Registra automaticamente operações de escrita (POST/PUT/PATCH/DELETE)
 * na tabela de auditoria. Login/logout/validação de QR são registrados
 * explicitamente em seus respectivos serviços.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const acao = METODO_ACAO[req.method];

    return next.handle().pipe(
      tap(() => {
        if (!acao) return;
        // Não bloqueia a resposta — registro best-effort.
        void this.audit
          .registrar({
            userId: req.user?.id ?? null,
            acao,
            entidade: req.route?.path,
            descricao: `${req.method} ${req.originalUrl}`,
            ip: req.ip,
            userAgent: req.headers['user-agent'],
          })
          .catch(() => undefined);
      }),
    );
  }
}
