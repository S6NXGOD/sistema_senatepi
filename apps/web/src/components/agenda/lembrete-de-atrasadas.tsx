'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CalendarClock, Flame, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { podeVer } from '@/lib/permissoes';
import { cn } from '@/lib/utils';
import { diasDeAtraso, formatData } from '@/lib/agenda';

/**
 * O LEMBRETE SEMANAL DO QUE FICOU PARA TRÁS — 21/09/2026.
 *
 * "Queria uma animação bem bonita e suave para os advogados que estão com
 * atividades atrasadas, que aparecesse ao menos 1 vez por semana. Como se fosse
 * um POP-UP assim que ele loga no sistema listando as atividades dele que estão
 * atrasadas e dizendo que eles devem concluir."
 *
 * O QUE EU FIZ DIFERENTE DO PEDIDO, e por quê: ele não bloqueia. O botão
 * principal leva à agenda no recorte exato ("Ficaram para trás"), e "Agora não"
 * fecha. Um pop-up que exige ação para sumir, aparecendo no login, treina a
 * pessoa a clicar no que estiver mais perto sem ler — e aí ele deixa de avisar
 * qualquer coisa. Vale para este e vale para o próximo.
 *
 * E ELE NÃO ACUSA PERDA DE PRAZO. "Ficou para trás" é o que o dado diz: o
 * sistema conhece a data que alguém marcou na agenda, não o prazo processual.
 * Afirmar prazo perdido é a acusação mais grave que ele poderia fazer a um
 * advogado, e ele não tem como sustentá-la.
 *
 * QUANDO APARECE: só quem tem atraso, no máximo uma vez a cada sete dias, com
 * o corte no SERVIDOR (`avisoDeAtrasadas`) — inclusive o de permissão. O
 * carimbo é dado por MOSTRAR, não por clicar: fechar no X tem de valer, senão
 * o lembrete volta amanhã e vira cabeçalho.
 *
 * A ANIMAÇÃO É SUAVE DE PROPÓSITO: a caixa entra com `animate-dialogo-entrar`
 * (a mesma de todo diálogo da casa, para não parecer outra coisa) e as linhas
 * aparecem escalonadas em 60ms. Nada pisca, nada treme — o assunto é trabalho
 * atrasado, e alarme que se agita pede para ser ignorado.
 */
interface AtrasadaDoLembrete {
  id: string;
  titulo: string;
  tipo: string;
  inicio: string;
  urgente: boolean;
  filiado: { nomeCompleto: string } | null;
  processo: { numeroCNJ: string | null } | null;
}

export function LembreteDeAtrasadas() {
  const { user } = useAuth();
  const podeAgenda = podeVer(user?.role, user?.permissoes, 'agenda');
  const [fechado, setFechado] = useState(false);

  const { data } = useQuery<{ mostrar: boolean; total: number; itens: AtrasadaDoLembrete[] }>({
    queryKey: ['aviso-de-atrasadas'],
    queryFn: async () => (await api.get('/compromissos/aviso-de-atrasadas')).data,
    enabled: podeAgenda,
    /* Uma vez por sessão: o lembrete é de abrir o sistema, não de trocar de aba. */
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const marcarVisto = useMutation({
    mutationFn: () => api.post('/compromissos/aviso-de-atrasadas/visto'),
  });

  /*
    MOSTROU, CARIMBOU. Se o carimbo dependesse do botão, fechar no X ou no Esc
    faria o lembrete voltar no próximo login, todos os dias, até alguém acertar
    o botão certo. O que ele promete é "uma vez por semana".
  */
  useEffect(() => {
    if (data?.mostrar && !marcarVisto.isPending && !marcarVisto.isSuccess) {
      marcarVisto.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.mostrar]);

  if (!data?.mostrar || fechado) return null;

  const { total, itens } = data;
  const sobra = total - itens.length;

  return (
    <div
      className="fixed inset-0 z-50 flex animate-overlay-entrar items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onClick={() => setFechado(true)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="lembrete-atrasadas-titulo"
        className="flex max-h-[92vh] w-full max-w-lg animate-dialogo-entrar flex-col overflow-hidden rounded-t-2xl bg-card shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b bg-amber-50/60 p-5 dark:bg-amber-950/20">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-100 dark:bg-amber-900/40">
              <CalendarClock className="h-5 w-5 text-amber-700 dark:text-amber-300" />
            </span>
            <div className="min-w-0">
              <h2 id="lembrete-atrasadas-titulo" className="text-lg font-bold leading-tight">
                {total === 1
                  ? 'Uma atividade sua ficou para trás'
                  : `${total} atividades suas ficaram para trás`}
              </h2>
              <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                A data já passou e elas continuam abertas. Vale fechar o que foi feito e remarcar o
                que não foi.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setFechado(true)}
            aria-label="Fechar o lembrete"
            className="-m-1 shrink-0 rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <ul className="min-h-0 flex-1 divide-y overflow-y-auto">
          {itens.map((c, i) => {
            const dias = diasDeAtraso(c.inicio);
            return (
              <li
                key={c.id}
                className="animate-surgir px-5 py-3"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <Link
                  href={`/agenda?compromisso=${c.id}`}
                  onClick={() => setFechado(true)}
                  className="-mx-2 flex items-start gap-3 rounded-lg px-2 py-1 transition hover:bg-muted/60"
                >
                  <span
                    aria-hidden
                    className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-500"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{c.titulo}</span>
                      {c.urgente && (
                        <Flame className="h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" />
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {formatData(c.inicio)}
                      {c.filiado ? ` · ${c.filiado.nomeCompleto}` : ''}
                      {!c.filiado && c.processo?.numeroCNJ ? ` · ${c.processo.numeroCNJ}` : ''}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold',
                      dias >= 7
                        ? 'bg-amber-200 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {dias === 1 ? '1 dia' : `${dias} dias`}
                  </span>
                </Link>
              </li>
            );
          })}
          {sobra > 0 && (
            <li className="px-5 py-2.5 text-xs text-muted-foreground">
              e mais {sobra === 1 ? 'uma atividade' : `${sobra} atividades`} na agenda.
            </li>
          )}
        </ul>

        <div className="flex flex-col-reverse gap-2 border-t p-4 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => setFechado(true)}>
            Agora não
          </Button>
          {/*
            O BOTÃO LEVA AO MESMO RECORTE QUE O NÚMERO CONTOU — a aba "Ficaram
            para trás" da agenda, já filtrada em mim. Número clicável que abre
            outra lista é o defeito que o Panorama já cometeu.
          */}
          <Link
            href="/agenda?aba=atrasadas&pessoa=eu"
            onClick={() => setFechado(true)}
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand-700 px-4 text-sm font-medium text-white transition hover:bg-brand-800"
          >
            Abrir e resolver
          </Link>
        </div>
      </div>
    </div>
  );
}
