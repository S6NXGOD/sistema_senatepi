import { Body, Controller, Post, Req, HttpCode } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthService } from './auth.service';
import {
  ForgotPasswordDto,
  LoginDto,
  RefreshDto,
  ResetPasswordDto,
} from './dto/auth.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private ctx(req: Request) {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }

  /**
   * LIMITE PRÓPRIO E APERTADO — esta é a porta da equipe, inclusive do
   * ADMINISTRADOR.
   *
   * O teto global é de 120/min, que numa tela de senha significa 172.800
   * tentativas por dia a partir de UM endereço. O portal patronal e a colônia
   * já tinham limite próprio (8/min e 6/min) exatamente por este motivo; o
   * login da equipe, que é o alvo de maior valor do sistema, tinha ficado de
   * fora.
   *
   * POR QUE 15, E NÃO 5. A equipe do sindicato trabalha atrás de UM IP público
   * (a rede da sede). Um limite agressivo transformaria "errei a senha duas
   * vezes" numa recepcionista bloqueando o jurídico inteiro — e, no meio de uma
   * assembleia, isso é pior que o ataque. 15/min corta a força bruta em 8x e
   * ainda deixa a sede inteira entrar.
   *
   * DE PROPÓSITO NÃO HÁ BLOQUEIO POR CONTA: travar a conta após N erros daria a
   * qualquer um a capacidade de deixar o administrador de fora do sistema no
   * dia da eleição, só errando a senha dele algumas vezes. A defesa é o limite
   * por origem mais o registro da tentativa (ver `AuthService.login`).
   */
  @Public()
  @Post('login')
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, this.ctx(req));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(200)
  logout(@CurrentUser('id') userId: string, @Req() req: Request) {
    return this.auth.logout(userId, this.ctx(req));
  }

  /**
   * A rota responde sempre 200 (não revela se o e-mail existe), então ela não
   * serve para enumerar conta — mas serve para EMITIR TOKEN em massa e para
   * inundar caixas de entrada quando o envio de e-mail existir. 5/min basta
   * para quem esqueceu a senha.
   */
  @Public()
  @Post('forgot-password')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  forgot(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.email);
  }

  /**
   * Aqui o limite é anti-ADIVINHAÇÃO do token: quem tem o token legítimo usa
   * uma vez. Tentar mais que isso só faz sentido para quem está chutando.
   */
  @Public()
  @Post('reset-password')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  reset(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto);
  }
}
