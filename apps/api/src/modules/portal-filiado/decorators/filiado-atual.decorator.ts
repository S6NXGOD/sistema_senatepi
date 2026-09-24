import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { FiliadoAutenticado } from '../dto/portal-filiado.dto';

/** Filiado autenticado no portal — equivalente ao @CurrentUser do administrativo. */
export const FiliadoAtual = createParamDecorator(
  (campo: keyof FiliadoAutenticado | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: FiliadoAutenticado }>();
    const filiado = req.user;
    return campo ? filiado?.[campo] : filiado;
  },
);
