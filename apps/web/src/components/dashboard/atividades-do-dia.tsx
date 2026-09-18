'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Play, ChevronRight, ChevronDown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { podeEditar } from '@/lib/permissoes';
import {
  formatHora,
  corDeTipo,
  rotuloTipo,
  estadoDoPrazo,
  listarDesfechos,
  getCompromisso,
  type CompromissoDetalhe,
} from '@/lib/agenda';
import { useTiposEvento } from '@/lib/use-tipos-evento';
import { STATUS_COMP_COR, STATUS_COMP_LABEL, linkDaAgenda, textoDoRodapeDasAtividades } from '@/lib/dashboard';
import { botaoDaLinha, podeIniciarNoPainel, rotuloDoBotao, type BotaoDaLinha } from '@/lib/acao-rapida';
import { AvatarMini } from '@/components/dashboard/widgets';
import { SeloUrgente } from '@/components/ui/selo-urgente';
import { parteContrariaDoProcesso } from '@/components/agenda/identidade-do-processo';
import { ConcluirModal } from '@/components/agenda/concluir-modal';
import { FolhaDeDesfecho } from '@/components/dashboard/folha-de-desfecho';
import { useConcluirNoPainel } from '@/components/dashboard/concluir-no-painel';
import { contar, plural } from '@/lib/plural';
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
 * A linha diz o que distingue uma atividade da outra: a cor e o rótulo do tipo,
 * o selo de urgência, "Atrasada" quando for o caso, quando, o filiado, contra
 * quem, o local, e o rosto de quem responde na visão de equipe.
 *
 * O BOTÃO DA LINHA LÊ O CATÁLOGO DA API — e deixou de ser uma tabela no front.
 *
 * Havia aqui um `DESFECHO_RAPIDO` escrito à mão, um desfecho por tipo, tirado de
 * 41 conclusões. Ele produzia desfecho falso por falta de opção: a reunião sem
 * deliberação só fechava "com encaminhamentos" (e a API criava, calada, uma
 * tarefa obrigatória na agenda de alguém), o prazo de análise só virava "Peça
 * protocolada", e "Cadastrar ação do Diário" fechava como "Cumprida" sem ação
 * nenhuma no acervo. A regra agora mora em `botaoDaLinha` (lib/acao-rapida,
 * testada com o catálogo): o primário é a PRIMEIRA opção sem ação nem alerta;
 * sem ela, ou em atividade de outra pessoa, abre a folha com todas as opções.
 *
 * MOBILE-FIRST: no telefone o conteúdo ocupa a largura e as ações caem embaixo,
 * alinhadas à direita, com alvo de 44px — e o botão diz o desfecho que grava,
 * também no telefone. Nada depende de hover.
 */

/** Tom claro, não bloco sólido: o botão precisa ser achável, não ser o assunto da tela. */
const BOTAO_CLARO =
  'flex h-11 min-w-0 items-center gap-1.5 rounded-md border border-brand-200 bg-brand-50 px-2.5 text-xs font-medium text-brand-900 transition hover:bg-brand-800 hover:text-white disabled:opacity-60 sm:h-8 dark:border-brand-800/60 dark:bg-brand-900/30 dark:text-brand-200 dark:hover:bg-brand-700';

/** O botão que abre a folha: contorno, porque não grava nada no toque. */
const BOTAO_FOLHA =
  'flex h-11 min-w-0 items-center gap-1 rounded-md border border-input px-2.5 text-xs font-medium transition hover:bg-muted disabled:opacity-60 sm:h-8';

type BotaoDeFolha = Extract<BotaoDaLinha, { tipo: 'FOLHA' }>;

export function AtividadesDoDia({
  atrasadas,
  hoje,
  proximas,
  totalAtrasadas,
  totalPassaramDaHora,
  pessoal,
  cobra,
  href,
}: {
  /** Abertas que venceram em DIA ANTERIOR — as de hoje já vêm em `hoje`. */
  atrasadas: CompromissoCard[];
  hoje: CompromissoCard[];
  proximas: CompromissoCard[];
  /**
   * OS CONTADORES VÊM DA API, NÃO DO TAMANHO DA LISTA — e a diferença importa.
   *
   * As três consultas têm `take:`. Contar as linhas que chegaram diria "3
   * atrasadas" quando existem 14, e o painel estaria mentindo para menos
   * justamente no número que não pode errar. Estes vêm de `count()` sem teto,
   * no mesmo escopo (`meu`) das listas.
   */
  totalAtrasadas: number;
  totalPassaramDaHora: number;
  /** Carteira própria: sem nome de responsável repetido e sem teto de linhas. */
  pessoal: boolean;
  /** Mostra o placar nominal por pessoa — só para quem COBRA (gestão). */
  cobra?: boolean;
  /**
   * Para onde vai o título da linha.
   *
   * `Link`, e não um callback de navegação: navegação por `router.push` num
   * item de lista custa um hook e perde o clique do meio, o "abrir em nova aba"
   * e o pré-carregamento do Next.
   */
  href: (id: string) => string;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { tipos } = useTiposEvento();
  /*
    QUEM SÓ VÊ A AGENDA NÃO RECEBE BOTÃO. A Triagem tem agenda VISUALIZAR e
    escopo GLOBAL: via o bloco da equipe com ▷ e Concluir, e a API devolvia 403.
  */
  const podeEditarAgenda = podeEditar(user?.role, user?.permissoes, 'agenda');
  const podeCadastrarProcesso = podeEditar(user?.role, user?.permissoes, 'processos');
  const acoes = useConcluirNoPainel();

  /** A linha com a folha de desfechos aberta — uma por vez. */
  const [folha, setFolha] = useState<{ c: CompromissoCard; botao: BotaoDeFolha } | null>(null);
  /** O formulário completo, para vincular ou abrir processo e para ajustar o seguimento. */
  const [completo, setCompleto] = useState<{ detalhe: CompromissoDetalhe; slug: string } | null>(null);
  const [abrindoCompleto, setAbrindoCompleto] = useState(false);

  const estaAberta = (c: CompromissoCard) =>
    c.status === 'PENDENTE' || c.status === 'EM_ANDAMENTO';
  /** Ficou para trás (dia virado) ou passou da hora de hoje — ver `estadoDoPrazo`. */
  const pedeAtencao = (c: CompromissoCard) => estadoDoPrazo(c) !== 'EM_DIA';
  const ehDeOutraPessoa = (c: CompromissoCard) => !!user?.id && !!c.responsavel && c.responsavel.id !== user.id;

  /*
    DEDUPLICA POR ID — a janela de troca do deploy exige isto.

    Web e API sobem em serviços separados e não trocam no mesmo segundo: com a
    API de uma versão e a web de outra, a MESMA atividade pode chegar em duas
    listas. O `Map` preserva a primeira ocorrência, que é a ordem em que
    concatenamos.
  */
  const semRepetir = [...new Map(
    [...atrasadas, ...hoje, ...proximas].map((c) => [c.id, c]),
  ).values()];

  /*
    O QUE AINDA PEDE AÇÃO PRIMEIRO; DEPOIS, CRONOLÓGICO. `atividadesHoje` traz o
    dia inteiro, qualquer status: sem isto, as concluídas de hoje disputavam as
    cinco vagas da visão de equipe com o que ainda precisa de alguém.
  */
  const todas = semRepetir.sort((a, b) => {
    const porEstado = Number(!estaAberta(a)) - Number(!estaAberta(b));
    if (porEstado !== 0) return porEstado;
    return new Date(a.inicio).getTime() - new Date(b.inicio).getTime();
  });

  /*
    O CATÁLOGO DE CADA TIPO ABERTO — a mesma chave do modal da agenda, então quem
    abre um e depois o outro não paga duas vezes. São poucos tipos por painel, e
    o catálogo quase não muda: meia hora de validade.

    O tipo da folha aberta entra junto: ao concluir, a linha sai da fila na hora,
    e a folha não pode perder as opções enquanto a resposta não volta.
  */
  const tiposAbertos = [
    ...new Set([...todas.filter(estaAberta).map((c) => c.tipo), ...(folha ? [folha.c.tipo] : [])]),
  ].sort();
  const catalogos = useQueries({
    queries: tiposAbertos.map((tipo) => ({
      queryKey: ['desfechos-tipo', tipo],
      queryFn: () => listarDesfechos(tipo),
      enabled: podeEditarAgenda,
      staleTime: 30 * 60_000,
    })),
  });
  const catalogoDe = (tipo: string) => {
    const q = catalogos[tiposAbertos.indexOf(tipo)];
    return {
      opcoes: q?.data,
      carregando: !!q?.isLoading,
      erro: !!q?.isError,
      tentar: () => void q?.refetch(),
    };
  };

  async function abrirCompleto(c: CompromissoCard, slug: string) {
    setAbrindoCompleto(true);
    try {
      const detalhe = await qc.fetchQuery({
        queryKey: ['compromisso', c.id],
        queryFn: () => getCompromisso(c.id),
      });
      setFolha(null);
      setCompleto({ detalhe, slug });
    } catch {
      toast.error('Não foi possível abrir o formulário completo agora.');
    } finally {
      setAbrindoCompleto(false);
    }
  }

  if (!todas.length) return null;

  /*
    O CORTE NUNCA PODE ESCONDER O QUE PRECISA DE GENTE.

    Tudo que pede atenção aparece; o teto vale só para o que está EM DIA. E há
    um teto duro de segurança — 40 atrasadas não viram 40 linhas: aparecem as
    mais antigas e o rodapé DIZ quantas ficaram de fora.
  */
  const TETO_ATENCAO = 12;
  const precisamDeGente = todas.filter(pedeAtencao);
  const emDia = todas.filter((c) => !pedeAtencao(c));

  /*
    A AGENDA DA EQUIPE NÃO CABE NUM PAINEL. No escopo GLOBAL a API manda a
    agenda de todo mundo; na carteira pessoal não há corte. O corte é de
    EXIBIÇÃO, não de dado: o rodapé diz quantas ficaram e leva à agenda.
  */
  const TETO_EQUIPE = 5;
  const atencaoVisivel = precisamDeGente.slice(0, TETO_ATENCAO);
  const vagasRestantes = pessoal
    ? emDia.length
    : Math.max(0, TETO_EQUIPE - atencaoVisivel.length);
  const visiveis = [...atencaoVisivel, ...emDia.slice(0, vagasRestantes)];
  /*
    O CABEÇALHO E O RODAPÉ CONTAM A MESMA COISA.

    O selo "N atrasadas" vem do count() da API; a lista chega com `take`. Com 14
    atrasadas o cabeçalho dizia 14, a lista mostrava 8 e o rodapé calculava as
    ocultas só sobre o que chegou — as 6 que a API cortou não apareciam em
    lugar nenhum. O que falta chegar entra na conta pelos totais.
  */
  const cortadasPelaApi = Math.max(0, totalAtrasadas + totalPassaramDaHora - precisamDeGente.length);
  const ocultas = todas.length - visiveis.length + cortadasPelaApi;
  /** O que pede atenção e não está na tela — o rodapé tem de nomeá-lo. */
  const atencaoOculta = precisamDeGente.length - atencaoVisivel.length + cortadasPelaApi;

  /*
    DE QUEM É O ATRASO — a pergunta de quem coordena. Com "8 atrasadas" ele
    COBRA, e para cobrar precisa de um nome. Conta tudo o que chegou ao painel,
    inclusive o que o teto escondeu.

    ORDEM ALFABÉTICA, e não "quem tem mais": ordenar pessoas por atraso é um
    pódio ao contrário. O número ao lado já diz o que é preciso.
  */
  /*
    O PLACAR NOMINAL É INSTRUMENTO DE COBRANÇA — 18/09/2026.

    "Esperando por: Carlos 1 · Ícaro 1 · Murilo 3" é para quem coordena. A
    TRIAGEM recebia a mesma linha: os nomes dos advogados com o número de
    atrasadas de cada um, numa tela em que ela tem `agenda: VISUALIZAR` e não
    resolve uma linha sequer. Ver quem está devendo sem poder ajudar não é
    informação, é fofoca institucional.

    A LISTA CONTINUA para ela: saber que o jurídico está cheio ajuda a marcar
    consulta. O que sai é o placar por pessoa.
  */
  const porPessoa = pessoal || !cobra
    ? []
    : [...precisamDeGente
        .reduce((acc, c) => {
          const r = c.responsavel;
          if (!r) return acc;
          const atual = acc.get(r.id);
          acc.set(r.id, { pessoa: r, quantas: (atual?.quantas ?? 0) + 1 });
          return acc;
        }, new Map<string, { pessoa: NonNullable<CompromissoCard['responsavel']>; quantas: number }>())
        .values()].sort((a, b) => a.pessoa.nome.localeCompare(b.pessoa.nome, 'pt-BR'));

  /*
    O RODAPÉ LEVA AO RECORTE QUE ELE CONTOU. A fila é atrasadas + hoje + sete
    dias: quando o que sumiu pede atenção, "Pedem atenção"; senão, "7 dias". Na
    carteira pessoal, só da pessoa (a régua `daPessoa`, a mesma do painel).
  */
  const hrefDoRodape = linkDaAgenda({
    aba: atencaoOculta > 0 ? 'atencao' : '7dias',
    ...(pessoal ? { pessoa: 'eu' } : {}),
  });

  const catalogoDaFolha = folha ? catalogoDe(folha.c.tipo) : null;

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      {/*
        CABEÇALHO DE UMA LINHA, não um `SectionCard` — 32px contra 56px. O
        contador de atrasadas mora aqui: o número no lugar onde se age.
      */}
      <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
        <h2 className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
          {pessoal ? 'Minhas atividades' : 'Atividades'}
          <span className="font-normal text-muted-foreground">{todas.length}</span>
          {/*
            DOIS CONTADORES, DOIS PESOS: âmbar sólido só para o que ficou para
            trás de verdade (dia virado); o que passou da hora entra em cinza.
          */}
          {totalAtrasadas > 0 && (
            <span className="shrink-0 rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-semibold text-white dark:bg-amber-600">
              {contar(totalAtrasadas, 'atrasada', 'atrasadas')}
            </span>
          )}
          {totalPassaramDaHora > 0 && (
            /* Visível no telefone também: o cabeçalho quebra linha em vez de perder o número. */
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-normal text-muted-foreground">
              {totalPassaramDaHora}{' '}
              {plural(totalPassaramDaHora, 'passou da hora', 'passaram da hora')}
            </span>
          )}
        </h2>
        <Link
          href="/agenda"
          className="flex min-h-11 shrink-0 items-center text-xs font-medium text-brand-800 transition hover:underline sm:min-h-0 dark:text-brand-300"
        >
          Abrir agenda
        </Link>
      </div>

      {porPessoa.length > 1 && (
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 border-b bg-amber-50/40 px-3 py-1.5 text-xs dark:bg-amber-950/10">
          <span className="mr-0.5 shrink-0 font-medium text-muted-foreground">
            Esperando por:
          </span>
          {porPessoa.map(({ pessoa, quantas }) => (
            <Link
              key={pessoa.id}
              /*
                O MESMO RECORTE QUE O NÚMERO CONTOU: atrasadas e passaram da hora
                em que a pessoa RESPONDE. Abria a agenda dela inteira, com equipe
                e reserva junto — outro número.
              */
              href={linkDaAgenda({ aba: 'atencao', responsavel: pessoa.id, somenteResponsavel: true })}
              title={`Ver o que pede atenção e é de ${pessoa.nome}`}
              className="flex min-h-11 items-center gap-1 rounded-full bg-background/80 py-0.5 pl-0.5 pr-2 transition hover:bg-background sm:min-h-0"
            >
              <AvatarMini pessoa={pessoa} size={18} />
              <span className="max-w-[9rem] truncate">{pessoa.nome.split(' ')[0]}</span>
              <span className="font-semibold tabular-nums">{quantas}</span>
            </Link>
          ))}
          {cortadasPelaApi > 0 && (
            <span className="text-muted-foreground">(entre as que chegaram ao painel)</span>
          )}
        </div>
      )}

      <ul className="divide-y">
        {visiveis.map((c) => {
          const aberta = estaAberta(c);
          const estado = estadoDoPrazo(c);
          const atrasada = estado === 'ATRASADA';
          const passouDaHora = estado === 'PASSOU_DA_HORA';
          const ocupado = acoes.ocupado(c.id);
          const emAndamento = c.status === 'EM_ANDAMENTO';
          const contra = parteContrariaDoProcesso(c.processo);
          const botao: BotaoDaLinha = aberta
            ? botaoDaLinha({
                opcoes: catalogoDe(c.tipo).opcoes,
                podeEditarAgenda,
                ehDeOutraPessoa: ehDeOutraPessoa(c),
                sugestaoDeCadastro: c.sugestaoDeCadastro,
                podeCadastrarProcesso,
              })
            : { tipo: 'NENHUM' };
          const rotulo = rotuloDoBotao(botao);

          return (
            <li
              key={c.id}
              className={cn(
                'flex flex-col gap-2 px-3 py-2.5 transition sm:flex-row sm:flex-wrap sm:items-center sm:gap-3',
                atrasada ? 'bg-amber-50/60 dark:bg-amber-950/10' : 'hover:bg-muted/40',
              )}
            >
              {/* A barra do tipo — a mesma paleta da Agenda. Só no desktop. */}
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
                      ÂMBAR, NUNCA VERMELHO: o sistema não calcula vencimento
                      processual, sabe apenas que a data agendada passou. E a
                      etiqueta é só do que FICOU PARA TRÁS (dia virado).
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
                    A DATA APARECE QUANDO NÃO É HOJE; e o que passou da hora leva a
                    própria hora em âmbar — informação, não alarme.
                  */}
                  <span
                    className={cn(
                      'shrink-0 tabular-nums',
                      passouDaHora && 'font-semibold text-amber-700 dark:text-amber-400',
                    )}
                    title={passouDaHora ? 'A hora marcada já passou — ainda é de hoje.' : undefined}
                  >
                    {ehDeHoje(c.inicio) ? formatHora(c.inicio) : etiquetaDeDia(c.inicio)}
                  </span>
                  {/* Em andamento não tinha marca nenhuma: depois do ▷, a linha parecia igual. */}
                  {emAndamento && (
                    <span className="shrink-0 font-medium text-sky-700 dark:text-sky-400">· em andamento</span>
                  )}
                  {c.filiado && <span className="truncate">· {c.filiado.nomeCompleto}</span>}
                  {/* Contra quem — o que distingue duas linhas de mesmo título. */}
                  {contra && <span className="truncate">· contra {contra}</span>}
                  {c.local && <span className="truncate">· {c.local}</span>}
                </div>
              </Link>

              <div className="flex min-w-0 shrink-0 items-center justify-end gap-1.5">
                {/* De quem é — só na visão de equipe. */}
                {!pessoal && c.responsavel && <AvatarMini pessoa={c.responsavel} size={24} />}

                {/*
                  O CHIP DE STATUS só aparece no que NÃO está aberto: concluída e
                  cancelada de hoje continuam na lista (é o registro do dia).
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

                {/*
                  ▷ SÓ ONDE O CRONÔMETRO SIGNIFICA ALGO: atividade de HOJE com hora
                  marcada (consulta, reunião, audiência, perícia). Cronometrar a
                  tarefa de quinta que vem não mede nada.
                */}
                {aberta && podeEditarAgenda && podeIniciarNoPainel(c) && (
                  <button
                    type="button"
                    onClick={() => acoes.iniciar(c.id)}
                    disabled={ocupado}
                    title="Iniciar"
                    aria-label={`Iniciar ${c.titulo}`}
                    className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50 sm:h-8 sm:w-8"
                  >
                    <Play className="h-3.5 w-3.5" />
                  </button>
                )}

                {botao.tipo === 'CADASTRAR' && (
                  /*
                    A TAREFA "CADASTRAR AÇÃO DO DIÁRIO": o gesto é cadastrar. A
                    tarefa fecha sozinha quando a ação entra no acervo — "Cumprida"
                    fechava a tarefa e deixava a ação fora.
                  */
                  <Link href={botao.href} className={BOTAO_CLARO}>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{rotulo}</span>
                  </Link>
                )}

                {botao.tipo === 'UM_TOQUE' && (
                  <button
                    type="button"
                    onClick={() => void acoes.concluir({ c, opcao: botao.opcao })}
                    disabled={ocupado}
                    aria-label={`${rotulo}: concluir ${c.titulo}`}
                    className={BOTAO_CLARO}
                  >
                    {ocupado ? (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5 shrink-0" />
                    )}
                    {/* O DESFECHO QUE SERÁ GRAVADO, também no telefone — "Concluir" escondia qual. */}
                    <span className="max-w-[11rem] truncate sm:max-w-[14rem]">{rotulo}</span>
                  </button>
                )}

                {botao.tipo === 'FOLHA' && (
                  <button
                    type="button"
                    onClick={() => setFolha({ c, botao })}
                    disabled={ocupado}
                    aria-haspopup="dialog"
                    aria-label={`Escolher o desfecho de ${c.titulo}`}
                    className={botao.opcao ? BOTAO_CLARO : BOTAO_FOLHA}
                  >
                    {ocupado && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />}
                    <span className="max-w-[11rem] truncate sm:max-w-[14rem]">{rotulo}</span>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {ocultas > 0 && (
        /*
          O RODAPÉ TEM DE DIZER SE O QUE SUMIU PEDE ATENÇÃO — e leva ao recorte
          que contou, não à agenda genérica.
        */
        <Link
          href={hrefDoRodape}
          className={cn(
            'flex min-h-11 items-center justify-between gap-2 border-t px-3 py-2 text-xs font-medium transition hover:bg-muted/60',
            atencaoOculta > 0
              ? 'bg-amber-50/60 text-amber-900 dark:bg-amber-950/20 dark:text-amber-200'
              : 'text-brand-800 dark:text-brand-300',
          )}
        >
          <span>
            {/* Número só quando a aba de destino conta o mesmo (13/09/2026). */}
            {textoDoRodapeDasAtividades({ ocultas, atencaoOculta, pessoal })}
            {atencaoOculta > 0 && (
              <strong className="font-semibold">
                {' '}
                — {contar(atencaoOculta, 'delas pede atenção', 'delas pedem atenção')}
              </strong>
            )}
          </span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        </Link>
      )}

      {folha && catalogoDaFolha && (
        <FolhaDeDesfecho
          key={folha.c.id}
          compromisso={folha.c}
          opcoes={catalogoDaFolha.opcoes}
          carregando={catalogoDaFolha.carregando}
          erro={catalogoDaFolha.erro}
          onTentarDeNovo={catalogoDaFolha.tentar}
          inicial={folha.botao.opcao}
          ehDeOutraPessoa={ehDeOutraPessoa(folha.c)}
          enviando={acoes.ocupado(folha.c.id)}
          abrindoCompleto={abrindoCompleto}
          onFechar={() => setFolha(null)}
          onConcluir={async (v) => !!(await acoes.concluir({ c: folha.c, ...v }))}
          onAbrirCompleto={(slug) => void abrirCompleto(folha.c, slug)}
        />
      )}

      <ConcluirModal
        compromisso={completo?.detalhe ?? null}
        open={!!completo}
        origem="PAINEL"
        desfechoInicial={completo?.slug}
        onClose={() => setCompleto(null)}
        onConcluido={(caso) => {
          acoes.invalidar();
          if (caso) {
            toast.success(
              <span>
                Caso aberto em fase pré-processual.{' '}
                <Link href={`/processos?processo=${caso.id}`} className="font-semibold underline underline-offset-2">
                  Abrir o caso
                </Link>
              </span>,
            );
          }
        }}
      />
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
 * leitura errada. A hora sozinha faz amanhã parecer atraso.
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
