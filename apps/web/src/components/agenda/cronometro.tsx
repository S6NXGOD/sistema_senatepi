'use client';

import { useEffect, useState } from 'react';
import { Timer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { cronometroEsquecido, cronometroHMS } from '@/lib/agenda';

/**
 * O CRONÔMETRO DA ATIVIDADE EM ANDAMENTO — um só, para o card e para a gaveta.
 *
 * Existiam DOIS, copiados, com a mesma lógica e tamanhos diferentes. Duas
 * cópias divergem na primeira correção: ao acrescentar o aviso de cronômetro
 * esquecido, o card passou a avisar e a gaveta continuaria verde e muda,
 * dizendo que estava tudo bem sobre exatamente a mesma atividade.
 *
 * MUDA DE COR QUANDO VIRA A NOITE. Verde e pulsante, ele afirma "isto está
 * acontecendo agora" — e era o que afirmava às duas atividades da produção de
 * 31/08/2026 que contavam há 12,8h e 12,6h, ambas previstas para durar UMA
 * hora. Ninguém passou meio dia numa consulta de uma hora: alguém esqueceu de
 * clicar em "Concluir", e o verde garantia que ninguém percebesse.
 *
 * Passar do horário previsto por pouco continua verde, de propósito: metade das
 * atividades concluídas passou até uma hora do previsto, e acender ali seria
 * acender em quase todas — que é o mesmo que não acender em nenhuma. A régua
 * mora em `cronometroEsquecido`.
 */
export function Cronometro({
  desde,
  fimPrevisto,
  tamanho = 'sm',
}: {
  desde: string;
  /** Horário em que a atividade DEVERIA ter terminado. */
  fimPrevisto?: string | null;
  tamanho?: 'sm' | 'md';
}) {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const esquecido = cronometroEsquecido(fimPrevisto, agora);
  const md = tamanho === 'md';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono font-semibold tabular-nums',
        md ? 'text-sm' : 'text-xs',
        esquecido
          ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'
          : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400',
      )}
      title={
        esquecido
          ? 'Contando há muito mais tempo que o previsto — provavelmente faltou concluir a atividade.'
          : 'Em andamento desde que alguém clicou em Iniciar.'
      }
    >
      <Timer className={cn(md ? 'h-4 w-4' : 'h-3.5 w-3.5', !esquecido && 'animate-pulse')} />
      {cronometroHMS(desde, agora)}
      {esquecido && (
        <span className={cn('font-sans font-normal', !md && 'text-[11px]')}>· faltou concluir?</span>
      )}
    </span>
  );
}
