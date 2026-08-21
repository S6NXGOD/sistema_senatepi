'use client';

import { FileCheck2, Scale } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * O SELO DA FASE PRÉ-PROCESSUAL — um só, para toda tela que mostra o caso.
 *
 * POR QUE VIROU COMPONENTE. O mesmo chip violeta estava copiado em três lugares
 * (a tabela de processos, a gaveta da atividade e o seletor de processo), e os
 * três diziam coisas diferentes: "Ajuizar", "Rascunho — falta formalizar" e
 * "Pré-processual". Três nomes para o mesmo estado, na mesma semana de uso —
 * é assim que a equipe passa a achar que são coisas distintas.
 *
 * O NOME É "PRÉ-PROCESSUAL", e não "rascunho". Rascunho descreve um registro
 * pela metade, algo a completar ou jogar fora. O que existe aqui é uma FASE do
 * trabalho jurídico, com atos próprios: notificação extrajudicial, tentativa de
 * acordo, coleta de documentos, cálculo prévio. Um caso pode passar meses aí
 * legitimamente e nunca virar ação. Com o nome antigo, a fila parecia pendência
 * de cadastro — e era tratada como tal, quer dizer, era ignorada.
 *
 * NÃO É SÓ COR. Ícone + palavra + cor, sempre juntos: violeta sozinho não chega
 * a quem tem daltonismo nem sobrevive à impressão em preto e branco do dossiê.
 *
 * `onAjuizar` transforma o selo em botão. É a única diferença de comportamento,
 * e existe porque na tabela o selo ocupa o lugar do NPU que ainda não existe —
 * ali ele é o convite para dar o próximo passo, não só um rótulo.
 */
export function SeloPreProcessual({
  tamanho = 'md',
  onAjuizar,
  className,
}: {
  tamanho?: 'sm' | 'md';
  /** Quando presente, o selo vira o botão que abre a formalização. */
  onAjuizar?: () => void;
  className?: string;
}) {
  const sm = tamanho === 'sm';
  const base = cn(
    'inline-flex w-fit shrink-0 items-center gap-1 rounded-full font-semibold',
    'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
    sm ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-0.5 text-[10px]',
    className,
  );
  const icone = cn(sm ? 'h-2.5 w-2.5' : 'h-3 w-3');

  if (!onAjuizar) {
    return (
      <span className={base} title="Caso ainda não ajuizado — sem número único (NPU).">
        <Scale className={icone} aria-hidden />
        Pré-processual
      </span>
    );
  }

  return (
    <button
      type="button"
      // A tabela inteira é clicável (abre a ficha); sem isto, ajuizar abriria a
      // ficha por baixo do modal.
      onClick={(e) => { e.stopPropagation(); onAjuizar(); }}
      className={cn(base, 'transition hover:bg-violet-200 dark:hover:bg-violet-900/60')}
      title="Informar o número único (NPU) e tirar o caso da fase pré-processual."
    >
      <FileCheck2 className={icone} aria-hidden />
      Ajuizar
    </button>
  );
}
