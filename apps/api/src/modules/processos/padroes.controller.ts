import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Modulo } from '../../common/permissions/modulo.decorator';
import { PadroesService } from './padroes.service';

/**
 * Controller PRÓPRIO, e não mais uma rota em `ProcessosController`.
 *
 * Lá dentro existe `@Get(':id')`, e o Nest casa rotas na ordem de declaração:
 * `/processos/panorama` entraria por ali com "panorama" no lugar do id. Um
 * controller separado com prefixo próprio não tem como colidir.
 *
 * O gate é `processos` porque o dado é o acervo — quem não vê a lista não vê o
 * agregado dela.
 */
@ApiTags('panorama')
@ApiBearerAuth()
@Modulo('processos')
@Controller('panorama')
export class PadroesController {
  constructor(private readonly padroes: PadroesService) {}

  @Get()
  @ApiOperation({
    summary: 'Padrões no acervo ativo: mesmo réu com pedido repetido, e pedido espalhado pela categoria.',
  })
  levantar() {
    return this.padroes.levantar();
  }
}
