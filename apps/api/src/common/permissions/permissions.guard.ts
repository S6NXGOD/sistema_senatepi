import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AuthUser } from '../decorators/current-user.decorator';
import { MODULO_KEY } from './modulo.decorator';
import { DADOS_PROPRIOS_KEY } from './dados-proprios.decorator';
import { OPERACAO_DE_SISTEMA_KEY } from './operacao-de-sistema.decorator';
import { ModuloKey, NivelPermissao, RANK_NIVEL, nivelEfetivo, MODULOS } from './permissoes.constants';

/**
 * PermissionsGuard — camada de autorização por MÓDULO + regra de exclusão.
 *
 * Regras (nesta ordem):
 *  1) Rotas @Public() passam.
 *  2) ADMINISTRADOR tem acesso total (inclusive apagar).
 *  3) DELETE só é permitido ao ADMINISTRADOR — "o Administrador geral (apenas ele)
 *     pode apagar qualquer coisa do sistema". Regra GLOBAL, com uma única
 *     exceção: rotas @DadosProprios (autoatendimento sobre a própria conta).
 *  4) Rotas @OperacaoDeSistema() são do Administrador — ver o decorador.
 *  5) Em controllers marcados com @Modulo, exige VISUALIZAR (GET/HEAD) ou EDITAR
 *     (POST/PATCH/PUT) conforme o método, resolvendo o nível pela matriz do
 *     usuário (com fallback no preset do perfil).
 *  6) Sem @Modulo, a autorização fica a cargo do RolesGuard (@Roles).
 *
 * A MENSAGEM FAZ PARTE DA REGRA. Um 403 que só diz "Forbidden resource" manda o
 * administrador adivinhar: ele marcou `usuarios: EDITAR` para a coordenação,
 * viu aquilo, e não tinha como saber que existia uma segunda política por cima
 * da matriz. Toda recusa daqui nomeia o MÓDULO e o NÍVEL que faltou.
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

    // (3) Regra global de exclusão: só o Administrador apaga REGISTROS do
    // sistema. Rotas de autoatendimento (@DadosProprios) são exceção — ali o
    // usuário só mexe nos próprios dados (ex.: remover a própria foto).
    const dadosProprios = this.reflector.getAllAndOverride<boolean>(DADOS_PROPRIOS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (req.method === 'DELETE' && !dadosProprios) {
      throw new ForbiddenException('Apenas o Administrador pode excluir registros do sistema.');
    }

    /*
      (4) OPERAÇÃO DE SISTEMA — a única coisa que ainda restringe por PERFIL
      dentro de um módulo, e agora ela é explícita, nomeada e contada por um
      teste. Ver `operacao-de-sistema.decorator.ts` para a lista e o porquê.
    */
    const operacaoDeSistema = this.reflector.getAllAndOverride<boolean>(
      OPERACAO_DE_SISTEMA_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (operacaoDeSistema) {
      throw new ForbiddenException(
        'Esta é uma operação de sistema (importação em massa, varredura completa ' +
          'ou fusão de cadastros) e só o Administrador pode executá-la. ' +
          'Ela não depende da matriz de permissões.',
      );
    }

    // (5) Autorização por módulo (quando o controller/rota declara @Modulo).
    const modulo = this.reflector.getAllAndOverride<ModuloKey>(MODULO_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!modulo) return true; // (6) delega ao RolesGuard.

    const exigido: NivelPermissao = this.leitura.has(req.method) ? 'VISUALIZAR' : 'EDITAR';
    const nivel = nivelEfetivo(user.role, user.permissoes, modulo);
    if (RANK_NIVEL[nivel] < RANK_NIVEL[exigido]) {
      /*
        A MENSAGEM DIZ O QUE FALTA, e antes não dizia.

        "Você não tem permissão para acessar este módulo" não distingue "não
        tenho o módulo" de "tenho, mas só para ver". Com o nome do módulo e os
        dois níveis, quem administra sabe exatamente qual linha da matriz mexer
        — sem abrir log de servidor.
      */
      const rotulo = MODULOS.find((m) => m.key === modulo)?.label ?? modulo;
      const comoEsta = nivel === 'SEM_ACESSO' ? 'sem acesso' : 'somente visualização';
      throw new ForbiddenException(
        `Seu perfil está ${comoEsta} em "${rotulo}" e esta ação exige ` +
          `${exigido === 'EDITAR' ? 'edição' : 'visualização'}. ` +
          'Peça a um Administrador para ajustar a matriz de permissões.',
      );
    }
    return true;
  }
}
