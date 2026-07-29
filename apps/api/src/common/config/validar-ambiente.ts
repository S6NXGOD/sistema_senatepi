import { Logger } from '@nestjs/common';

/**
 * Validação de ambiente no boot (fail-fast).
 *
 * Em PRODUÇÃO (NODE_ENV=production):
 *  - CRÍTICAS: a API não sobe se estiverem ausentes ou com um valor padrão de
 *    desenvolvimento (evita subir com segredo previsível). São variáveis que uma
 *    produção funcional já possui, então isto não quebra um deploy saudável — só
 *    barra configurações inseguras.
 *  - IMPORTANTES: apenas ALERTAM (não derrubam o boot) para não travar a
 *    produção; sinalizam riscos que devem ser corrigidos.
 *
 * Fora de produção, não faz nada (dev/test podem usar os defaults).
 */

/** Valores padrão de DEV que jamais devem valer em produção. */
const DEFAULTS_INSEGUROS = new Set([
  'dev-access-secret',
  'dev-refresh-secret',
  'dev-qr-secret',
  'senatepi@2026',
  'minioadmin',
]);

export function validarAmbiente(): void {
  const logger = new Logger('Ambiente');
  const env = process.env;
  if (env.NODE_ENV !== 'production') return;

  // ---- Críticas: ausência ou valor inseguro derruba o boot ----
  const criticas = ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];
  const ausentes: string[] = [];
  const inseguras: string[] = [];
  for (const chave of criticas) {
    const valor = env[chave]?.trim();
    if (!valor) ausentes.push(chave);
    else if (DEFAULTS_INSEGUROS.has(valor)) inseguras.push(chave);
  }
  if (ausentes.length || inseguras.length) {
    const partes: string[] = [];
    if (ausentes.length) partes.push(`ausentes: ${ausentes.join(', ')}`);
    if (inseguras.length) partes.push(`com valor padrão INSEGURO: ${inseguras.join(', ')}`);
    throw new Error(
      `[ENV] Configuração de produção inválida (${partes.join(' | ')}). ` +
        'Defina segredos fortes e exclusivos (ex.: openssl rand -base64 48) antes de iniciar a API.',
    );
  }

  // ---- Importantes: apenas alertam (não derrubam o boot) ----
  const avisar = (chave: string, motivo: string) => logger.warn(`[ENV] ${chave} ${motivo}.`);

  const qr = env.QR_SIGNING_SECRET?.trim();
  if (!qr) {
    avisar('QR_SIGNING_SECRET', 'não definido — o QR das carteirinhas usa um segredo de DEV (risco de falsificação)');
  } else if (DEFAULTS_INSEGUROS.has(qr)) {
    avisar('QR_SIGNING_SECRET', 'está com o valor padrão inseguro');
  }

  if (!env.SEED_ADMIN_PASSWORD?.trim()) {
    avisar('SEED_ADMIN_PASSWORD', 'não definido — um seed inicial em banco vazio não criaria o admin (proteção)');
  }

  if (env.STORAGE_DRIVER === 's3') {
    for (const chave of ['STORAGE_ENDPOINT', 'STORAGE_BUCKET', 'STORAGE_ACCESS_KEY', 'STORAGE_SECRET_KEY']) {
      if (!env[chave]?.trim()) avisar(chave, 'não definido (STORAGE_DRIVER=s3)');
    }
    const secret = env.STORAGE_SECRET_KEY?.trim();
    if (secret && DEFAULTS_INSEGUROS.has(secret)) avisar('STORAGE_SECRET_KEY', 'está com o valor padrão inseguro');
  }

  logger.log('[ENV] Validação de produção concluída — variáveis críticas OK.');
}
