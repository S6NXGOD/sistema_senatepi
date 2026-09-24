import { Body, Controller, Get, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { PortalFiliadoAuthService } from './portal-filiado-auth.service';
import { FiliadoAutenticado, LoginFiliadoDto, TrocarSenhaDto } from './dto/portal-filiado.dto';
import { FiliadoJwtGuard, PermiteSenhaProvisoria } from './guards/filiado-jwt.guard';
import { FiliadoAtual } from './decorators/filiado-atual.decorator';
import { Public } from '../../common/decorators/public.decorator';

/**
 * Autenticação do PORTAL DO FILIADO.
 *
 * `@Public()` desliga os guards GLOBAIS do administrativo (JWT da equipe,
 * perfis, matriz por módulo) — nada disso se aplica a quem não é usuário do
 * sindicato. A proteção real vem do `FiliadoJwtGuard`, declarado rota a rota.
 */
@ApiTags('portal-filiado')
@Public()
@Controller('portal-filiado/auth')
export class PortalFiliadoAuthController {
  constructor(private readonly service: PortalFiliadoAuthService) {}

  private ctx(req: Request) {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }

  /**
   * Login por CPF **ou** matrícula, mais senha.
   *
   * Limite próprio e apertado: é o alvo natural de força bruta, e o teto global
   * (120/min) é largo demais para uma tela de senha. Oito por minuto ainda
   * acomoda quem erra a senha três vezes e tenta a matrícula em vez do CPF.
   */
  @Post('login')
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @ApiOperation({ summary: 'Login do filiado no portal (CPF ou matrícula)' })
  login(@Body() dto: LoginFiliadoDto, @Req() req: Request) {
    return this.service.login(dto, this.ctx(req));
  }

  /**
   * Troca da senha — obrigatória no primeiro acesso, disponível sempre depois.
   *
   * `@PermiteSenhaProvisoria` é o que torna esta rota alcançável com o token
   * restrito; todas as demais do portal recusam até a troca acontecer.
   */
  @Patch('senha')
  @UseGuards(FiliadoJwtGuard)
  @PermiteSenhaProvisoria()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Define a senha definitiva e devolve um token novo' })
  trocarSenha(
    @FiliadoAtual('id') filiadoId: string,
    @Body() dto: TrocarSenhaDto,
    @Req() req: Request,
  ) {
    return this.service.trocarSenha(filiadoId, dto, this.ctx(req));
  }

  /** Sessão corrente — a tela consulta para revalidar o estado no servidor. */
  @Get('eu')
  @UseGuards(FiliadoJwtGuard)
  @PermiteSenhaProvisoria()
  eu(@FiliadoAtual() filiado: FiliadoAutenticado) {
    return this.service.perfil(filiado);
  }
}
