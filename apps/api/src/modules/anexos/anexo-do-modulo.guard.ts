import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Request } from 'express';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  ModuloKey,
  NivelPermissao,
  RANK_NIVEL,
  nivelEfetivo,
} from '../../common/permissions/permissoes.constants';

/**
 * O ANEXO HERDA A PERMISSÃO DE QUEM O SEGURA.
 *
 * `@Modulo` é estático por controller, e o anexo não tem módulo fixo: ele
 * pendura em atendimento, em processo ou em atividade, e cada um desses vive
 * sob um módulo diferente. O controller ficou então com `@Roles` dos QUATRO
 * perfis, que na prática é "qualquer pessoa autenticada".
 *
 * O furo que isso abria: a Triagem tem `processos: SEM_ACESSO` e não vê a lista
 * de processos — mas `GET /anexos?processoId=X` devolvia os documentos do
 * processo assim mesmo. Petição, laudo, acordo. É a mesma classe de falha do
 * painel, onde o dado do processo viajava para quem não podia vê-lo, e a mesma
 * regra vale: o corte é no backend, não na tela.
 *
 * A REGRA É A DO PAI. Anexo de processo exige o módulo `processos`; de
 * atividade, `agenda`; de atendimento, `atendimentos`. Ler exige VISUALIZAR,
 * gravar exige EDITAR — a mesma escala do `PermissionsGuard`.
 *
 * DELETE não passa por aqui porque já é mais restrito: só o Administrador
 * apaga, regra global do `PermissionsGuard`.
 */
@Injectable()
export class AnexoDoModuloGuard implements CanActivate {
  private readonly leitura = new Set(['GET', 'HEAD', 'OPTIONS']);

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = req.user;
    if (!user) return true; // O JwtAuthGuard já barra antes daqui.
    if (user.role === UserRole.ADMINISTRADOR) return true;

    const fonte = { ...(req.query ?? {}), ...(req.body ?? {}) } as Record<string, unknown>;
    const modulos = modulosEnvolvidos(fonte);
    if (!modulos.length) return true; // Sem pai identificado, o DTO recusa depois.

    const exigido: NivelPermissao = this.leitura.has(req.method) ? 'VISUALIZAR' : 'EDITAR';
    for (const modulo of modulos) {
      if (RANK_NIVEL[nivelEfetivo(user.role, user.permissoes, modulo)] < RANK_NIVEL[exigido]) {
        throw new ForbiddenException(
          'Você não tem permissão para acessar os documentos deste registro.',
        );
      }
    }
    return true;
  }
}

/**
 * Todos os módulos que a requisição toca.
 *
 * É plural porque "puxar do acervo" cita a origem E o destino na mesma chamada:
 * copiar um documento do processo para a atividade exige poder nos dois lados.
 * Exigir só um deixaria a cópia virar a porta que a leitura direta fechou.
 */
function modulosEnvolvidos(fonte: Record<string, unknown>): ModuloKey[] {
  const modulos: ModuloKey[] = [];
  if (fonte.processoId) modulos.push('processos');
  if (fonte.compromissoId) modulos.push('agenda');
  if (fonte.atendimentoId) modulos.push('atendimentos');
  // `filiadoId` do acervo: quem monta a lista de documentos de um filiado
  // precisa poder ver o filiado.
  if (fonte.filiadoId) modulos.push('filiados');
  return modulos;
}
