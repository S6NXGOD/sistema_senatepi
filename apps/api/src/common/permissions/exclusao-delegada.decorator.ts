import { SetMetadata } from '@nestjs/common';

export const EXCLUSAO_DELEGADA_KEY = 'exclusaoDelegada';

/**
 * EXCLUSÃO QUE O ADMINISTRADOR DELEGA PELA MATRIZ (15/09/2026).
 *
 * A regra global continua: só o Administrador apaga. Esta marca tira UMA rota
 * dessa trava e a devolve à matriz — passa a exigir EDITAR no módulo do
 * controller, como um POST. Existe para o pedido do dono: "o administrador
 * permitir que alguém de qualquer perfil faça o trabalho com os cadastros
 * duplicados", e esse trabalho é consolidar, que apaga.
 *
 * SÓ VALE em módulo que apenas o Administrador concede
 * (`MODULOS_QUE_SO_O_ADMINISTRADOR_CONCEDE`). Posta num módulo que a
 * Coordenação distribui, seria "qualquer um apaga" — então ali o
 * `PermissionsGuard` a ignora e a trava global continua valendo. Um teste
 * conta as rotas marcadas.
 */
export const ExclusaoDelegada = () => SetMetadata(EXCLUSAO_DELEGADA_KEY, true);
