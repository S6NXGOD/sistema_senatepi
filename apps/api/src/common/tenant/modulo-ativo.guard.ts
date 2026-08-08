import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MODULO_TENANT_KEY } from './modulo-tenant.decorator';
import { MODULO_KEY } from '../permissions/modulo.decorator';
import { ModuloKey } from '../permissions/permissoes.constants';
import { moduloAtivo } from '../../tenant/tenant.config';

/**
 * Módulo desligado nesta instalação não existe.
 *
 * RESPONDE 404, E NÃO 403, de propósito. 403 diz "existe, mas você não pode" —
 * e convida a pedir acesso a uma funcionalidade que o sindicato não contratou.
 * 404 diz a verdade: para esta instalação, esta rota não existe. É o mesmo
 * padrão que o `duplicidade.guard.ts` já usava para funcionalidade sob flag.
 *
 * VALE TAMBÉM PARA ROTA PÚBLICA. A página pública da Colônia de Férias não pode
 * responder num sindicato que não tem colônia — por isso este guard não abre
 * exceção para `@Public()`, diferente dos guards de autenticação.
 *
 * A chave vem de `@ModuloTenant('x')` ou, quando já existe, do `@Modulo('x')`
 * usado pelas permissões — assim um controller não precisa declarar duas vezes.
 */
@Injectable()
export class ModuloAtivoGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const modulo =
      this.reflector.getAllAndOverride<ModuloKey>(MODULO_TENANT_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ??
      this.reflector.getAllAndOverride<ModuloKey>(MODULO_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);

    // Rota sem módulo declarado (auth, perfil, saúde, anexos) é transversal:
    // não pertence a nada que se desligue.
    if (!modulo) return true;

    if (!moduloAtivo(modulo)) {
      throw new NotFoundException('Recurso não encontrado.');
    }
    return true;
  }
}
