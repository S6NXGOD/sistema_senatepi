'use client';

import { useSyncExternalStore } from 'react';

/**
 * A pessoa pediu ao sistema operacional para reduzir o movimento?
 *
 * Escuta a mudança ao vivo (quem liga a opção com a tela aberta não precisa
 * recarregar). No servidor responde `false`: o HTML sai com o valor final de
 * tudo, e a decisão de animar só acontece no navegador.
 *
 * O CSS global já zera animação e transição com a preferência ligada; este
 * gancho existe para o que anima em JavaScript (o número que conta e o
 * recharts, que não lê a preferência sozinho).
 */
const CONSULTA = '(prefers-reduced-motion: reduce)';

function assinar(avisar: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const mq = window.matchMedia(CONSULTA);
  mq.addEventListener('change', avisar);
  return () => mq.removeEventListener('change', avisar);
}

/** Leitura imediata, fora de componente (vale no navegador; no servidor, `false`). */
export function prefereMenosMovimento(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(CONSULTA).matches;
}

export function useReduzirMovimento(): boolean {
  return useSyncExternalStore(assinar, prefereMenosMovimento, () => false);
}
