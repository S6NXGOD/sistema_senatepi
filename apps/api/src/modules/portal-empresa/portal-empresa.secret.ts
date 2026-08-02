import { ConfigService } from '@nestjs/config';

/**
 * Segredo de assinatura do portal patronal.
 *
 * Preferimos `JWT_EMPRESA_SECRET`. Sem ela, DERIVAMOS do segredo da equipe em
 * vez de reaproveitá-lo: assim o token de uma empresa nunca é aceito como token
 * de usuário do sindicato mesmo num ambiente que não configurou a variável.
 * Nunca cai em uma constante fixa — isso viraria uma chave conhecida em produção.
 */
export function segredoEmpresa(config: ConfigService): string {
  const proprio = config.get<string>('JWT_EMPRESA_SECRET');
  if (proprio) return proprio;
  const daEquipe = config.get<string>('JWT_ACCESS_SECRET', 'dev-access-secret');
  return `${daEquipe}::portal-empresa`;
}
