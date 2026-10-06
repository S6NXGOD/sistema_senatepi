'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CircleCheck, HandCoins, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  pendentesDeRecibo, formatBRL, formatData, type PagamentoSemRecibo,
} from '@/lib/recibos';

/** Quantas linhas aparecem antes do "ver todos" — o resto fica a um toque. */
const PRIMEIRAS = 4;

/**
 * O TRABALHO: dinheiro que entrou no caixa e ainda não tem papel.
 *
 * Este bloco é a razão de a tela existir. Um gerador de recibos que só sabe
 * gerar resolve metade do problema do sindicato — a outra metade é LEMBRAR,
 * três semanas depois, que aquele repasse de R$ 5.000 nunca teve recibo.
 *
 * COM A FILA VAZIA ELE VIRA UMA LINHA (`senatepi-painel-quatro-zonas`: bloco
 * vazio não ocupa cartão). E é verde, não cinza: "está tudo em dia" é um
 * desfecho bom, e desfecho bom se vê (`senatepi-cor-e-o-que-pede-alguem`).
 */
export function FilaSemRecibo({
  podeEmitir,
  onEmitir,
}: {
  podeEmitir: boolean;
  onEmitir: (p: PagamentoSemRecibo) => void;
}) {
  const [todos, setTodos] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['recibos', 'pendentes'],
    queryFn: pendentesDeRecibo,
  });

  if (isLoading || !data) return null;

  if (!data.total) {
    return (
      <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
        <CircleCheck className="h-4 w-4 shrink-0" />
        Todo pagamento registrado no caixa já tem recibo.
      </p>
    );
  }

  const visiveis = todos ? data.itens : data.itens.slice(0, PRIMEIRAS);

  return (
    <section className="rounded-2xl border border-amber-300 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/20">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
        <h3 className="flex items-center gap-2 font-semibold text-amber-900 dark:text-amber-200">
          <HandCoins className="h-4 w-4 shrink-0" />
          {data.total === 1
            ? '1 pagamento ainda sem recibo'
            : `${data.total} pagamentos ainda sem recibo`}
        </h3>
        {data.truncada && (
          <span className="text-xs text-amber-800 dark:text-amber-300">
            mostrando os {data.itens.length} mais recentes
          </span>
        )}
      </div>

      <ul className="mt-2 divide-y divide-amber-200/70 dark:divide-amber-900/40">
        {visiveis.map((p) => (
          <li
            key={p.movimentacaoId}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {p.pagadorNome ?? p.descricao}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {formatData(p.data)} · {p.referenteSugerido}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="whitespace-nowrap text-sm font-semibold tabular-nums">
                {formatBRL(p.valor)}
              </span>
              {podeEmitir && (
                <Button size="sm" onClick={() => onEmitir(p)}>
                  <Plus className="h-4 w-4" /> Emitir
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {data.itens.length > PRIMEIRAS && (
        <div className="px-4 pb-3">
          <button
            type="button"
            onClick={() => setTodos((v) => !v)}
            className="text-xs font-medium text-amber-900 underline underline-offset-2 dark:text-amber-200"
          >
            {todos ? 'Mostrar menos' : `Ver os outros ${data.itens.length - PRIMEIRAS}`}
          </button>
        </div>
      )}
    </section>
  );
}
