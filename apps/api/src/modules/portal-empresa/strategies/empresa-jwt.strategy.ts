import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../prisma/prisma.service';
import { EmpresaAutenticada } from '../dto/portal-empresa.dto';
import { segredoEmpresa } from '../portal-empresa.secret';

/** Claims do token do portal patronal. */
export interface EmpresaJwtPayload {
  sub: string;
  cnpj: string;
  razaoSocial: string;
  /** Discriminador de público — ver comentário da estratégia. */
  tipo: 'empresa';
  /** A senha ainda é a provisória: o token fica restrito à troca. */
  primeiroAcesso: boolean;
}

export const ESTRATEGIA_EMPRESA = 'jwt-empresa';

/**
 * Autenticação do PORTAL DA EMPRESA — separada da equipe do sindicato.
 *
 * Duas barreiras impedem que um token vaze de um lado para o outro:
 *  1) SEGREDO PRÓPRIO — assinado com outra chave, então a estratégia da equipe
 *     nem consegue verificar a assinatura deste token (e vice-versa);
 *  2) CLAIM `tipo: 'empresa'` — conferida explicitamente aqui, para não depender
 *     apenas de os UUIDs de `users` e `empresas` nunca colidirem.
 */
@Injectable()
export class EmpresaJwtStrategy extends PassportStrategy(Strategy, ESTRATEGIA_EMPRESA) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: segredoEmpresa(config),
    });
  }

  /**
   * Relê a empresa a cada requisição: se a secretaria remover o acesso ou a
   * senha for trocada, o efeito é imediato — não espera o token expirar.
   */
  async validate(payload: EmpresaJwtPayload): Promise<EmpresaAutenticada> {
    if (payload?.tipo !== 'empresa') {
      throw new UnauthorizedException('Sessão inválida.');
    }

    const empresa = await this.prisma.empresa.findUnique({
      where: { id: payload.sub },
      select: {
        id: true, cnpj: true, razaoSocial: true, nomeFantasia: true,
        senhaHash: true, primeiroAcesso: true,
      },
    });
    // Sem hash = acesso ao portal não habilitado (ou revogado pela secretaria).
    if (!empresa?.senhaHash) {
      throw new UnauthorizedException('Sessão inválida ou acesso não habilitado.');
    }

    return {
      id: empresa.id,
      cnpj: empresa.cnpj,
      razaoSocial: empresa.razaoSocial,
      nomeFantasia: empresa.nomeFantasia,
      // Vale o estado do BANCO, não o do token: um token antigo (emitido antes
      // da troca) não deve reabrir a tela de primeiro acesso, nem o contrário.
      primeiroAcesso: empresa.primeiroAcesso,
    };
  }
}
