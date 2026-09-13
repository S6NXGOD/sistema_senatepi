'use client';

import { DURACAO } from '@/lib/movimento';
import { useReduzirMovimento } from '@/lib/use-reduzir-movimento';

/**
 * Animação dos gráficos do recharts — espalhe em cada `<Area>`, `<Bar>`,
 * `<Line>` e `<Pie>`: `<Area {...animacao} … />`.
 *
 * O padrão da biblioteca (2.15) é 1.500 ms com a pizza esperando mais 400 ms:
 * quase dois segundos para ver um número no meio de um donut. E o recharts não
 * lê `prefers-reduced-motion` — a preferência precisa entrar por aqui.
 *
 * O recharts só reanima quando os pontos mudam de fato; revalidação com o mesmo
 * dado não repete nada.
 */
export function useAnimacaoDeGrafico(): {
  isAnimationActive: boolean;
  animationBegin: number;
  animationDuration: number;
  animationEasing: 'ease-out';
} {
  const reduzir = useReduzirMovimento();
  return {
    isAnimationActive: !reduzir,
    animationBegin: 0,
    animationDuration: DURACAO.dado,
    animationEasing: 'ease-out',
  };
}
