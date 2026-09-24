import { ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { FiliadoAutenticado } from '../dto/portal-filiado.dto';
import { ESTRATEGIA_FILIADO } from '../strategies/filiado-jwt.strategy';

export const SENHA_PROVISORIA_KEY = 'filiado_permite_senha_provisoria';

/**
 * Marca as ÚNICAS rotas alcançáveis enquanto o filiado ainda está com a senha
 * provisória (trocar a senha e ler a própria sessão).
 */
export const PermiteSenhaProvisoria = () => SetMetadata(SENHA_PROVISORIA_KEY, true);

/**
 * Guard do portal do filiado.
 *
 * Além de exigir token válido da estratégia do filiado, aplica a trava do
 * primeiro acesso NO SERVIDOR. O redirecionamento da tela é conveniência; a
 * regra real é esta — sem ela bastaria um `curl` com o token provisório para
 * usar o portal inteiro sem nunca trocar a senha que circulou por WhatsApp.
 */
@Injectable()
export class FiliadoJwtGuard extends AuthGuard(ESTRATEGIA_FILIADO) {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const autenticado = (await super.canActivate(context)) as boolean;
    if (!autenticado) return false;

    const req = context.switchToHttp().getRequest<Request & { user?: FiliadoAutenticado }>();
    if (!req.user?.primeiroAcesso) return true;

    const liberada = this.reflector.getAllAndOverride<boolean>(SENHA_PROVISORIA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (liberada) return true;

    throw new ForbiddenException('Troque a senha provisória antes de acessar o portal.');
  }
}
