'use client';

import { cn } from '@/lib/utils';
import { Movimentacao, formatData, formatDataHora } from '@/lib/processos';
import { Inbox } from 'lucide-react';

/**
 * Linha do Tempo (vertical) das movimentações processuais.
 * Mobile-first: trilho fino à esquerda com pontos; a movimentação mais recente
 * fica destacada no topo. Datas em rótulo discreto, descrição em destaque.
 */
export function TimelineMovimentacoes({ movimentacoes }: { movimentacoes: Movimentacao[] }) {
  if (!movimentacoes.length) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
        <Inbox className="h-6 w-6 opacity-60" />
        Nenhuma movimentação registrada.
      </div>
    );
  }

  return (
    <ol className="mt-1">
      {movimentacoes.map((m, i) => {
        const primeiro = i === 0;
        const ultimo = i === movimentacoes.length - 1;
        return (
          <li key={m.id} className="flex gap-3">
            {/* Trilho + ponto */}
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  'mt-1 h-3 w-3 shrink-0 rounded-full ring-4 transition-colors',
                  primeiro
                    ? 'bg-brand-600 ring-brand-100 dark:bg-brand-400 dark:ring-brand-900/40'
                    : 'bg-muted-foreground/40 ring-transparent',
                )}
              />
              {!ultimo && <span className="w-px flex-1 bg-border" />}
            </div>

            {/* Conteúdo */}
            <div className={cn('min-w-0 flex-1', ultimo ? 'pb-0' : 'pb-6')}>
              <time
                dateTime={m.dataMovimento}
                className="block text-xs font-medium text-muted-foreground"
                title={formatDataHora(m.dataMovimento)}
              >
                {formatData(m.dataMovimento)}
              </time>
              <p
                className={cn(
                  'mt-0.5 break-words text-sm leading-snug',
                  primeiro ? 'font-semibold text-foreground' : 'text-foreground/90',
                )}
              >
                {m.descricao}
              </p>
              {m.codigoMovimento != null && (
                <span className="mt-0.5 inline-block text-[11px] text-muted-foreground">
                  Código CNJ {m.codigoMovimento}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
