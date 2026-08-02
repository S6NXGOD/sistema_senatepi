import { Body, Controller, Get, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { PortalEmpresaAuthService } from './portal-empresa-auth.service';
import { LoginEmpresaDto, PrimeiroAcessoDto, EmpresaAutenticada } from './dto/portal-empresa.dto';
import { EmpresaJwtGuard, PermiteSenhaProvisoria } from './guards/empresa-jwt.guard';
import { EmpresaAtual } from './decorators/empresa-atual.decorator';
import { Public } from '../../common/decorators/public.decorator';

/**
 * Autenticação do PORTAL DA EMPRESA.
 *
 * `@Public()` desliga os guards GLOBAIS do administrativo (JWT da equipe,
 * perfis, permissões por módulo) — que não se aplicam a quem não é usuário do
 * sindicato. A proteção real vem do `EmpresaJwtGuard`, declarado rota a rota.
 */
@ApiTags('portal-empresa')
@Public()
@Controller('portal-empresa/auth')
export class PortalEmpresaAuthController {
  constructor(private readonly service: PortalEmpresaAuthService) {}

  private ctx(req: Request) {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }

  /**
   * Login por CNPJ + senha.
   * Limite próprio e apertado: é o alvo natural de tentativa por força bruta,
   * e o teto global (120/min) é largo demais para uma tela de senha.
   */
  @Post('login')
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @ApiOperation({ summary: 'Login da empresa no portal patronal' })
  login(@Body() dto: LoginEmpresaDto, @Req() req: Request) {
    return this.service.login(dto, this.ctx(req));
  }

  /**
   * Troca obrigatória da senha provisória.
   * `@PermiteSenhaProvisoria` é o que torna esta rota alcançável com o token
   * restrito — todas as demais do portal recusam até a troca acontecer.
   */
  @Patch('primeiro-acesso')
  @UseGuards(EmpresaJwtGuard)
  @PermiteSenhaProvisoria()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Define a senha definitiva e devolve um token novo' })
  primeiroAcesso(
    @EmpresaAtual('id') empresaId: string,
    @Body() dto: PrimeiroAcessoDto,
    @Req() req: Request,
  ) {
    return this.service.primeiroAcesso(empresaId, dto, this.ctx(req));
  }

  /** Sessão corrente — a tela consulta para revalidar o estado no servidor. */
  @Get('eu')
  @UseGuards(EmpresaJwtGuard)
  @PermiteSenhaProvisoria()
  eu(@EmpresaAtual() empresa: EmpresaAutenticada) {
    return this.service.perfil(empresa);
  }
}
