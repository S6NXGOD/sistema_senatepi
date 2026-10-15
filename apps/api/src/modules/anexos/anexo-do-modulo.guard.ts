import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { exigenciasDoAnexo, faltaParaOAnexo, fraseDaRecusa } from './anexo-do-modulo.regras';

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
 * A REGRA É A DO PAI, e mora em `anexo-do-modulo.regras` — pura, testável sem
 * HTTP, e compartilhada com o handler de upload. Dois motivos para ela ter
 * saído daqui:
 *
 *  1. ORIGEM NÃO É DESTINO. `filiadoId` só diz de quem é o acervo LIDO; exigir
 *     EDITAR nele num POST bloqueava todo advogado de puxar documento
 *     (chamado real de 15/10/2026).
 *  2. O UPLOAD É MULTIPART, E ESTE GUARDA NÃO O ENXERGA. Guarda roda ANTES do
 *     interceptor, e é o `FileInterceptor` que analisa o `multipart/form-data`:
 *     na hora em que este código corre, `req.body` está VAZIO e o `processoId`
 *     do formulário simplesmente não existe. Medido em 15/10/2026: um usuário
 *     de TRIAGEM, com `processos: SEM_ACESSO`, subiu um anexo PARA DENTRO de
 *     um processo e recebeu 201. Por isso a rota de upload chama a regra ela
 *     mesma, depois do interceptor — ver `AnexosController.upload`.
 *
 * DELETE não passa por aqui porque já é mais restrito: só o Administrador
 * apaga, regra global do `PermissionsGuard` (conferido: 403 para Triagem e
 * para Advogada).
 */
@Injectable()
export class AnexoDoModuloGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = req.user;
    if (!user) return true; // O JwtAuthGuard já barra antes daqui.

    const fonte = { ...(req.query ?? {}), ...(req.body ?? {}) } as Record<string, unknown>;
    const exigencias = exigenciasDoAnexo(req.method, fonte);
    // Sem pai identificado, o DTO recusa depois — e no upload a própria rota confere.
    if (!exigencias.length) return true;

    const falta = faltaParaOAnexo(user, exigencias);
    if (falta) throw new ForbiddenException(fraseDaRecusa(user, falta));
    return true;
  }
}
