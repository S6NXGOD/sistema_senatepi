import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { SituacaoFiliado } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../prisma/prisma.service';
import { FiliadoAutenticado } from '../dto/portal-filiado.dto';
import { segredoFiliado } from '../portal-filiado.secret';

/** Claims do token do portal do filiado. */
export interface FiliadoJwtPayload {
  sub: string;
  matricula: string;
  /** Discriminador de público — ver comentário da estratégia. */
  tipo: 'filiado';
  primeiroAcesso: boolean;
}

export const ESTRATEGIA_FILIADO = 'jwt-filiado';

/**
 * Autenticação do PORTAL DO FILIADO — separada da equipe e do portal patronal.
 *
 * Três barreiras impedem que um token vaze de um público para outro:
 *  1) SEGREDO PRÓPRIO — assinado com outra chave, então nenhuma das outras
 *     estratégias consegue nem verificar a assinatura deste token;
 *  2) CLAIM `tipo: 'filiado'` — conferida explicitamente, para não depender de
 *     os UUIDs de `users`, `empresas` e `filiados` nunca colidirem;
 *  3) O ESTADO VEM DO BANCO a cada requisição, não do token.
 */
@Injectable()
export class FiliadoJwtStrategy extends PassportStrategy(Strategy, ESTRATEGIA_FILIADO) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: segredoFiliado(config),
    });
  }

  /**
   * Relê o filiado a cada requisição: se a secretaria revogar o acesso, trocar
   * a senha ou DESFILIAR a pessoa, o efeito é imediato — não espera o token
   * expirar.
   */
  async validate(payload: FiliadoJwtPayload): Promise<FiliadoAutenticado> {
    if (payload?.tipo !== 'filiado') {
      throw new UnauthorizedException('Sessão inválida.');
    }

    const filiado = await this.prisma.filiado.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        nomeCompleto: true,
        matricula: true,
        situacao: true,
        portalSenhaHash: true,
        portalPrimeiroAcesso: true,
      },
    });

    // Sem hash = acesso não habilitado, ou revogado pela secretaria.
    if (!filiado?.portalSenhaHash) {
      throw new UnauthorizedException('Sessão inválida ou acesso não habilitado.');
    }

    /*
      DESFILIADO PERDE O PORTAL, e na hora.

      A desfiliação tem porta própria desde 27/08 (motivo, mês de corte, termo
      assinado) e nenhuma delas mexe na senha. Sem esta linha, quem saiu do
      quadro continuaria vendo carteirinha, processos e cobranças até o token
      vencer. INATIVO continua entrando de propósito: é quem está em atraso ou
      suspenso, e é justamente quem precisa ver a própria cobrança para voltar.
    */
    if (filiado.situacao === SituacaoFiliado.DESFILIADO) {
      throw new UnauthorizedException('Sua filiação foi encerrada. Procure o sindicato.');
    }

    return {
      id: filiado.id,
      nomeCompleto: filiado.nomeCompleto,
      matricula: filiado.matricula,
      // Vale o estado do BANCO, não o do token: um token emitido antes da troca
      // não deve reabrir a tela de primeiro acesso, nem o contrário.
      primeiroAcesso: filiado.portalPrimeiroAcesso,
    };
  }
}
