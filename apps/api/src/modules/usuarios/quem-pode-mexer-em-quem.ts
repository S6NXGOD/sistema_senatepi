import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  MODULO_KEYS,
  ModuloKey,
  NivelPermissao,
  RANK_NIVEL,
  nivelEfetivo,
} from '../../common/permissions/permissoes.constants';

/**
 * QUEM PODE MEXER EM QUEM — o teto do módulo de usuários.
 *
 * POR QUE ISTO EXISTE. O módulo `usuarios` deixou de ser trancado no perfil
 * (`@Roles(ADMINISTRADOR)` no controller inteiro, que ignorava a matriz e
 * devolvia "Forbidden resource"). Agora quem administra pode dar
 * `usuarios: EDITAR` a uma coordenação — e essa permissão precisa de um teto,
 * senão ela não é "gerenciar usuários", é "virar administrador em dois
 * cliques".
 *
 * AS QUATRO TRAVAS, e as três primeiras foram pedidas com todas as letras:
 *
 *  1. Só o Administrador CRIA um Administrador.
 *  2. Só o Administrador PROMOVE alguém a Administrador.
 *  3. Ninguém abaixo de Administrador MEXE num Administrador — nem para editar
 *     o nome, nem para desativar, nem para trocar a foto.
 *  4. Ninguém concede um nível que não tem. (Esta eu acrescentei, e explico
 *     abaixo por quê.)
 *
 * A QUARTA É A QUE FECHA O BURACO DE VERDADE. Sem ela, as três primeiras são
 * teatro: a coordenação não consegue criar um "ADMINISTRADOR", mas consegue
 * criar um COORDENACAO com os dezesseis módulos em EDITAR — inclusive
 * `auditoria`, que ela mesma só vê. O rótulo do perfil ficaria abaixo dela; o
 * PODER, acima. Escalar privilégio por interposta pessoa é o modo clássico de
 * furar um RBAC, e custa quatro linhas fechar.
 *
 * O que a trava 4 NÃO impede: conceder o que a pessoa já tem. Uma coordenação
 * com `processos: EDITAR` pode dar `processos: EDITAR` a outra — é o trabalho
 * dela. Ela só não pode dar `auditoria: EDITAR` tendo `auditoria: VISUALIZAR`.
 *
 * O ADMINISTRADOR PASSA POR TUDO: `nivelEfetivo` já devolve EDITAR para ele em
 * qualquer módulo, então a trava 4 nunca o alcança, e as três primeiras o
 * checam por igualdade explícita.
 */

/** Quem está agindo — sai do token, nunca do corpo da requisição. */
export interface Autor {
  id?: string;
  role?: UserRole;
  permissoes?: unknown;
}

const ehAdmin = (autor: Autor) => autor.role === UserRole.ADMINISTRADOR;

/**
 * Travas 1 e 2 — o perfil ADMINISTRADOR só é atribuído por um Administrador.
 *
 * `roleDesejada` é a do DTO; `undefined` num PATCH significa "não mexe no
 * perfil", e aí não há o que checar.
 */
export function garantirQuePodeAtribuirPerfil(autor: Autor, roleDesejada?: UserRole): void {
  if (roleDesejada !== UserRole.ADMINISTRADOR) return;
  if (ehAdmin(autor)) return;
  throw new ForbiddenException(
    'Apenas um Administrador pode criar ou promover outro Administrador.',
  );
}

/**
 * Trava 3 — conta de Administrador é intocável para quem está abaixo.
 *
 * Vale para editar, desativar, trocar a foto e excluir. A checagem é sobre o
 * perfil ATUAL do alvo no banco, não sobre o que vem no corpo: senão bastaria
 * mandar `role: COORDENACAO` no mesmo PATCH para destravar a si mesmo.
 */
export function garantirQuePodeMexerNoAlvo(autor: Autor, roleDoAlvo: UserRole): void {
  if (roleDoAlvo !== UserRole.ADMINISTRADOR) return;
  if (ehAdmin(autor)) return;
  throw new ForbiddenException(
    'Contas de Administrador só podem ser alteradas por outro Administrador.',
  );
}

/**
 * Trava 4 — ninguém concede o que não tem.
 *
 * Compara módulo a módulo o nível pedido contra o nível EFETIVO de quem está
 * agindo (matriz própria → preset do perfil). Devolve a lista do que excedeu,
 * para a mensagem dizer exatamente onde, em vez de um "não pode" seco.
 */
export function garantirQueNaoEscalaPrivilegio(
  autor: Autor,
  permissoesPedidas: Partial<Record<ModuloKey, NivelPermissao>> | undefined,
): void {
  if (!permissoesPedidas || ehAdmin(autor)) return;
  if (!autor.role) {
    throw new ForbiddenException('Não foi possível identificar seu perfil para esta operação.');
  }

  const excedidos: string[] = [];
  for (const modulo of MODULO_KEYS) {
    const pedido = permissoesPedidas[modulo];
    if (!pedido) continue;
    const meu = nivelEfetivo(autor.role, autor.permissoes, modulo);
    if (RANK_NIVEL[pedido] > RANK_NIVEL[meu]) excedidos.push(modulo);
  }
  if (!excedidos.length) return;

  throw new ForbiddenException(
    'Você não pode conceder um nível maior do que o seu. ' +
      `Revise: ${excedidos.join(', ')}.`,
  );
}
