/**
 * Paleta compartilhada dos "tipos coloridos" cadastráveis (tipos de evento da
 * Agenda e tipos de movimentação dos Processos).
 *
 * As classes precisam existir LITERALMENTE no código para o Tailwind gerá-las —
 * por isso o mapa é estático (nada de `bg-${cor}-500`). Este arquivo está sob
 * `src/lib/**`, que já faz parte do `content` do tailwind.config.
 */

export interface ClassesCor {
  /** Borda esquerda do card. */
  borda: string;
  /** Bolinha/dot da legenda e da timeline. */
  ponto: string;
  /** Pílula (badge) com fundo suave. */
  badge: string;
}

export const CORES_PALETA = [
  'slate', 'sky', 'blue', 'indigo', 'violet', 'purple', 'pink', 'rose',
  'red', 'orange', 'amber', 'emerald', 'teal', 'cyan',
] as const;
export type CorPaleta = (typeof CORES_PALETA)[number];

export const PALETA: Record<string, ClassesCor> = {
  slate: { borda: 'border-l-slate-500', ponto: 'bg-slate-500', badge: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  sky: { borda: 'border-l-sky-500', ponto: 'bg-sky-500', badge: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300' },
  blue: { borda: 'border-l-blue-500', ponto: 'bg-blue-500', badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  indigo: { borda: 'border-l-indigo-500', ponto: 'bg-indigo-500', badge: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' },
  violet: { borda: 'border-l-violet-500', ponto: 'bg-violet-500', badge: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' },
  purple: { borda: 'border-l-purple-500', ponto: 'bg-purple-500', badge: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' },
  pink: { borda: 'border-l-pink-500', ponto: 'bg-pink-500', badge: 'bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300' },
  rose: { borda: 'border-l-rose-500', ponto: 'bg-rose-500', badge: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' },
  red: { borda: 'border-l-red-500', ponto: 'bg-red-500', badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  orange: { borda: 'border-l-orange-500', ponto: 'bg-orange-500', badge: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' },
  amber: { borda: 'border-l-amber-500', ponto: 'bg-amber-500', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  emerald: { borda: 'border-l-emerald-500', ponto: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  teal: { borda: 'border-l-teal-500', ponto: 'bg-teal-500', badge: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300' },
  cyan: { borda: 'border-l-cyan-500', ponto: 'bg-cyan-500', badge: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300' },
};

/** Classes de uma cor, com fallback seguro. */
export function classesCor(cor: string | undefined | null): ClassesCor {
  return PALETA[cor ?? ''] ?? PALETA.slate;
}
