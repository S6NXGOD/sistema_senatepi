import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { UpdateFiliadoDto } from '../filiados/dto/filiado.dto';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ctxDaRequisicao } from '../../common/audit/audit.contexto-http';
import { ModuloTenant } from '../../common/tenant/modulo-tenant.decorator';
import { Modulo } from '../../common/permissions/modulo.decorator';
import { RecadastramentoService } from './recadastramento.service';

/**
 * RECADASTRAMENTO PRESENCIAL — pela MATRIZ, sem `@Roles`.
 *
 * Morava dentro de `recadastramento.module.ts` com
 * `@Roles(ADMINISTRADOR, COORDENACAO, TRIAGEM)` numa rota de controller que já
 * tinha `@Modulo('filiados')`. O teste da matriz só varria `*.controller.ts` e
 * não o via. Efeito (auditoria de 12/09/2026): um advogado a quem o
 * Administrador desse `filiados: EDITAR` via o cartão "Cadastros a completar",
 * preenchia o formulário inteiro e recebia "Esta rota é exclusiva do(s)
 * perfil(is)". Pelos presets o alcance é o mesmo: POST exige EDITAR, que
 * ADMINISTRADOR, COORDENAÇÃO e TRIAGEM têm.
 */
@ApiTags('recadastramento')
@ApiBearerAuth()
@ModuloTenant('filiados')
@Modulo('filiados')
@Controller('filiados/:id')
export class RecadastramentoController {
  constructor(private readonly service: RecadastramentoService) {}

  @Post('recadastramento')
  submeter(
    @Param('id') id: string,
    @Body() dto: UpdateFiliadoDto,
    @CurrentUser('nome') autor: string,
  ) {
    return this.service.submeter(id, dto, autor);
  }

  /** Com origem e de→para: é o que o bloco de conferência da ficha lê. */
  @Get('recadastramentos')
  listar(@Param('id') id: string) {
    return this.service.listar(id);
  }
}

/** Ações sobre UM recadastramento (o id é do recadastramento, não do filiado). */
@ApiTags('recadastramento')
@ApiBearerAuth()
@ModuloTenant('filiados')
@Modulo('filiados')
@Controller('recadastramentos')
export class RecadastramentosController {
  constructor(private readonly service: RecadastramentoService) {}

  /** PATCH exige EDITAR em filiados — quem pode recadastrar pode conferir. */
  @Patch(':id/conferir')
  conferir(@Param('id') id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.service.conferir(id, ctxDaRequisicao(req, user));
  }
}
