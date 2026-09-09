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
const DESFECHO_RAPIDO: Record<string, { slug: string; label: string; exigeObs?: boolean }> = {
  PRAZO: { slug: 'PRAZO_CUMPRIDO', label: 'Peça protocolada' },
  DILIGENCIA: { slug: 'DILIGENCIA_CUMPRIDA', label: 'Cumprida' },
  /*
    OS QUE PEDEM UMA LINHA — e a primeira versão deste bloco os quebrava.

    Quatro desfechos do catálogo têm `exigeObs`, e o serviço RECUSA a conclusão
    sem observação (`agenda.service.ts`: "if (opcao.exigeObs && !obs) throw").
    Eu montei o botão de um toque para os seis sem conferir essa flag — e o
    mais usado do sistema, "Dúvida esclarecida" (15 das 41 conclusões), era um
    dos quatro. O botão mais apertado seria o que devolvia 400.

    A regra existe por um bom motivo: nesses desfechos a observação É o
    registro. "Dúvida esclarecida" sem dizer qual dúvida não serve a ninguém
    que abrir o processo depois.

    Então eles não perdem o atalho — ganham um campo de uma linha ali mesmo.
    Continua sem sair do painel, sem modal, sem navegação.
  */
  CONSULTA_JURIDICA: { slug: 'DUVIDA_ESCLARECIDA', label: 'Dúvida esclarecida', exigeObs: true },
  ACOMPANHAMENTO: { slug: 'ACOMPANHAMENTO_CUMPRIDO', label: 'Cumprido', exigeObs: true },
  REUNIAO: { slug: 'REUNIAO_COM_ENCAMINHAMENTOS', label: 'Com encaminhamentos', exigeObs: true },
  DESPACHO: { slug: 'DESPACHO_OBTIDO', label: 'Despacho obtido', exigeObs: true },
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
  /** Id da linha com o campo de observação aberto — só uma por vez. */
  const [anotando, setAnotando] = useState<string | null>(null);

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    qc.invalidateQueries({ queryKey: ['agenda'] });
  };

  const concluir = useMutation({
    mutationFn: ({ id, desfecho, obs }: { id: string; desfecho: string; obs?: string }) =>
      concluirCompromisso(id, { desfecho, ...(obs ? { desfechoObs: obs } : {}) }),
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

  /*
    A AGENDA DA EQUIPE NÃO CABE NUM PAINEL — e era o bloco mais alto de todos.

    No escopo GLOBAL (administrador e coordenação) a API manda a agenda de todo
    mundo: medido, 8 de hoje + 6 dos próximos dias = 14 linhas, ≈1.230px. Mais
    de duas dobras de telefone com o trabalho ALHEIO, no painel de quem não vai
    executar nenhuma delas.

    Na carteira pessoal não há corte: as próprias atividades são exatamente o
    que a pessoa veio ver, e Morgana no pior dia tem cinco.

    O corte é de EXIBIÇÃO, não de dado: o rodapé diz quantas ficaram e leva à
    agenda, onde elas estão inteiras e filtráveis. Esconder sem contar seria
    mentir sobre o tamanho da fila.
  */
  const TETO_EQUIPE = 5;
  const visiveis = pessoal ? todas : todas.slice(0, TETO_EQUIPE);
  const ocultas = todas.length - visiveis.length;

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
        {visiveis.map((c) => {
          const rapido = DESFECHO_RAPIDO[c.tipo];
          const venceu = new Date(c.inicio).getTime() < agora;
          const ocupado = agindo === c.id;
          const emAndamento = c.status === 'EM_ANDAMENTO';

          return (
            <li
              key={c.id}
              className={cn(
                'flex flex-col gap-2 px-3 py-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3',
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
                {/*
                  A DATA APARECE QUANDO NÃO É HOJE — e a falta dela era um bug.

                  A lista junta hoje e os próximos sete dias numa leitura
                  cronológica só. Mostrando apenas a hora, "09:00" numa linha de
                  amanhã se lê exatamente como um atraso de hoje: a pessoa acha
                  que perdeu o horário. O bloco antigo separava em duas listas e
                  ligava a data só na de baixo; aqui a lista é uma, então a data
                  entra por LINHA.
                */}
                <span
                  className={cn(
                    'shrink-0 text-[11px] tabular-nums',
                    venceu ? 'font-semibold text-amber-800 dark:text-amber-400' : 'text-muted-foreground',
                  )}
                >
                  {ehDeHoje(c.inicio) ? formatHora(c.inicio) : etiquetaDeDia(c.inicio)}
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
                      if (rapido.exigeObs) {
                        setAnotando(anotando === c.id ? null : c.id);
                        return;
                      }
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

              {/*
                O CAMPO DE UMA LINHA — para os desfechos em que a observação É o
                registro. Fica na própria linha: sem modal, sem navegação.
                `Enter` conclui, que é o gesto de quem digita uma frase curta.
              */}
              {anotando === c.id && rapido?.exigeObs && (
                <div className="flex w-full gap-2 pt-1 sm:pl-16">
                  <input
                    autoFocus
                    placeholder={`${rapido.label} — o que houve?`}
                    disabled={ocupado}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      const obs = (e.target as HTMLInputElement).value.trim();
                      if (!obs) return;
                      setAgindo(c.id);
                      setAnotando(null);
                      concluir.mutate({ id: c.id, desfecho: rapido.slug, obs });
                    }}
                    className="h-11 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-sm sm:h-9"
                  />
                  <button
                    type="button"
                    onClick={() => setAnotando(null)}
                    className="h-11 shrink-0 rounded-md px-2.5 text-xs text-muted-foreground transition hover:bg-muted sm:h-9"
                  >
                    Cancelar
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {ocultas > 0 && (
        <Link
          href="/agenda"
          className="flex items-center justify-between gap-2 border-t px-3 py-2 text-xs font-medium text-brand-800 transition hover:bg-muted/60 dark:text-brand-300"
        >
          Mais {ocultas} da equipe na agenda
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </section>
  );
}

/** O dia de Teresina do instante, para comparar dia com dia. */
function diaBR(iso: string): string {
  return new Date(new Date(iso).getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
}

function ehDeHoje(iso: string): boolean {
  return diaBR(iso) === diaBR(new Date().toISOString());
}

/**
 * "AMANHÃ 09:00", "QUI 09:00" — a data mínima que impede a leitura errada.
 *
 * Dia inteiro por extenso gastaria a largura que o título precisa no telefone;
 * a hora sozinha faz amanhã parecer atraso. Três letras do dia da semana
 * resolvem, e "amanhã" ganha a palavra porque é o caso mais frequente.
 *
 * Fuso de Teresina, como o resto do sistema: `new Date()` cru no contêiner UTC
 * vira o dia às 21h e mostraria "amanhã" a noite inteira.
 */
function etiquetaDeDia(iso: string): string {
  const hora = formatHora(iso);
  const dias = Math.round(
    (new Date(diaBR(iso)).getTime() - new Date(diaBR(new Date().toISOString())).getTime()) /
      86_400_000,
  );
  if (dias === 1) return `amanhã ${hora}`;
  if (dias < 0) return `${new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${hora}`;
  const semana = new Date(iso).toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
  return `${semana} ${hora}`;
}
