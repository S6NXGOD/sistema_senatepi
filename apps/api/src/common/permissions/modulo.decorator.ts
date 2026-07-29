import { SetMetadata } from '@nestjs/common';
import { ModuloKey } from './permissoes.constants';

export const MODULO_KEY = 'modulo';

/**
 * Marca um controller (ou rota) como pertencente a um módulo permissionável.
 * O PermissionsGuard exige VISUALIZAR nas leituras (GET) e EDITAR nas escritas.
 * Ex.: `@Modulo('processos')`.
 */
export const Modulo = (modulo: ModuloKey) => SetMetadata(MODULO_KEY, modulo);
