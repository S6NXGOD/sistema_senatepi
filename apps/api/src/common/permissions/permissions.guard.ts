import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AuthUser } from '../decorators/current-user.decorator';
import { MODULO_KEY } from './modulo.decorator';
import { ModuloKey, NivelPermissao, RANK_NIVEL, nivelEfetivo } from './permissoes.constants';

/**
 * PermissionsGuard — camada de autorização por MÓDULO + regra de exclusão.
 *
 * Regras (nesta ordem):
 *  1) Rotas @Public() passam.
 *  2) ADMINISTRADOR tem acesso total (inclusive apagar).
 *  3) DELETE só é permitido ao ADMINISTRADOR — "o Administrador geral (apenas ele)
 *     pode apagar qualquer coisa do sistema". Regra GLOBAL (todas as rotas).
 *  4) Em controllers marcados com @Modulo, exige VISUALIZAR (GET/HEAD) ou EDITAR
 *     (POST/PATCH/PUT) conforme o método, resolvendo o nível pela matriz do
 *     usuário (com fallback no preset do perfil).
 *  5) Sem @Modulo, a autorização fica a cargo do RolesGuard (@Roles).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly leitura = new Set(['GET', 'HEAD', 'OPTIONS']);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = req.user;
    if (!user) return true; // Sem usuário em rota não-pública: o JwtAuthGuard já barra.

    // (2) Administrador: acesso total.
    if (user.role === UserRole.ADMINISTRADOR) return true;

    // (3) Regra global de exclusão: só o Administrador apaga.
    if (req.method === 'DELETE') {
      throw new ForbiddenException('Apenas o Administrador pode excluir registros do sistema.');
    }

    // (4) Autorização por módulo (quando o controller/rota declara @Modulo).
    const modulo = this.reflector.getAllAndOverride<ModuloKey>(MODULO_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!modulo) return true; // (5) delega ao RolesGuard.

    const exigido: NivelPermissao = this.leitura.has(req.method) ? 'VISUALIZAR' : 'EDITAR';
    const nivel = nivelEfetivo(user.role, user.permissoes, modulo);
    if (RANK_NIVEL[nivel] < RANK_NIVEL[exigido]) {
      throw new ForbiddenException('Você não tem permissão para acessar este módulo.');
    }
    return true;
  }
}
