'use client';

import { useCallback, useEffect, useId, useRef } from 'react';
import {
  desempilharSobreposicao,
  ehOTopo,
  empilharSobreposicao,
  oCliqueFoiNoFundo,
} from '@/lib/sobreposicoes';

/**
 * O QUE UMA SOBREPOSIÇÃO PRECISA SABER: se ela é a de cima, e se o clique no
 * fundo escuro foi mesmo um pedido para sair.
 *
 * As regras estão em `lib/sobreposicoes` e têm teste. Aqui só mora a parte que
 * depende do React: entrar na pilha ao abrir, sair ao fechar, e devolver os
 * dois manipuladores que o fundo precisa.
 *
 * Uso:
 *
 *     const { souOTopo, fundo } = useSobreposicao(open, fechar);
 *     <div className="fixed inset-0 …" {...fundo}> …
 */
export function useSobreposicao(aberta: boolean, aoSair?: () => void) {
  const id = useId();

  useEffect(() => {
    if (!aberta) return;
    empilharSobreposicao(id);
    return () => desempilharSobreposicao(id);
  }, [aberta, id]);

  const souOTopo = useCallback(() => ehOTopo(id), [id]);

  /*
    ESC É DO TOPO. A gaveta que está por baixo continua com o seu próprio
    ouvinte; a diferença é que agora ele se cala enquanto há alguém em cima.
  */
  useEffect(() => {
    if (!aberta || !aoSair) return;
    const ouvir = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !ehOTopo(id)) return;
      e.stopPropagation();
      aoSair();
    };
    document.addEventListener('keydown', ouvir);
    return () => document.removeEventListener('keydown', ouvir);
  }, [aberta, aoSair, id]);

  const comecouNoFundo = useRef(false);
  const ultimoCliqueDentro = useRef(0);

  const fundo = {
    onMouseDown: (e: React.MouseEvent) => {
      comecouNoFundo.current = e.target === e.currentTarget;
      if (!comecouNoFundo.current) ultimoCliqueDentro.current = Date.now();
    },
    onClick: (e: React.MouseEvent) => {
      const sair = oCliqueFoiNoFundo({
        comecouNoFundo: comecouNoFundo.current,
        terminouNoFundo: e.target === e.currentTarget,
        msDesdeOUltimoCliqueDentro: Date.now() - ultimoCliqueDentro.current,
      });
      comecouNoFundo.current = false;
      if (sair) aoSair?.();
    },
  };

  return { souOTopo, fundo };
}
