import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { UserRole } from '@prisma/client';
import { FinanceiroService } from './financeiro.service';
import { CriarContaBancariaDto } from './dto/financeiro.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ModuloTenant } from '../../common/tenant/modulo-tenant.decorator';
import { Modulo } from '../../common/permissions/modulo.decorator';

@ApiTags('financeiro')
@ApiBearerAuth()
@Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
@ModuloTenant('cobrancas')
@Modulo('cobrancas')
@Controller('financeiro')
export class FinanceiroController {
  constructor(private readonly service: FinanceiroService) {}

  private ctx(req: Request, userId?: string) {
    return { ip: req.ip, userAgent: req.headers['user-agent'], userId };
  }

  @Get('contas')
  contas() {
    return this.service.listarContas();
  }

  @Post('contas')
  criarConta(
    @Body() dto: CriarContaBancariaDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return this.service.criarConta(dto, this.ctx(req, userId));
  }
}
