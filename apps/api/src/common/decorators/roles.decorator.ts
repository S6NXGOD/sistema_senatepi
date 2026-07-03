import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';
/** Restringe a rota aos perfis informados. Ex: @Roles('ADMIN', 'DIRETORIA') */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
