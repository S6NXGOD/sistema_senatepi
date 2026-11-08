'use client';

import { Bell } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * O QUADRO DE AVISOS — um só, com uma linha por aviso (07/11/2026).
 *
 * O PEDIDO: *"Estou achando a dashboard muito poluída de avisos. A dashboard deve
 * ter a melhor UI e apresentação possível."* No print, entre a saudação e o
 * primeiro número havia cinco caixas empilhadas — duas âmbar, duas cinza e um
 * cartão roxo —, cada uma com moldura, fundo e cor próprios. Era a tela inteira
 * gritando, e nenhum aviso se destacava porque todos se destacavam.
 *
 * COMO FICOU: uma moldura só, e dentro dela cada aviso é uma LINHA, separada da
 * seguinte por um fio. A cor saiu do fundo e foi para uma faixa de 3px na borda
 * esquerda — âmbar quando pede alguém, rosa quando algo quebrou, nada quando é
 * só para saber. É o mesmo código de cor do resto do sistema, gastando um
 * décimo da tinta.
 *
 * POR QUE ASSIM, E NÃO REESCREVENDO CADA AVISO. São oito blocos com regra
 * própria e anos de ajuste fino (o que aparece, para quem, quando some). Eles
 * só precisaram dizer o que são — `data-aviso="atencao" | "critico" | "info"` na
 * moldura externa — e este quadro cuida do visual. Quem cria um aviso novo
 * precisa lembrar de uma coisa só: o atributo.
 *
 * SOME SOZINHO: todo aviso já se esconde quando não tem o que dizer, e o quadro
 * se esconde quando nenhum desenhou nada (`:has`). Em dia tranquilo não sobra
 * uma moldura vazia dizendo "nenhum aviso".
 */
export function PainelDeAvisos({ children }: { children: React.ReactNode }) {
  return (
    <section
      aria-label="Avisos"
      className={cn(
        'overflow-hidden rounded-xl border bg-card shadow-sm',
        '[&:not(:has([data-aviso]))]:hidden',
      )}
    >
      <header className="flex items-center gap-2 px-4 py-2.5">
        <Bell className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-semibold">Avisos</h2>
      </header>
      <div className={AVISOS_EM_LINHA}>{children}</div>
    </section>
  );
}

/**
 * Cada aviso deixa de ser caixa e vira linha. `!` porque as molduras de cada
 * aviso são classes do próprio componente, e aqui é o quadro que manda.
 */
export const AVISOS_EM_LINHA = cn(
  '[&_[data-aviso]]:!rounded-none',
  '[&_[data-aviso]]:!border-x-0 [&_[data-aviso]]:!border-b-0 [&_[data-aviso]]:!border-t',
  '[&_[data-aviso]]:!border-border',
  '[&_[data-aviso]]:!bg-transparent',
  // A cor vai para a borda esquerda, e o texto volta ao tom normal da tela.
  '[&_[data-aviso=atencao]]:!shadow-[inset_3px_0_0_0_rgb(251,191,36)]',
  '[&_[data-aviso=critico]]:!shadow-[inset_3px_0_0_0_rgb(244,63,94)]',
  '[&_[data-aviso=info]]:!shadow-none',
  '[&_[data-aviso=atencao]]:!text-foreground',
  '[&_[data-aviso=critico]]:!text-foreground',
);
