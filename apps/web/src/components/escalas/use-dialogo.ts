'use client';

import { RefObject, useEffect, useRef } from 'react';

/**
 * A tecla fecha o diálogo? Só o Escape, e nunca com o envio em curso: fechar no
 * meio do POST deixaria a pessoa sem saber se a cópia ou a troca gravou.
 * `defaultPrevented` é de quem já tratou o Escape antes (um seletor aberto).
 */
export function fechaComTecla(ev: { key: string; defaultPrevented?: boolean }, ocupado: boolean): boolean {
  return ev.key === 'Escape' && !ocupado && !ev.defaultPrevented;
}

/**
 * PARA ONDE VAI O TAB DENTRO DO DIÁLOGO (15/09/2026).
 *
 * `total` é quantos focáveis o painel tem, `atual` a posição do foco entre eles
 * (-1 quando o foco está no próprio painel ou fora dele). Devolve a posição a
 * focar, -1 para segurar o foco no painel, ou null para deixar o navegador
 * andar: só nas duas pontas o Tab é desviado, e o meio segue a ordem normal.
 */
export function destinoDoTab(total: number, atual: number, shift: boolean): number | null {
  if (total === 0) return -1;
  if (atual < 0) return shift ? total - 1 : 0;
  if (shift && atual === 0) return total - 1;
  if (!shift && atual === total - 1) return 0;
  return null;
}

const FOCAVEIS = 'button, [href], input, select, textarea, [tabindex]';

/** Os focáveis do painel, na ordem do documento: sem os desligados, os escondidos e os fora do Tab. */
function focaveisDe(painel: HTMLElement): HTMLElement[] {
  return Array.from(painel.querySelectorAll<HTMLElement>(FOCAVEIS)).filter(
    (el) => !el.hasAttribute('disabled') && el.tabIndex >= 0 && el.getClientRects().length > 0,
  );
}

/**
 * ESCAPE E FOCO NOS DIÁLOGOS DAS ESCALAS (15/09/2026).
 *
 * Copiar e Editar/Trocar não fechavam com Escape e abriam sem foco: com o
 * teclado, o Tab continuava andando pela página atrás do fundo escuro. O
 * primeiro conserto só focava ao abrir, e depois do último botão o foco ainda
 * saía para a página; agora o Tab e o Shift+Tab dão a volta dentro do painel.
 *
 * Ao abrir, o foco vai para `focoInicial` (o campo que a pessoa precisa
 * preencher) ou para o próprio painel; ao fechar, volta para quem abriu. O
 * painel recebe foco, e não o primeiro campo, quando o primeiro campo é
 * teclado: no celular, focar um campo de texto abre o teclado por cima da folha.
 */
export function useDialogo({
  painel,
  focoInicial,
  ocupado,
  onFechar,
}: {
  painel: RefObject<HTMLElement>;
  focoInicial?: RefObject<HTMLElement>;
  ocupado: boolean;
  onFechar: () => void;
}) {
  // Lidos pelo listener sem refazer o efeito a cada render.
  const ocupadoRef = useRef(ocupado);
  const onFecharRef = useRef(onFechar);
  ocupadoRef.current = ocupado;
  onFecharRef.current = onFechar;

  useEffect(() => {
    const anterior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (focoInicial?.current ?? painel.current)?.focus({ preventScroll: true });

    const aoTeclar = (ev: KeyboardEvent) => {
      if (ev.key === 'Tab' && !ev.defaultPrevented && painel.current) {
        const focaveis = focaveisDe(painel.current);
        const ativo = document.activeElement as HTMLElement | null;
        const destino = destinoDoTab(focaveis.length, ativo ? focaveis.indexOf(ativo) : -1, ev.shiftKey);
        if (destino === null) return;
        ev.preventDefault();
        (destino < 0 ? painel.current : focaveis[destino]).focus();
        return;
      }
      if (!fechaComTecla(ev, ocupadoRef.current)) return;
      ev.preventDefault();
      onFecharRef.current();
    };
    document.addEventListener('keydown', aoTeclar);
    return () => {
      document.removeEventListener('keydown', aoTeclar);
      if (anterior?.isConnected) anterior.focus({ preventScroll: true });
    };
    // Só ao montar e desmontar: os diálogos das escalas montam ao abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
