import { ConfigService } from '@nestjs/config';
import { segredoDaInstalacao } from '../../common/segredo.util';

/**
 * Segredo de assinatura do portal do filiado.
 *
 * Preferimos `JWT_FILIADO_SECRET`. Sem ela, DERIVAMOS do segredo da equipe em
 * vez de reaproveitá-lo: assim o token de um filiado nunca é aceito como token
 * de usuário do sindicato — nem como token do portal patronal, que deriva com
 * outro sufixo. Nunca cai em constante fixa, que viraria chave conhecida em
 * produção.
 *
 * Mesmo desenho de `portal-empresa.secret`, e de propósito: são dois públicos
 * externos com o mesmo risco, e um segundo jeito de fazer a mesma coisa é um
 * segundo lugar para errar.
 */
export function segredoFiliado(config: ConfigService): string {
  const proprio = config.get<string>('JWT_FILIADO_SECRET');
  if (proprio) return proprio;
  const daEquipe = segredoDaInstalacao('JWT_ACCESS_SECRET', config.get<string>('JWT_ACCESS_SECRET'));
  return `${daEquipe}::portal-filiado`;
}
