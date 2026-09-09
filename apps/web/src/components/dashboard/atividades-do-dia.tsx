'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Play, ChevronRight, Loader2, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  concluirCompromisso,
  mudarStatusCompromisso,
  formatHora,
  corDeTipo,
  rotuloTipo,
} from '@/lib/agenda';
import { useTiposEvento } from '@/lib/use-tipos-evento';
import { STATUS_COMP_COR, STATUS_COMP_LABEL } from '@/lib/dashboard';
import { AvatarMini } from '@/components/dashboard/widgets';
import { SeloUrgente } from '@/components/ui/selo-urgente';
import { parteContrariaDoProcesso } from '@/components/agenda/identidade-do-processo';
import { contar } from '@/lib/plural';
import type { CompromissoCard } from '@/lib/dashboard';

/**
 * A FILA DE TRABALHO DO PAINEL — uma só, e ela resolve.
 *
 * TRÊS BLOCOS VIRARAM UM. O painel mostrava o mesmo trabalho três vezes: uma
 * barra amarela contando as atrasadas, esta lista marcando-as de âmbar, e um
 * cartão "Pendências ativas" no rodapé listando-as de novo. Medido em
 * 08/09/2026: das 8 pendências, AS 8 já estavam na lista de hoje. Agora a fila
 * é `atrasadas → hoje → próximos sete dias` em ordem cronológica pura — o
 * atrasado é o mais antigo, então sobe sozinho, sem precisar de bloco próprio.
 *
 * O DESENHO VOLTOU A TER CONTEÚDO, e essa foi crítica direta do usuário: "a UI
 * ficou muito feia". Estava, e o motivo não era só estética. Ao trocar o bloco
 * antigo por linhas de uma altura, eu tinha jogado fora TUDO que distinguia uma
 * atividade da outra: o rótulo do tipo, a cor do tipo, o filiado, contra quem é
 * o processo, o local, o selo de urgência, o chip de status e o avatar de quem
 * responde. Sobrou hora + título + um botão verde saturado por linha — cinco
 * botões iguais empilhados, que é o que a vista pega primeiro numa coluna.
 *
 * O que voltou:
 *  · barra colorida do TIPO à esquerda (a mesma paleta da Agenda);
 *  · título, selo de urgência e etiqueta "Atrasada" quando for o caso;
 *  · segunda linha com tipo · quando · filiado · contra quem · local;
 *  · avatar de quem responde (só na visão de equipe — na pessoal seria o mesmo
 *    rosto em todas as linhas);
 *  · ações à direita, com o botão de um toque em tom claro, não em bloco
 *    sólido: ele precisa ser encontrável, não ser o assunto da tela.
 *
 * O BOTÃO DE UM TOQUE SAIU DE MEDIÇÃO. Nas 41 atividades concluídas na
 * produção, dois desfechos respondem por 60%: "Dúvida esclarecida" (15 de 19
 * consultas) e "Prazo cumprido" (11 de 11 prazos). Cada tipo ganha o desfecho
 * que a equipe usa; o resto continua no modal completo.
 *
 * MOBILE-FIRST: no telefone o conteúdo ocupa a largura e as ações caem embaixo,
 * alinhadas à direita, com alvo de 44px. No desktop cabe em duas linhas com as
 * ações numa coluna própria e alvos de 32px. Nada depende de hover — hover não
 * existe no telefone, e esconder ação atrás dele é esconder a ação.
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
    Eu montei o botão de um toque para os seis sem conferir essa flag — e o mais
    usado do sistema, "Dúvida esclarecida" (15 das 41 conclusões), era um dos
    quatro. O botão mais apertado seria o que devolvia 400.

    A regra existe por um bom motivo: nesses desfechos a observação É o
    registro. "Dúvida esclarecida" sem dizer qual dúvida não serve a ninguém que
    abrir o processo depois.

    Então eles não perdem o atalho — ganham um campo de uma linha ali mesmo.
  */
  CONSULTA_JURIDICA: { slug: 'DUVIDA_ESCLARECIDA', label: 'Dúvida esclarecida', exigeObs: true },
  ACOMPANHAMENTO: { slug: 'ACOMPANHAMENTO_CUMPRIDO', label: 'Cumprido', exigeObs: true },
  REUNIAO: { slug: 'REUNIAO_COM_ENCAMINHAMENTOS', label: 'Com encaminhamentos', exigeObs: true },
  DESPACHO: { slug: 'DESPACHO_OBTIDO', label: 'Despacho obtido', exigeObs: true },
};

export function AtividadesDoDia({
  atrasadas,
  hoje,
  proximas,
  pessoal,
  href,
}: {
  /** Abertas que venceram em DIA ANTERIOR — as de hoje já vêm em `hoje`. */
  atrasadas: CompromissoCard[];
  hoje: CompromissoCard[];
  proximas: CompromissoCard[];
  /** Carteira própria: sem nome de responsável repetido e sem teto de linhas. */
  pessoal: boolean;
  /**
   * Para onde vai o que NÃO cabe num toque.
   *
   * `Link`, e não um callback de navegação: navegação por `router.push` num
   * item de lista custa um hook e perde o clique do meio, o "abrir em nova aba"
   * e o pré-carregamento do Next.
   */
  href: (id: string) => string;
}) {
  const qc = useQueryClient();
  const { tipos } = useTiposEvento();
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

  /*
    ORDEM CRONOLÓGICA PURA, e ela já resolve a prioridade.

    O atrasado é, por definição, o mais antigo — ordenar por `inicio` põe as
    pendências no topo sem cabeçalho de seção e sem um segundo bloco. As três
    listas vêm de consultas separadas, então a concatenação pode intercalar:
    reordena-se uma vez, aqui.
  */
  const todas = [...atrasadas, ...hoje, ...proximas].sort(
    (a, b) => new Date(a.inicio).getTime() - new Date(b.inicio).getTime(),
  );
  if (!todas.length) return null;

  const agora = Date.now();
  const estaAtrasada = (c: CompromissoCard) =>
    (c.status === 'PENDENTE' || c.status === 'EM_ANDAMENTO') &&
    new Date(c.inicio).getTime() < agora;
  const quantasAtrasadas = todas.filter(estaAtrasada).length;

  /*
    A AGENDA DA EQUIPE NÃO CABE NUM PAINEL — e era o bloco mais alto de todos.

    No escopo GLOBAL (administrador e coordenação) a API manda a agenda de todo
    mundo: medido, 8 de hoje + 6 dos próximos dias = 14 linhas, ≈1.230px. Mais
    de duas dobras de telefone com o trabalho ALHEIO, no painel de quem não vai
    executar nenhuma delas.

    Na carteira pessoal não há corte: as próprias atividades são exatamente o
    que a pessoa veio ver, e Morgana no pior dia tem cinco.

    O corte é de EXIBIÇÃO, não de dado: o rodapé diz quantas ficaram e leva à
    agenda, onde elas estão inteiras e filtráveis.
  */
  const TETO_EQUIPE = 5;
  const visiveis = pessoal ? todas : todas.slice(0, TETO_EQUIPE);
  const ocultas = todas.length - visiveis.length;

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      {/*
        CABEÇALHO DE UMA LINHA, não um `SectionCard` — 32px contra 56px.

        O contador de atrasadas mora aqui, e é o que sobrou da barra amarela que
        existia acima do painel: o número no lugar onde se age, em vez de um
        aviso duzentos pixels antes do trabalho.
      */}
      <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          {pessoal ? 'Minhas atividades' : 'Atividades'}
          <span className="font-normal text-muted-foreground">{todas.length}</span>
          {quantasAtrasadas > 0 && (
            <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
              {contar(quantasAtrasadas, 'atrasada', 'atrasadas')}
            </span>
          )}
        </h2>
        <Link
          href="/agenda"
          className="shrink-0 text-xs font-medium text-brand-800 transition hover:underline dark:text-brand-300"
        >
          Abrir agenda
        </Link>
      </div>

      <ul className="divide-y">
        {visiveis.map((c) => {
          const rapido = DESFECHO_RAPIDO[c.tipo];
          const aberta = c.status === 'PENDENTE' || c.status === 'EM_ANDAMENTO';
          const atrasada = estaAtrasada(c);
          const ocupado = agindo === c.id;
          const emAndamento = c.status === 'EM_ANDAMENTO';
          const contra = parteContrariaDoProcesso(c.processo);

          return (
            <li
              key={c.id}
              className={cn(
                'flex flex-col gap-2 px-3 py-2.5 transition sm:flex-row sm:flex-wrap sm:items-center sm:gap-3',
                atrasada ? 'bg-amber-50/60 dark:bg-amber-950/10' : 'hover:bg-muted/40',
              )}
            >
              {/*
                A BARRA DO TIPO — a mesma paleta da Agenda, para o olho
                reconhecer "prazo" antes de ler a palavra. Só no desktop: no
                telefone a largura é do texto, e o chip do tipo na segunda linha
                já carrega a mesma cor.
              */}
              <span
                className={cn(
                  'hidden w-1 shrink-0 self-stretch rounded-full sm:block',
                  corDeTipo(c.tipo, tipos).ponto,
                )}
                aria-hidden
              />

              <Link href={href(c.id)} className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{c.titulo}</span>
                  {c.urgente && (
                    <SeloUrgente motivo={c.urgenteMotivo} desde={c.urgenteEm} tamanho="sm" />
                  )}
                  {atrasada && (
                    /*
                      ÂMBAR, NUNCA VERMELHO — e a razão é factual, não estética.

                      O sistema NÃO calcula vencimento processual: ele sabe
                      apenas que o horário agendado passou. Das 8 "atrasadas"
                      medidas na produção, 7 eram "Cadastrar ação do Diário"
                      marcadas para as 15h do próprio dia — nenhuma delas é
                      perda de prazo. Vermelho afirma falha; âmbar chama atenção,
                      que é tudo o que o dado sustenta.
                    */
                    <span className="shrink-0 rounded bg-amber-500 px-1.5 py-px text-[10px] font-bold uppercase leading-4 text-white dark:bg-amber-600">
                      Atrasada
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
                  <span
                    className={cn(
                      'shrink-0 rounded px-1.5 py-px font-medium',
                      corDeTipo(c.tipo, tipos).badge,
                    )}
                  >
                    {rotuloTipo(c.tipo, tipos)}
                  </span>
                  {/*
                    A DATA APARECE QUANDO NÃO É HOJE — e a falta dela era um bug.
                    A fila junta dias diferentes numa leitura cronológica só;
                    mostrando apenas a hora, "09:00" numa linha de amanhã se lê
                    exatamente como um atraso de hoje.
                  */}
                  <span className="shrink-0 tabular-nums">
                    {ehDeHoje(c.inicio) ? formatHora(c.inicio) : etiquetaDeDia(c.inicio)}
                  </span>
                  {c.filiado && <span className="truncate">· {c.filiado.nomeCompleto}</span>}
                  {/*
                    CONTRA QUEM — o que distingue duas linhas de mesmo título.
                    "Avaliar recurso" é categoria, não identidade; sem isto, duas
                    atividades de processos diferentes ficam idênticas.
                  */}
                  {contra && <span className="truncate">· contra {contra}</span>}
                  {c.local && <span className="truncate">· {c.local}</span>}
                </div>
              </Link>

              <div className="flex shrink-0 items-center justify-end gap-1.5">
                {/*
                  DE QUEM É — só na visão de equipe; na carteira pessoal seria o
                  mesmo rosto em todas as linhas.
                */}
                {!pessoal && c.responsavel && <AvatarMini pessoa={c.responsavel} size={24} />}

                {/*
                  O CHIP DE STATUS só aparece no que NÃO está aberto: para uma
                  linha aberta ele diria "Pendente" ao lado de um botão de
                  concluir, que é a mesma informação dita duas vezes. Concluída e
                  cancelada de hoje continuam na lista (é o registro do dia) e aí
                  o chip é a única coisa que as explica.
                */}
                {!aberta && (
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                      STATUS_COMP_COR[c.status],
                    )}
                  >
                    {STATUS_COMP_LABEL[c.status]}
                  </span>
                )}

                {aberta && !emAndamento && (
                  <button
                    type="button"
                    onClick={() => {
                      setAgindo(c.id);
                      iniciar.mutate(c.id);
                    }}
                    disabled={ocupado}
                    title="Iniciar"
                    aria-label={`Iniciar ${c.titulo}`}
                    className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50 sm:h-8 sm:w-8"
                  >
                    <Play className="h-3.5 w-3.5" />
                  </button>
                )}

                {aberta &&
                  (rapido ? (
                    /*
                      TOM CLARO, NÃO BLOCO SÓLIDO.

                      Cinco botões verdes saturados empilhados eram a primeira
                      coisa que a vista pegava — mais fortes que os títulos das
                      atividades, que são o assunto. Em tom claro com borda o
                      botão continua óbvio e para de competir; no hover ele
                      enche, confirmando que é o gesto principal.
                    */
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
                      className="flex h-11 items-center gap-1.5 rounded-md border border-brand-200 bg-brand-50 px-2.5 text-xs font-medium text-brand-900 transition hover:bg-brand-800 hover:text-white disabled:opacity-60 sm:h-8 dark:border-brand-800/60 dark:bg-brand-900/30 dark:text-brand-200 dark:hover:bg-brand-700"
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
                      SEM DESFECHO ÓBVIO, sem botão que decide. Audiência e
                      perícia têm desfechos que mudam o rumo do caso (houve
                      acordo? laudo entregue?) — fechar isso num toque seria
                      adivinhar pela pessoa.
                    */
                    <Link
                      href={href(c.id)}
                      title="Abrir para concluir"
                      aria-label={`Abrir ${c.titulo}`}
                      className="flex h-11 items-center gap-1 rounded-md border border-input px-2.5 text-xs font-medium transition hover:bg-muted sm:h-8"
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Concluir</span>
                    </Link>
                  ))}
              </div>

              {/*
                O CAMPO DE UMA LINHA — para os desfechos em que a observação É o
                registro. Fica na própria linha: sem modal, sem navegação.
                `Enter` conclui, que é o gesto de quem digita uma frase curta.
              */}
              {anotando === c.id && rapido?.exigeObs && (
                <div className="flex w-full gap-2 pt-1 sm:basis-full sm:pl-4">
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
 * "AMANHÃ 09:00", "QUI 09:00", "05/09 15:00" — a data mínima que impede a
 * leitura errada.
 *
 * Dia inteiro por extenso gastaria a largura que o título precisa no telefone;
 * a hora sozinha faz amanhã parecer atraso. Três letras do dia da semana
 * resolvem, "amanhã" ganha a palavra por ser o caso mais frequente, e o que
 * ficou para trás mostra a data cheia — é a informação que explica o vermelho.
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
  if (dias < 0) {
    return `${new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${hora}`;
  }
  const semana = new Date(iso).toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
  return `${semana} ${hora}`;
}
