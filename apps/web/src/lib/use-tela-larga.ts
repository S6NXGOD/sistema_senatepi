'use client';

import { useSyncExternalStore } from 'react';

/**
 * A tela tem a largura do computador (`md` do Tailwind, 768 px)?
 *
 * Duas telas decidem por aqui a VISÃO INICIAL:
 *   - a Escala: lista no celular, calendário no computador (e o que um toque
 *     no dia faz);
 *   - a Agenda (14/09/2026): lista por dia no celular, quadro no computador.
 *     O quadro empilhava as quatro colunas a 400 px e desmontava a ordem do
 *     tempo — uma audiência às 9h em andamento aparecia abaixo de uma tarefa
 *     de sexta ainda pendente.
 *
 * Não serve para esconder conteúdo: isso continua no CSS (`md:`), que não pisca.
 *
 * No servidor responde `true` (a visão do computador). Enquanto os dados
 * carregam, cada tela mostra o esqueleto; quando eles chegam, o navegador já
 * respondeu. Morava em components/escalas/ e veio para cá quando a Agenda
 * passou a usar — o arquivo antigo só reexporta.
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
