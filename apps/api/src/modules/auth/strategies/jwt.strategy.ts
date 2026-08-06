import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthUser } from '../../../common/decorators/current-user.decorator';
import { PrismaService } from '../../../prisma/prisma.service';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  nome: string;
  /** Emitido em (segundos). Preenchido pelo próprio `@nestjs/jwt`. */
  iat?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET', 'dev-access-secret'),
    });
  }

  /**
   * Busca o usuário FRESCO no banco a cada requisição: garante que mudanças de
   * perfil/permissões tenham efeito imediato e que um usuário desativado perca o
   * acesso na hora (revogação), sem esperar o token expirar.
   */
  async validate(payload: JwtPayload): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true, email: true, nome: true, nomeExibicao: true,
        role: true, ativo: true, permissoes: true, sessoesValidasApos: true,
      },
    });
    if (!user || !user.ativo) {
      throw new UnauthorizedException('Sessão inválida ou usuário inativo.');
    }

    // CORTE DE SESSÃO. O token de acesso é um JWT autocontido e válido por 30
    // dias: apagar refresh tokens não tira ninguém de dentro do sistema, porque
    // nenhuma requisição chega a precisar de refresh. Comparar o `iat` com o
    // corte é o que torna o logout forçado imediato.
    //
    // Um segundo de tolerância evita derrubar quem acabou de logar no mesmo
    // instante do corte — `iat` tem resolução de segundos e arredonda para
    // baixo.
    if (user.sessoesValidasApos && payload.iat) {
      const emitidoEm = payload.iat * 1000;
      if (emitidoEm + 1000 < user.sessoesValidasApos.getTime()) {
        throw new UnauthorizedException('Sessão encerrada. Entre novamente.');
      }
    }
    return {
      id: user.id,
      email: user.email,
      nome: user.nome,
      nomeExibicao: user.nomeExibicao,
      role: user.role,
      permissoes: user.permissoes,
    };
  }
}
