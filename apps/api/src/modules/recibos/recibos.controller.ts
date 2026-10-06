import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { RecibosService } from './recibos.service';
import {
  CancelarReciboDto,
  EmitirReciboDto,
  ListarRecibosQueryDto,
} from './dto/recibos.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ModuloTenant } from '../../common/tenant/modulo-tenant.decorator';
import { Modulo } from '../../common/permissions/modulo.decorator';

/**
 * RECIBOS — e por que o módulo é PRÓPRIO, e não uma aba de `cobrancas`.
 *
 * Quem recebe dinheiro no balcão é a TRIAGEM, e o preset dela tem
 * `cobrancas: SEM_ACESSO` — na produção, 4 pessoas de Triagem, duas delas com
 * `cobrancas: VISUALIZAR` na matriz própria e duas com SEM_ACESSO (medido em
 * 06/10/2026). Pendurar o recibo em `cobrancas` daria o absurdo de a pessoa que
 * pega o dinheiro não poder entregar o papel — justamente o caso principal.
 *
 * SEM `@Roles`, por decisão de arquitetura (`senatepi-matriz-e-a-unica-politica`):
 * quem pode é o que a matriz disser, e nada além. Leitura exige VISUALIZAR,
 * emissão e cancelamento exigem EDITAR — o `PermissionsGuard` deduz isso do
 * verbo HTTP.
 */
@ApiTags('recibos')
@ApiBearerAuth()
@ModuloTenant('recibos')
@Modulo('recibos')
@Controller('recibos')
export class RecibosController {
  constructor(private readonly service: RecibosService) {}

  private ctx(req: Request, userId?: string) {
    return { ip: req.ip, userAgent: req.headers['user-agent'], userId };
  }

  /**
   * ROTA ESTÁTICA ANTES DE `:id` — `senatepi-rotas-que-colidem`. Com `@Get(':id')`
   * registrado primeiro, `/recibos/pendentes` cairia nele e responderia "Recibo
   * não encontrado" para a fila de trabalho inteira.
   */
  @Get('pendentes')
  pendentes() {
    return this.service.pendentes();
  }

  @Get()
  listar(@Query() q: ListarRecibosQueryDto) {
    return this.service.listar(q);
  }

  @Get(':id')
  obter(@Param('id') id: string) {
    return this.service.obter(id);
  }

  @Post()
  emitir(
    @Body() dto: EmitirReciboDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return this.service.emitir(dto, this.ctx(req, userId));
  }

  /**
   * PATCH, e não DELETE: cancelar NÃO apaga. A trava global de exclusão
   * (`só o Administrador apaga`) não se aplica aqui porque não há o que apagar
   * — o número fica queimado, com motivo e autor, e a linha permanece.
   */
  @Patch(':id/cancelar')
  cancelar(
    @Param('id') id: string,
    @Body() dto: CancelarReciboDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return this.service.cancelar(id, dto, this.ctx(req, userId));
  }
}
