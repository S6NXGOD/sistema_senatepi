import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';

/**
 * Interruptor do mutirão de duplicidade.
 *
 * A ferramenta existe para higienizar a carga legada — um trabalho que acontece
 * uma vez. Uma tela capaz de excluir filiados que fica ligada para sempre é
 * risco permanente em troca de utilidade temporária, então o padrão é
 * DESLIGADO e ligar é um ato deliberado.
 *
 * Desligada, as rotas respondem 404, e não 403: guardar o link não adianta
 * porque a porta não existe. Ligar ou desligar é mudar a variável no Railway e
 * reiniciar — sem alterar código, sem novo build.
 */
export function duplicidadeAtiva(): boolean {
  const v = (process.env.FILIADOS_DUPLICIDADE ?? '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'on' || v === 'sim';
}

@Injectable()
export class DuplicidadeAtivaGuard implements CanActivate {
  canActivate(): boolean {
    if (!duplicidadeAtiva()) {
      throw new NotFoundException('Cannot GET /api/filiados/duplicidade');
    }
    return true;
  }
}
