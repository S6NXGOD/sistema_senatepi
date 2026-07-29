import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  nome: string;
  nomeExibicao?: string | null;
  /** Matriz de permissões por módulo (override do preset do perfil). */
  permissoes?: unknown;
}

/** Injeta o usuário autenticado (preenchido pelo JwtStrategy). */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as AuthUser;
    return data ? user?.[data] : user;
  },
);
