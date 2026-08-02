import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { EmpresaAutenticada } from '../dto/portal-empresa.dto';

/** Empresa autenticada no portal — equivalente ao @CurrentUser do administrativo. */
export const EmpresaAtual = createParamDecorator(
  (campo: keyof EmpresaAutenticada | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: EmpresaAutenticada }>();
    const empresa = req.user;
    return campo ? empresa?.[campo] : empresa;
  },
);
