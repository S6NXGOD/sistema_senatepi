/**
 * Leitura de interruptor de recurso a partir de variável de ambiente.
 *
 * Os valores aceitos ("true", "1", "on", "sim") vêm do primeiro interruptor do
 * sistema (`FILIADOS_DUPLICIDADE`, em `filiados/duplicidade.guard.ts`) e estão
 * aqui para que o próximo não invente a própria convenção. Quem opera o Railway
 * não deveria ter de lembrar que um recurso liga com "sim" e outro só com
 * "true".
 *
 * Qualquer outro valor — inclusive vazio, ausente ou digitado errado — é
 * DESLIGADO. Um recurso novo nunca deve entrar em produção por acidente de
 * configuração.
 */
export function flagLigada(valor: string | undefined | null): boolean {
  const v = (valor ?? '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'on' || v === 'sim';
}
