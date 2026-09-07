'use client';

import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';

/**
 * QUATRO CARTÕES DIZENDO "NADA AQUI" VIRAM UMA LINHA.
 *
 * Medido no painel do administrador em 07/09/2026: das nove seções principais,
 * **quatro estavam vazias** — atividades de hoje, audiências da semana, nada
 * atrasado, nenhum atendimento pendente. E só 3 dos 11 blocos do painel somem
 * sozinhos quando não têm conteúdo; os outros 8 desenham um cartão inteiro,
 * com título, ícone, moldura e um "nenhum registro" no meio.
 *
 * Metade da primeira tela era, literalmente, o sistema informando que não tinha
 * nada a informar. No celular isso é meia dúzia de rolagens antes do primeiro
 * dado real.
 *
 * NÃO É ESCONDER — É PROPORÇÃO. "Agenda de hoje vazia" é informação boa: quem
 * abre o painel quer saber que está limpo. Só não vale um cartão. Aqui vira uma
 * linha, no FIM do painel, que é onde a boa notícia pertence: depois do que
 * precisa de gente, nunca antes.
 *
 * A linha some inteira quando não há nada de bom a dizer — aí o painel está
 * cheio de trabalho e a última coisa útil é um selo verde.
 */
export interface CoisaLimpa {
  /** Frase curta e afirmativa: "Nada atrasado", não "0 atrasos". */
  texto: string;
  /** Para onde ir se a pessoa quiser conferir mesmo assim. */
  href?: string;
}

export function OQueEstaLimpo({ itens }: { itens: CoisaLimpa[] }) {
  if (!itens.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
      <CheckCircle2 className="mr-1 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-500" />
      {itens.map((c, i) => (
        <span key={c.texto} className="flex items-center gap-1">
          {i > 0 && <span aria-hidden className="mr-1 opacity-40">·</span>}
          {c.href ? (
            <Link
              href={c.href}
              className="underline-offset-2 transition hover:text-foreground hover:underline"
            >
              {c.texto}
            </Link>
          ) : (
            c.texto
          )}
        </span>
      ))}
    </div>
  );
}
