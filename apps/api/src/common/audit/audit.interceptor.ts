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
import { comContextoDeAuditoria, jaFoiAuditadoPeloServico } from './audit.contexto';
import { fraseDaRota, valeAuditar } from './audit.frases';

const METODO_ACAO: Record<string, AcaoAuditoria | undefined> = {
  POST: AcaoAuditoria.CREATE,
  PUT: AcaoAuditoria.UPDATE,
  PATCH: AcaoAuditoria.UPDATE,
  DELETE: AcaoAuditoria.DELETE,
};

/**
 * O REGISTRO DE ÚLTIMO RECURSO.
 *
 * Ele existia como registro PADRÃO, e o resultado era um log em que metade das
 * linhas dizia `POST /api/processos/instancias/reavaliar?limite=10` — 52% dos
 * 2.973 registros da produção, medido em 04/09/2026. Isso não é auditoria, é
 * log de acesso: não diz o que mudou, não diz sobre quem, e ainda duplica o
 * serviço que já tinha escrito a frase certa para o mesmo ato.
 *
 * Agora ele só fala quando ninguém falou. E quando fala, fala em português.
 *
 * POR QUE NÃO SIMPLESMENTE APAGÁ-LO: uma rota de escrita que ninguém
 * instrumentou passaria a não deixar rastro nenhum — e é exatamente a rota
 * esquecida que se procura quando alguma coisa some do sistema. Cobertura
 * ruim é melhor que buraco.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const acao = METODO_ACAO[req.method];

    return comContextoDeAuditoria(() =>
      next.handle().pipe(
        tap(() => {
          if (!acao) return;
          // Alguém já contou melhor — ver `audit.contexto.ts`.
          if (jaFoiAuditadoPeloServico()) return;

          const caminho: string = req.route?.path ?? req.originalUrl ?? '';
          const url: string = req.originalUrl ?? caminho;
          // Renovação de token não é ato de ninguém — ver `NAO_AUDITAR`.
          if (!valeAuditar(url)) return;

          void this.audit
            .registrar({
              userId: req.user?.id ?? null,
              acao,
              entidade: caminho,
              // A mesma tabela que traduz os registros antigos na leitura, para
              // que a frase de hoje e a de ontem digam a mesma coisa.
              descricao: fraseDaRota(req.method, url),
              ip: req.ip,
              userAgent: req.headers['user-agent'],
              // A rota crua não some — ela é a pista técnica, e continua no
              // detalhe expandido. O que mudou é ela ter deixado de ser a
              // FRASE que a tela mostra.
              metadata: { rota: url, metodo: req.method },
            })
            .catch(() => undefined);
        }),
      ),
    );
  }
}
