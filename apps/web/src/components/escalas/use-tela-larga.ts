'use client';

import { useSyncExternalStore } from 'react';

/**
 * A tela tem a largura do computador (`md` do Tailwind, 768 px)?
 *
 * A escala decide por aqui a VISÃO INICIAL (lista no celular, calendário no
 * computador) e o que um toque no dia faz. Não serve para esconder conteúdo:
 * isso continua no CSS (`md:`), que não pisca.
 *
 * No servidor responde `true` (calendário). Enquanto a escala carrega, a tela
 * mostra o esqueleto; quando os plantões chegam, o navegador já respondeu.
 */
const CONSULTA = '(min-width: 768px)';

function assinar(avisar: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const mq = window.matchMedia(CONSULTA);
  mq.addEventListener('change', avisar);
  return () => mq.removeEventListener('change', avisar);
}

function ler(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia(CONSULTA).matches;
}

export function useTelaLarga(): boolean {
  return useSyncExternalStore(assinar, ler, () => true);
}
