'use client';

import { ArrowLeftRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TamanhoSelo } from './selo-urgente';

/**
 * "LADO A CONFERIR" — o Diário publica o sindicato do OUTRO lado deste processo.
 *
 * SUBSTITUIU UMA TAREFA (07/11/2026). Eram atividades "Conferir de que lado
 * estamos no processo" na agenda de cada advogado, e o dono pediu: *"estão
 * poluindo demais, acho melhor deixar só uma badge em cima do processo"*. A
 * agenda é de compromisso; a divergência é uma informação do processo, fica
 * nele enquanto existir e some sozinha quando alguém corrige as partes.
 *
 * ÂMBAR porque pede alguém — não é erro nem urgência (ver a regra de cores do
 * painel). Ícone, palavra e cor juntos, como o selo de urgente: cor sozinha não
 * chega a quem tem daltonismo nem sobrevive à impressão.
 */
const TAMANHO: Record<TamanhoSelo, { caixa: string; icone: string }> = {
  sm: { caixa: 'gap-1 px-1.5 py-0.5 text-[10px]', icone: 'h-2.5 w-2.5' },
  md: { caixa: 'gap-1 px-2 py-0.5 text-[11px]', icone: 'h-3 w-3' },
};

export function SeloLadoAConferir({
  desde,
  tamanho = 'md',
  onClick,
  className,
}: {
  /** Desde quando a varredura vê a divergência. */
  desde?: string | null;
  tamanho?: TamanhoSelo;
  /** Na ficha, leva às Partes, onde está a prova. Na lista, a linha já abre a ficha. */
  onClick?: () => void;
  className?: string;
}) {
  const t = TAMANHO[tamanho];
  const quando = desde
    ? new Date(desde).toLocaleDateString('pt-BR', { timeZone: 'America/Fortaleza' })
    : null;
  const explicacao =
    `O Diário publica o sindicato do outro lado deste processo${quando ? ` (desde ${quando})` : ''}. ` +
    'A prova, com as palavras do tribunal, está nas Partes.';
  const classes = cn(
    'inline-flex shrink-0 items-center rounded-full border font-semibold',
    'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
    onClick && 'transition hover:bg-amber-100 dark:hover:bg-amber-900/40',
    t.caixa,
    className,
  );
  const conteudo = (
    <>
      <ArrowLeftRight className={t.icone} aria-hidden />
      Lado a conferir
    </>
  );

  return onClick ? (
    <button
      type="button"
      title={explicacao}
      aria-label={`Lado a conferir: ${explicacao}`}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={classes}
    >
      {conteudo}
    </button>
  ) : (
    <span title={explicacao} aria-label={`Lado a conferir: ${explicacao}`} className={classes}>
      {conteudo}
    </span>
  );
}
