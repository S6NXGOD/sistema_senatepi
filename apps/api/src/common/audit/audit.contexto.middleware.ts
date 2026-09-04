import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { comContextoDeAuditoria } from './audit.contexto';

/**
 * O ESCOPO DA REQUISIÇÃO, aberto onde ele realmente envolve tudo.
 *
 * Middleware, e não interceptor: `next.handle()` devolve um Observable frio, e
 * o handler só roda quando o Nest se inscreve — depois de `intercept()` ter
 * retornado, portanto FORA de um `AsyncLocalStorage.run()` aberto ali. Aqui o
 * `next()` é chamado dentro do escopo, e guardas, interceptors, controller e
 * serviços correm todos dentro dele.
 *
 * Isto é o que faz `marcarAuditadoPeloServico()` chegar ao `AuditInterceptor` —
 * sem ele, todo ato instrumentado gravava DUAS linhas: a frase do serviço e a
 * do interceptor logo atrás.
 */
@Injectable()
export class AuditContextoMiddleware implements NestMiddleware {
  use(_req: Request, _res: Response, next: NextFunction) {
    comContextoDeAuditoria(() => next());
  }
}
