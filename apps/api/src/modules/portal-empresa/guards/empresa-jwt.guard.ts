import { ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { EmpresaAutenticada } from '../dto/portal-empresa.dto';
import { ESTRATEGIA_EMPRESA } from '../strategies/empresa-jwt.strategy';

export const SENHA_PROVISORIA_KEY = 'permite_senha_provisoria';

/**
 * Marca as ÚNICAS rotas alcançáveis enquanto a empresa ainda está com a senha
 * provisória (troca de senha e leitura da própria sessão).
 */
export const PermiteSenhaProvisoria = () => SetMetadata(SENHA_PROVISORIA_KEY, true);

/**
 * Guard do portal patronal.
 *
 * Além de exigir um token válido da estratégia da empresa, aplica a trava do
 * primeiro acesso NO SERVIDOR. O redirecionamento da interface é conveniência;
 * a regra real é esta — sem ela, bastaria um `curl` com o token provisório para
 * usar o portal inteiro sem nunca trocar a senha.
 */
@Injectable()
export class EmpresaJwtGuard extends AuthGuard(ESTRATEGIA_EMPRESA) {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const autenticado = (await super.canActivate(context)) as boolean;
    if (!autenticado) return false;

    const req = context.switchToHttp().getRequest<Request & { user?: EmpresaAutenticada }>();
    const empresa = req.user;
    if (!empresa?.primeiroAcesso) return true;

    const liberada = this.reflector.getAllAndOverride<boolean>(SENHA_PROVISORIA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (liberada) return true;

    throw new ForbiddenException(
      'Troque a senha provisória antes de acessar o portal.',
    );
  }
}
