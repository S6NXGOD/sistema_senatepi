/**
 * Fuso de Teresina, num lugar só.
 *
 * Estas três funções viviam duplicadas: `OFFSET_BR_MS` em `audiencia.util.ts` e
 * `inicioDoDiaBR`/`diaBR` privadas dentro de `audiencias.service.ts`. Quando o
 * robô de prazos passou a precisar de `diaBR` para não criar duas audiências no
 * mesmo dia, a escolha era copiar pela terceira vez ou extrair. Duas cópias de
 * uma regra de fuso é como as duas regras de classificação que já custaram caro
 * neste módulo: elas divergem em silêncio.
 *
 * Brasil sem horário de verão desde 2019 → offset fixo UTC-3.
 */
export const OFFSET_BR_MS = 3 * 3_600_000;

/** Meia-noite de hoje em Teresina, como instante real (UTC). */
export function inicioDoDiaBR(base = new Date()): Date {
  const br = new Date(base.getTime() - OFFSET_BR_MS);
  return new Date(Date.UTC(br.getUTCFullYear(), br.getUTCMonth(), br.getUTCDate()) + OFFSET_BR_MS);
}

/**
 * Chave "dia em Teresina" (yyyy-mm-dd).
 *
 * É por ela que se decide se dois eventos caem no MESMO dia — comparar
 * `Date` cru colocaria a audiência das 23h de Teresina no dia seguinte, porque
 * em UTC ela já virou.
 */
export function diaBR(d: Date): string {
  return new Date(d.getTime() - OFFSET_BR_MS).toISOString().slice(0, 10);
}
