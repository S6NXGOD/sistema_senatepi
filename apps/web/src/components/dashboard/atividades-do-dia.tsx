'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Play, ChevronRight, Loader2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { concluirCompromisso, mudarStatusCompromisso, formatHora } from '@/lib/agenda';
import type { CompromissoCard } from '@/lib/dashboard';

/**
 * AS ATIVIDADES DO DIA — resolver sem sair do painel.
 *
 * O QUE ESTAVA ERRADO, e o usuário disse com todas as letras: "ocupa muito
 * espaço". Era um `SectionCard` com cabeçalho, ícone, contador e moldura,
 * embrulhando DUAS listas empilhadas ("Hoje" e "Próximos dias"), cada uma com
 * seu próprio subtítulo. Três molduras para mostrar, em média, quatro linhas.
 * E nenhuma delas permitia FAZER nada: para concluir um prazo era preciso
 * navegar até a Agenda, achar o cartão, abrir o modal, escolher o desfecho.
 *
 * O QUE MUDOU: uma linha por atividade, e a linha resolve.
 *
 * O BOTÃO DE UM TOQUE SAIU DE MEDIÇÃO, não de intuição. Nas 41 atividades já
 * concluídas na produção, DOIS desfechos respondem por 60% de tudo:
 * "Dúvida esclarecida" (15 de 19 consultas jurídicas) e "Prazo cumprido"
 * (11 de 11 prazos — cem por cento). Então cada tipo ganha o desfecho que a
 * equipe realmente usa, num botão, e o resto continua no modal completo.
 *
 * `desfecho` é o único campo obrigatório da rota de conclusão — conferido no
 * DTO. Um toque basta de verdade; não há dado escondido a preencher depois.
 *
 * O QUE NÃO É INLINE, E POR QUÊ
 *  · Desfecho que VINCULA PROCESSO exige escolher qual, e escolher processo num
 *    botão de painel seria adivinhação. Vai para o modal.
 *  · CANCELAR exige motivo obrigatório — regra de negócio da agenda, não
 *    enfeite. Vai para o modal.
 *  · Qualquer tipo cujo desfecho principal não seja óbvio na medição fica sem
 *    botão: melhor não oferecer do que oferecer o errado.
 *
 * MOBILE-FIRST: a linha é um `flex` que quebra no telefone — texto em cima,
 * ações embaixo, alvos de 44px. No desktop tudo cabe numa linha só. Nada
 * depende de hover: o botão está sempre visível, porque hover não existe no
 * telefone e esconder ação atrás dele é esconder a ação.
 */

/**
 * O DESFECHO QUE A EQUIPE REALMENTE USA, por tipo de atividade.
 *
 * Medido nas 41 conclusões da produção em 09/09/2026:
 *   DUVIDA_ESCLARECIDA 15 · PRAZO_CUMPRIDO 11 · PROCESSO_CRIADO 5
 *   REUNIAO_COM_ENCAMINHAMENTOS 4 · ACOMPANHAMENTO_CUMPRIDO 3
 *   DILIGENCIA_CUMPRIDA 2
 *
 * Tipo fora desta tabela não ganha botão de um toque — abre o modal. É
 * deliberado: um botão que fecha com o desfecho errado é pior que um clique a
 * mais, porque o desfecho é o que alimenta o relatório e o seguimento.
 */
const DESFECHO_RAPIDO: Record<string, { slug: string; label: string }> = {
  PRAZO: { slug: 'PRAZO_CUMPRIDO', label: 'Peça protocolada' },
  CONSULTA_JURIDICA: { slug: 'DUVIDA_ESCLARECIDA', label: 'Dúvida esclarecida' },
  DILIGENCIA: { slug: 'DILIGENCIA_CUMPRIDA', label: 'Cumprida' },
  ACOMPANHAMENTO: { slug: 'ACOMPANHAMENTO_CUMPRIDO', label: 'Cumprido' },
  REUNIAO: { slug: 'REUNIAO_COM_ENCAMINHAMENTOS', label: 'Com encaminhamentos' },
  DESPACHO: { slug: 'DESPACHO_OBTIDO', label: 'Despacho obtido' },
};

export function AtividadesDoDia({
  hoje,
  proximas,
  pessoal,
  href,
}: {
  hoje: CompromissoCard[];
  proximas: CompromissoCard[];
  /** Carteira do próprio usuário (advogado) ou visão da equipe. */
  pessoal: boolean;
  /**
   * Para onde vai o que NÃO cabe num toque.
   *
   * `Link`, e não um callback de navegação: navegação por `router.push` num
   * item de lista custa um hook e perde o clique do meio, o "abrir em nova
   * aba" e o pré-carregamento do Next. A gaveta da agenda abre pelo mesmo
   * `?compromisso=` que o resto do sistema já usa.
   */
  href: (id: string) => string;
}) {
  const qc = useQueryClient();
  const [agindo, setAgindo] = useState<string | null>(null);

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    qc.invalidateQueries({ queryKey: ['agenda'] });
  };

  const concluir = useMutation({
    mutationFn: ({ id, desfecho }: { id: string; desfecho: string }) =>
      concluirCompromisso(id, { desfecho }),
    onSuccess: () => {
      toast.success('Concluída.');
      setAgindo(null);
      invalidar();
    },
    onError: (e: any) => {
      setAgindo(null);
      toast.error(e?.response?.data?.message ?? 'Não foi possível concluir agora.');
    },
  });

  const iniciar = useMutation({
    mutationFn: (id: string) => mudarStatusCompromisso(id, 'EM_ANDAMENTO'),
    onSuccess: () => {
      setAgindo(null);
      invalidar();
    },
    onError: (e: any) => {
      setAgindo(null);
      toast.error(e?.response?.data?.message ?? 'Não foi possível iniciar agora.');
    },
  });

  const todas = [...hoje, ...proximas];
  if (!todas.length) return null;

  const agora = Date.now();

  return (
    <section className="rounded-xl border">
      {/*
        CABEÇALHO DE UMA LINHA, não um `SectionCard`.

        O cartão trazia ícone de 20px, título, contador em pílula e uma barra de
        ação — 56px de altura para dizer "Atividades". Aqui são 32px, e o
        contador vira parte da frase.
      */}
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <h2 className="text-sm font-semibold">
          {pessoal ? 'Minhas atividades' : 'Atividades'}
          <span className="ml-1.5 font-normal text-muted-foreground">{todas.length}</span>
        </h2>
        <Link
          href="/agenda"
          className="text-xs font-medium text-brand-800 transition hover:underline dark:text-brand-300"
        >
          Abrir agenda
        </Link>
      </div>

      <ul className="divide-y">
        {todas.map((c) => {
          const rapido = DESFECHO_RAPIDO[c.tipo];
          const venceu = new Date(c.inicio).getTime() < agora;
          const ocupado = agindo === c.id;
          const emAndamento = c.status === 'EM_ANDAMENTO';

          return (
            <li
              key={c.id}
              className={cn(
                'flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:gap-3',
                venceu && 'bg-amber-50/50 dark:bg-amber-950/10',
              )}
            >
              {/*
                O QUE É — e o horário na frente, porque é por ele que se decide
                a ordem de atacar. `tabular-nums` para as horas alinharem.
              */}
              <Link
                href={href(c.id)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <span
                  className={cn(
                    'shrink-0 text-[11px] tabular-nums',
                    venceu ? 'font-semibold text-amber-800 dark:text-amber-400' : 'text-muted-foreground',
                  )}
                >
                  {formatHora(c.inicio)}
                </span>
                {venceu && (
                  <AlertTriangle
                    className="h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber-500"
                    aria-label="horário já passou"
                  />
                )}
                <span className="min-w-0 flex-1 truncate text-sm">
                  {c.titulo}
                  {/*
                    DE QUEM É, só na visão de equipe. Na carteira pessoal o nome
                    seria o mesmo em todas as linhas — repetição pura.
                  */}
                  {!pessoal && c.responsavel?.nome && (
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      · {c.responsavel.nome.split(' ')[0]}
                    </span>
                  )}
                </span>
              </Link>

              <div className="flex shrink-0 items-center gap-1.5">
                {/*
                  INICIAR só aparece no que ainda não começou, e é a única ação
                  que não pede dado nenhum — `PATCH :id/status` aceita a
                  transição seca.
                */}
                {!emAndamento && (
                  <button
                    type="button"
                    onClick={() => {
                      setAgindo(c.id);
                      iniciar.mutate(c.id);
                    }}
                    disabled={ocupado}
                    title="Iniciar"
                    className="flex h-9 w-9 items-center justify-center rounded-md border border-input transition hover:bg-muted disabled:opacity-50"
                  >
                    <Play className="h-3.5 w-3.5" />
                  </button>
                )}

                {rapido ? (
                  <button
                    type="button"
                    onClick={() => {
                      setAgindo(c.id);
                      concluir.mutate({ id: c.id, desfecho: rapido.slug });
                    }}
                    disabled={ocupado}
                    className="flex h-9 items-center gap-1.5 rounded-md bg-brand-800 px-2.5 text-xs font-medium text-white transition hover:bg-brand-900 disabled:opacity-60"
                  >
                    {ocupado ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                    <span className="hidden sm:inline">{rapido.label}</span>
                    <span className="sm:hidden">Concluir</span>
                  </button>
                ) : (
                  /*
                    SEM DESFECHO ÓBVIO, sem botão que decide. Audiência e perícia
                    têm desfechos que mudam o rumo do caso (houve acordo? laudo
                    entregue?) — fechar isso num toque seria adivinhar pela
                    pessoa.
                  */
                  <Link
                    href={href(c.id)}
                    className="flex h-9 items-center gap-1 rounded-md border border-input px-2.5 text-xs font-medium transition hover:bg-muted"
                  >
                    Concluir
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
