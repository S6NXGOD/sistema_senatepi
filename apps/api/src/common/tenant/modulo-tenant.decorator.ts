import { SetMetadata } from '@nestjs/common';
import { ModuloKey } from '../permissions/permissoes.constants';

export const MODULO_TENANT_KEY = 'modulo-tenant';

/**
 * A que MÓDULO DO PRODUTO esta rota pertence — para a instalação poder desligá-lo.
 *
 * POR QUE NÃO REUSAR `@Modulo`
 * `@Modulo` responde "QUEM pode?" — ele exige VISUALIZAR nas leituras e EDITAR
 * nas escritas, conforme a matriz de permissões. Este responde outra coisa:
 * "esta instalação TEM este módulo?".
 *
 * Misturar as duas quebraria acesso em produção. Exemplo real: o cadastro de
 * filiado hoje é liberado à Triagem por `@Roles`, mas o preset de permissão da
 * Triagem para `filiados` é VISUALIZAR. Marcar o controller com `@Modulo`
 * passaria a exigir EDITAR e a secretaria perderia o direito de cadastrar —
 * uma regressão séria, e invisível até alguém tentar.
 *
 * Por isso são dois decoradores com significados distintos. Onde `@Modulo` já
 * existe, o guard aproveita a mesma chave e este aqui é dispensável.
 */
export const ModuloTenant = (modulo: ModuloKey) => SetMetadata(MODULO_TENANT_KEY, modulo);
