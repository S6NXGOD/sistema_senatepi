import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    if (user && required.includes(user.role)) return true;

    /*
      NUNCA MAIS "Forbidden resource".

      Retornar `false` de um guarda faz o Nest responder com a mensagem padrão
      dele, que não diz nada. Foi exatamente o que o administrador viu ao dar
      `usuarios: EDITAR` à coordenação: marcou a permissão na tela, tomou um
      403 sem explicação, e não havia como descobrir que existia um `@Roles`
      por cima da matriz. Diagnóstico é parte da autorização.
    */
    const perfis = required.join(', ');
    throw new ForbiddenException(
      `Esta rota é exclusiva do(s) perfil(is): ${perfis}. ` +
        'Ela não passa pela matriz de permissões.',
    );
  }
}
