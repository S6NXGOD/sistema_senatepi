'use client';

import { useMemo, useState } from 'react';
import { formatDataPura } from '@/lib/data-pura';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { varrerDjenAgora } from '@/lib/djen';
import { motion } from 'framer-motion';
import {
  Briefcase, Clock, AlarmClock, Users, Gavel, CalendarDays,
  Flame, AlertTriangle, Landmark, Inbox, UserCheck, RefreshCw, Cake, Timer,
  CheckCircle2, ChevronRight, ChevronDown, FolderKanban, TrendingUp, Info, AlertCircle, Loader2,
  Newspaper,
  FileCheck2, Hourglass, Headset, Swords, UserCog,
} from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell,
} from 'recharts';
import { useAuth } from '@/lib/auth';
import { podeEditar, podeVer, PERFIL_LABEL, type PerfilUsuario } from '@/lib/permissoes';
import { CANAL_LABEL } from '@/lib/atendimentos';
import {
  getResumoDashboard, saudacao, dataPorExtenso, tempoRelativo, horaCurta,
  primeiroNome, motivoFalhaDatajud, esperaAindaRazoavel, diasEsperando,
  type ResumoDashboard, type FalhaDatajud, type ProcessoDesconhecidoNoCnj,
} from '@/lib/dashboard';
import { AvatarPessoa } from '@/components/ui/avatar-pessoa';
import { CadastroFiliadoModal } from '@/components/filiados/cadastro-filiado-modal';
import { formatNPU } from '@/lib/processos';
import { PROVIDENCIA_LABEL } from '@/lib/djen';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  KpiCard, SectionCard, EmptyState, CompromissoRow, AvatarMini,
} from '@/components/dashboard/widgets';
import { AudienciasAgendarPanel } from '@/components/processos/audiencias-agendar-panel';
import { AtalhosDoPerfil } from '@/components/dashboard/atalhos-do-perfil';
import { cn } from '@/lib/utils';
import { tenant } from '@/tenant.config';
import { AcoesSemCadastro } from '@/components/dashboard/acoes-sem-cadastro';
import { OQueEstaLimpo, type CoisaLimpa } from '@/components/dashboard/o-que-esta-limpo';
import { CaixaDePropostas } from '@/components/dashboard/caixa-de-propostas';
import { AtividadesDoDia } from '@/components/dashboard/atividades-do-dia';
import {
  COR_SAIDA, COR_SALDO, PALETA_CATEGORICA, useCorDaMarca,
} from '@/lib/cores-grafico';

export default function DashboardPage() {
  const { user } = useAuth();
  const role = user?.role as PerfilUsuario;
  const perms = user?.permissoes;

  const { data, isLoading, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ['dashboard-resumo'],
    queryFn: getResumoDashboard,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const pode = useMemo(
    () => ({
      processos: podeVer(role, perms, 'processos'),
      atendimentos: podeVer(role, perms, 'atendimentos'),
      agenda: podeVer(role, perms, 'agenda'),
      filiados: podeVer(role, perms, 'filiados'),
      escalas: podeVer(role, perms, 'escalas'),
      // O radar de audiências grava nos dois módulos (resolve o alerta no
      // Processo e cria o evento na Agenda) — sem os dois, as ações do painel
      // seriam recusadas pela API.
      radarAudiencias: podeEditar(role, perms, 'processos') && podeEditar(role, perms, 'agenda'),
      /*
        A VARREDURA COMPLETA DO DIÁRIO é `@Roles(ADMINISTRADOR)` na API: ela
        percorre a OAB de todos os advogados e consulta o CNJ dezenas de vezes.
        Botão que devolve 403 é pior que botão ausente — já entreguei um assim.
      */
      varrerDjen: role === 'ADMINISTRADOR',
    }),
    [role, perms],
  );

  if (!user) return null;

  return (
    <div className="space-y-5">
      <HeroHeader
        nome={user.nomeExibicao || user.nome}
        role={role}
        escopo={data?.escopo}
        atualizadoEm={dataUpdatedAt || undefined}
      />

      {/*
        ATALHOS logo abaixo da saudação, ANTES de qualquer número.
        O painel era só leitura: dizia muito bem o que está acontecendo e não
        oferecia nada para fazer a respeito. Quem abre o sistema de manhã já
        sabe o que vai fazer — e passava por menu, tela e botão para chegar lá.
        Cada perfil vê no máximo quatro, filtrados pela permissão REAL.
      */}
      <AtalhosDoPerfil role={role} permissoes={perms} />

      {/* ORDEM IMPORTA: o erro vem ANTES do esqueleto.
          A condição antiga era `isLoading || !data`, e ela mentia quando a
          consulta FALHAVA: `isLoading` volta a false, mas `data` continua
          indefinido — então a tela ficava em esqueleto para sempre, sem dizer
          que algo deu errado. Era o "carregando infinito" relatado no celular e
          no computador. */}
      {isError ? (
        <PainelIndisponivel erro={error} onTentar={() => refetch()} tentando={isFetching} />
      ) : isLoading || !data ? (
        <SkeletonHome />
      ) : (
        <Conteudo data={data} pode={pode} role={role} />
      )}
    </div>
  );
}

/**
 * O painel não carregou — e diz por quê.
 *
 * Uma tela que falha em silêncio custa mais que uma que erra: quem usa fica
 * esperando, recarrega, reinstala o app e abre chamado. A mensagem técnica
 * aparece porque é ela que permite dizer ao suporte o que aconteceu.
 */
function PainelIndisponivel({
  erro, onTentar, tentando,
}: {
  erro: unknown;
  onTentar: () => void;
  tentando: boolean;
}) {
  const status = (erro as any)?.response?.status;
  const detalhe = (erro as any)?.response?.data?.message ?? (erro as Error)?.message;
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-5 text-center dark:border-amber-900/50 dark:bg-amber-950/20">
      <AlertTriangle className="mx-auto mb-2 h-7 w-7 text-amber-600 dark:text-amber-400" />
      <p className="font-semibold text-amber-900 dark:text-amber-200">
        Não foi possível carregar o painel
      </p>
      <p className="mx-auto mt-1 max-w-md text-sm text-amber-800/90 dark:text-amber-300/90">
        {status === 401 || status === 403
          ? 'Sua sessão pode ter expirado. Saia e entre novamente.'
          : 'O restante do sistema continua funcionando — use o menu para acessar os módulos.'}
      </p>
      {detalhe && (
        <p className="mt-2 break-words font-mono text-[11px] text-amber-700/80 dark:text-amber-400/70">
          {status ? `HTTP ${status} · ` : ''}{String(detalhe).slice(0, 200)}
        </p>
      )}
      <Button variant="outline" className="mt-3" onClick={onTentar} disabled={tentando}>
        {tentando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        Tentar novamente
      </Button>
    </div>
  );
}

// ===========================================================================
// Cabeçalho (saudação + data + badge de perfil)
// ===========================================================================

/**
 * Idade do dado do painel. Curto e honesto — o `tempoRelativo` da lib é para
 * datas de negócio (ISO) e usa outra granularidade; aqui o que importa é
 * distinguir "acabou de carregar" de "isso está velho".
 */
function idadeDoDado(quando: number): string {
  const s = Math.max(0, Math.round((Date.now() - quando) / 1000));
  if (s < 45) return 'agora há pouco';
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  return `há ${Math.round(s / 3600)} h`;
}

/**
 * O CABEÇALHO DO PAINEL.
 *
 * ERA UM BLOCO COM DEGRADÊ, dois círculos desfocados e um emoji de mãozinha.
 * Saiu por três motivos, nesta ordem:
 *
 * 1. NÃO PASSAVA EM CONTRASTE. O degradê ia de `brand-800` a `brand-600` com
 *    texto branco por cima. Medido na paleta do SENATEPI, o texto sobre o tom
 *    600 fica em 3,26:1 — abaixo dos 4,5:1 da WCAG AA. A metade direita da
 *    saudação era literalmente mais difícil de ler que a esquerda, e nenhum
 *    ajuste de peso de fonte conserta contraste.
 *
 * 2. ERA A ÚNICA TELA ASSIM. Filiados, Processos, Colaboradores e todas as
 *    outras abrem com um título simples sobre o fundo da página. Um painel com
 *    faixa colorida no topo não parecia "mais importante": parecia de outro
 *    sistema, colado ali.
 *
 * 3. NÃO CARREGAVA INFORMAÇÃO. Os círculos desfocados, o degradê e o emoji
 *    ocupavam a faixa mais valiosa da tela — a primeira — sem dizer nada. O que
 *    o usuário lê nos primeiros segundos passou a ser o dado: os indicadores
 *    começam ~120px mais acima.
 *
 * O que ficou é o que se usa: quem é, quando o dado foi buscado, e o perfil —
 * porque ele muda o que a tela mostra.
 */
function HeroHeader({
  nome, role, escopo, atualizadoEm,
}: {
  nome: string;
  role: PerfilUsuario;
  escopo?: string;
  /** Timestamp da última busca bem-sucedida (react-query `dataUpdatedAt`). */
  atualizadoEm?: number;
}) {
  return (
    /*
      NO CELULAR O CABEÇALHO CABE EM DUAS LINHAS, NÃO EM QUATRO.

      Saudação em 2xl, data embaixo, "atualizado há pouco" e o selo do perfil
      quebrando para uma terceira linha: quase uma dobra inteira do telefone
      gasta antes do primeiro dado. Nada aqui é decisão de ninguém — é cortesia
      e contexto.

      No telefone a saudação encolhe para xl e o selo do perfil some: quem está
      logado sabe quem é, e o perfil já aparece na barra lateral e no menu. Fica
      o que muda de verdade — a data e há quanto tempo o dado foi buscado.
    */
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{saudacao(nome)}</h1>
        <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
          {dataPorExtenso()}
          {escopo === 'PESSOAL' && ' · sua carteira'}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {/* "Tempo real" era propaganda: o painel recarrega a cada 60s. Dizer
            QUANDO o dado foi buscado é a informação que o usuário usa para
            decidir se atualiza a página antes de tomar uma decisão. */}
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <RefreshCw className="h-3 w-3" />
          {atualizadoEm ? `atualizado ${idadeDoDado(atualizadoEm)}` : 'carregando…'}
        </span>
        {/* O perfil muda o que a tela mostra, então continua à vista — mas como
            etiqueta discreta, e não como selo colorido disputando a atenção com
            os números. */}
        <span className="hidden rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground sm:inline">
          {PERFIL_LABEL[role]}
        </span>
      </div>
    </div>
  );
}

// ===========================================================================
// Conteúdo (por role)
// ===========================================================================

function Conteudo({
  data,
  pode,
  role,
}: {
  data: ResumoDashboard;
  pode: Record<
    'processos' | 'atendimentos' | 'agenda' | 'filiados' | 'escalas' | 'radarAudiencias' | 'varrerDjen',
    boolean
  >;
  role: PerfilUsuario;
}) {
  const { kpis, minhaCarteira, alertas } = data;
  const qc = useQueryClient();
  const { user } = useAuth();
  /**
   * Id do filiado sendo recadastrado por cima do painel. Quem viu o dado
   * faltando conserta sem perder a tela de onde veio.
   */
  const [recadastrando, setRecadastrando] = useState<string | null>(null);
  /** Quem GRAVA filiado: é de quem é a fila de recadastro. */
  const podeEditarFiliado = podeEditar(role, user?.permissoes, 'filiados');

  /** Perfis que coordenam a operação — os únicos que veem a carga da equipe. */
  const ehGestao = role === 'ADMINISTRADOR' || role === 'COORDENACAO';
  /**
   * A Triagem é atendimento: a fila dela (contatos e atendimentos) vem PRIMEIRO,
   * antes dos blocos do jurídico. Antes, ela via o painel do advogado com
   * buracos onde faltava permissão — nunca o próprio trabalho em destaque.
   */
  const ehTriagem = role === 'TRIAGEM';
  /** Carteira própria (advogado) — muda a ORDEM do painel, nunca o acesso. */
  const escopoPessoal = data.escopo === 'PESSOAL';

  // KPIs globais, filtrados pelo que o perfil pode ver.
  const kpiCards = [
    pode.processos && {
      label: 'Processos ativos', valor: kpis.processosAtivos,
      /*
        O TOTAL JUNTO porque o número sozinho engana: quem tem 5 processos
        cadastrados e lê "4" conclui que sumiu um. Arquivado, suspenso e
        encerrado não são "não existe" — são outra fase.

        E a fila PRÉ-PROCESSUAL é dita à parte, com nome. Antes o total contava
        tudo (11) enquanto a tela de Processos mostrava 7, porque ela esconde os
        pré-processuais da lista padrão. Dois números com a mesma palavra fazem
        parecer que um está errado — e a pessoa passa a desconfiar dos dois.
      */
      sub:
        `em andamento · ${kpis.processosTotal} no total` +
        (kpis.processosPreProcessuais
          ? ` · ${kpis.processosPreProcessuais} a ajuizar`
          : ''),
      icon: Briefcase, cor: 'bg-brand-50 text-brand-800 dark:bg-brand-900/30 dark:text-brand-400',
      href: '/processos',
    },
    pode.atendimentos && {
      label: 'Atendimentos pendentes', valor: kpis.atendimentosPendentes, sub: 'aguardando resolução',
      icon: Clock, cor: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
      href: '/atendimentos',
    },
    pode.agenda && {
      label: 'Prazos esta semana', valor: kpis.prazosSemana, sub: 'próximos 7 dias',
      icon: AlarmClock, cor: 'bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400',
      href: '/agenda',
    },
    pode.filiados && {
      label: 'Filiados ativos', valor: kpis.filiadosAtivos,
      // Entrada E saída no mesmo cartão: mostrar só quem chega conta metade da
      // história, e a metade que falta é justamente a que preocupa.
      sub: `no mês: +${kpis.novosFiliadosMes} · −${kpis.desfiliadosMes} · saldo ${
        kpis.saldoFiliadosMes >= 0 ? '+' : ''
      }${kpis.saldoFiliadosMes}`,
      icon: Users, cor: 'bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400',
      href: '/filiados',
    },
  ].filter(Boolean) as { label: string; valor: number; sub: string; icon: typeof Briefcase; cor: string; href: string }[];

  /*
    O QUE ESTÁ VAZIO NÃO GANHA CARTÃO — GANHA UMA LINHA.

    Só 3 dos 11 blocos deste painel somem sozinhos quando não têm conteúdo; os
    outros 8 desenham cartão inteiro com título, ícone, moldura e um "nenhum
    registro" no meio. Medido em 07/09/2026 no painel do administrador: quatro
    seções vazias ao mesmo tempo. Metade da primeira tela era o sistema
    informando que não tinha nada a informar.

    Esconder de vez seria pior: "agenda de hoje vazia" É informação, e é a que
    o advogado procura ao abrir. Ela só não vale um cartão. Vira uma linha, no
    fim — depois do que precisa de gente, que é onde a boa notícia pertence.

    A conta é feita AQUI, e não dentro de cada bloco, por dois motivos: os dados
    já estão todos neste escopo, e assim a decisão de "isto está vazio" mora num
    lugar só, do lado da decisão de renderizar.
  */
  const vazio = {
    audienciasSemana: pode.agenda && (data.audienciasSemana ?? []).length === 0,
    /* A fila é UMA: atrasado de dias anteriores + hoje + próximos sete. Só
       colapsa quando as três estão vazias. */
    atividadesHoje:
      pode.agenda &&
      (data.pendenciasAtivas ?? []).length === 0 &&
      (data.atividadesHoje ?? []).length === 0 &&
      (data.proximasAtividades ?? []).length === 0,
    /*
      "NADA ATRASADO" TEM DE OLHAR O CONTADOR, NÃO A LISTA.

      `pendenciasAtivas` passou a trazer só o que venceu em DIA ANTERIOR — as
      de hoje vivem na lista de hoje. Continuar medindo por essa lista faria a
      tela anunciar "Nada atrasado" com oito atrasadas de hoje na página. O
      contador `alertas.atrasadas` é `inicio < agora` inteiro, que é o que a
      frase promete.
    */
    atrasadas: pode.agenda && alertas.atrasadas === 0,
    atendimentos:
      pode.atendimentos && !ehTriagem && (data.atendimentosPendentes ?? []).length === 0,
    movimentacoes: pode.processos && (data.movimentacoesRecentes ?? []).length === 0,
    equipeHoje: pode.escalas && !data.equipeHoje?.plantaoHoje?.length,
    cargaEquipe: ehGestao && (data.cargaEquipe ?? []).length === 0,
  };

  /*
    O QUE A GRADE DA ZONA 3 VAI CONTER — calculado antes de desenhar.

    Guarda de vazio dentro de grade de largura fixa esconde o conteúdo e deixa
    o espaço: era um terço de tela em branco ao lado das atividades sempre que
    não havia plantão nem audiência na semana. A grade precisa saber o que vai
    receber ANTES de escolher quantas colunas ter.
  */
  const temColunaLateral =
    (pode.escalas && !vazio.equipeHoje) || (pode.agenda && !vazio.audienciasSemana);
  const mostrarAtividadesDaEquipe = !escopoPessoal && pode.agenda && !vazio.atividadesHoje;

  /* Frases AFIRMATIVAS: "Nada atrasado", nunca "0 atrasos". A pessoa lê a
     linha para se tranquilizar, e número zero não tranquiliza ninguém. */
  const limpo: CoisaLimpa[] = [
    /*
      A FRASE TEM DE DIZER O QUE A GUARDA MEDIU.

      Eu tinha escrito "Nada na agenda de hoje" — e o bloco só colapsa quando
      HOJE **e os próximos sete dias** estão vazios (ele mostra as duas listas).
      A frase afirmava menos do que era verdade e, pior, deixava a pessoa achando
      que amanhã podia ter algo escondido ali.

      E "atrasada" é `inicio < agora` entre as abertas — as VENCIDAS, não as
      abertas. "Nenhuma pendência aberta" com seis compromissos pendentes na
      semana seria uma tela mentindo com todas as letras.

      Peguei as duas simulando o painel por usuário contra a produção, não lendo
      o que eu tinha acabado de escrever.
    */
    vazio.atividadesHoje && { texto: 'Nada na agenda desta semana', href: '/agenda' },
    vazio.audienciasSemana && { texto: 'Sem audiências nos próximos 7 dias', href: '/agenda' },
    vazio.atrasadas && { texto: 'Nada atrasado', href: '/agenda' },
    vazio.atendimentos && { texto: 'Nenhum atendimento na fila', href: '/atendimentos' },
    vazio.movimentacoes && { texto: 'Sem movimentação nova nos processos', href: '/processos' },
    vazio.equipeHoje && { texto: 'Ninguém de plantão hoje', href: '/escalas' },
  ].filter(Boolean) as CoisaLimpa[];

  return (
    <>
      {/*
        MINHA CARTEIRA — a primeira coisa que o advogado vê, e agora com os dois
        riscos que faltavam.

        Os quatro primeiros números vêm da AGENDA: têm data, e por isso alguém
        cobra. Os dois últimos não têm data nenhuma — e são justamente os que
        somem: o caso pré-processual, que sai da lista padrão de propósito, e o
        processo parado há trinta dias, que ninguém percebe porque nada vence.
      */}
      {escopoPessoal && pode.agenda && !vazio.atividadesHoje && (
        <AtividadesDoDia
          atrasadas={data.pendenciasAtivas ?? []}
          hoje={data.atividadesHoje}
          proximas={data.proximasAtividades ?? []}
          totalAtrasadas={alertas.atrasadas}
          totalPassaramDaHora={alertas.passaramDaHora ?? 0}
          pessoal
          href={(id) => `/agenda?compromisso=${id}`}
        />
      )}

      {minhaCarteira && (
        <section>
          <SectionTitle icon={FolderKanban} texto="Minha carteira" />
          {/*
            TRÊS FILEIRAS DE NÚMERO ANTES DO PRIMEIRO PRAZO.

            Medido no telefone de 375px: seis `KpiCard` em `grid-cols-2` custam
            364px — mais da metade da dobra útil (600px) gasta em contagem, e o
            advogado abriu o painel para trabalhar, não para contar.

            `grid-cols-3` põe os seis em DUAS fileiras e o cartão fica mais
            estreito; com o `KpiCard` já compacto (número em 2xl no telefone, o
            zero recuado), o rótulo ainda cabe. Passa de 364 para ~216px.
          */}
          <div className="grid grid-cols-3 gap-2 sm:gap-4 lg:grid-cols-6">
            <KpiCard label="Meus processos" valor={minhaCarteira.meusProcessos} sub="vinculados a mim"
              icon={Briefcase} cor="bg-brand-50 text-brand-800 dark:bg-brand-900/30 dark:text-brand-400" href="/processos?meus=1" destaque />
            <KpiCard label="Minhas audiências" valor={minhaCarteira.minhasAudiencias} sub="esta semana"
              icon={Gavel} cor="bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400" href="/agenda" destaque />
            <KpiCard label="Atrasadas" valor={minhaCarteira.atrasadas} sub="de dias anteriores"
              icon={AlertTriangle} cor="bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400" href="/agenda" destaque />
            <KpiCard label="Urgentes" valor={minhaCarteira.urgentes} sub="próximos 7 dias"
              icon={Flame} cor="bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400" href="/agenda" destaque />
            <KpiCard label="A ajuizar" valor={minhaCarteira.preProcessuais} sub="fase pré-processual"
              icon={FileCheck2} cor="bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400"
              href="/processos?preProcessuais=1" destaque />
            <KpiCard label="Parados" valor={minhaCarteira.semMovimentacao} sub="sem andamento há 30d"
              icon={Hourglass} cor="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              href="/processos?meus=1" destaque />
          </div>
        </section>
      )}

      {/*
        A FILA DO BALCÃO. O painel já mostrava "atendimentos pendentes" — o
        número do sindicato inteiro. Quem atende precisa do próprio: quanto EU
        registrei hoje, e quanto ainda está na minha mão.
      */}
      {data.minhaTriagem && (
        <section>
          <SectionTitle icon={Headset} texto="Meu balcão hoje" />
          <div className="grid grid-cols-3 gap-4">
            <KpiCard label="Registrei hoje" valor={data.minhaTriagem.registradosHoje} sub="atendimentos"
              icon={Headset} cor="bg-brand-50 text-brand-800 dark:bg-brand-900/30 dark:text-brand-400" href="/atendimentos" destaque />
            <KpiCard label="Comigo, em aberto" valor={data.minhaTriagem.semDesfecho} sub="aguardando desfecho"
              icon={Clock} cor="bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400" href="/atendimentos" destaque />
            <KpiCard label="Filiações hoje" valor={data.minhaTriagem.filiadosHoje} sub="cadastros novos"
              icon={Users} cor="bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400" href="/filiados" destaque />
          </div>
        </section>
      )}


      {/*
        NA CARTEIRA PESSOAL, A AGENDA VEM ANTES DE TUDO.

        O advogado abre o painel para saber o que ELE tem de fazer hoje. Isso
        estava depois da carteira, da zona de trabalho do Diário E da grade de
        números — no telefone, meia dúzia de rolagens antes do primeiro prazo.

        Para quem coordena a ordem continua a outra: a agenda da equipe é
        contexto, e o que precisa de decisão vem primeiro. Por isso o bloco
        aparece em DOIS lugares, nunca nos dois ao mesmo tempo.
      */}

      {/*
        ZONA 1 — O QUE PRECISA DE VOCÊ. Subiu para cima dos números.

        A ordem anterior era: números primeiro, trabalho depois. Faz sentido num
        relatório e não numa tela de trabalho — "129 processos ativos" é estado
        do mundo, não decisão de ninguém; "30 ações do sindicato apareceram no
        Diário" e "7 publicações pedem providência" são o dia da pessoa.

        Medido no painel do administrador em 07/09/2026: das nove seções
        principais, QUATRO estavam vazias. Com os números na frente, o que havia
        de real começava abaixo da primeira dobra — no celular, depois de meia
        dúzia de rolagens.

        Todo bloco desta zona já se esconde sozinho quando não tem o que dizer
        (integração sã, robô em dia, Diário calado, nada atrasado). Em dia
        tranquilo a zona inteira desaparece e os números sobem naturalmente para
        o topo, que é onde eles devem estar QUANDO não há trabalho urgente.
      */}
      {/* A fonte externa caiu? Vem antes de tudo que depende dela — inclusive
          antes do aviso do robô, que só diz se a varredura rodou. */}
      <SaudeDasIntegracoes data={data} podeVarrerDjen={pode.varrerDjen} />

      {/*
        A FILA DO DIÁRIO VOLTOU AO PAINEL — COMO CARD, e nunca como faixa.

        A distinção é o assunto inteiro. A FAIXA anunciava o mesmo número em
        cima de toda tela do sistema: virava cabeçalho, e cabeçalho ninguém lê.
        O CARD aparece uma vez, no lugar onde a pessoa vai ver o dia dela, e não
        a persegue até Cobranças.

        E o sino não substitui isto, ao contrário do que eu tinha escrito abaixo:
        ele é uma gaveta que precisa ser ABERTA. A dashboard é a primeira tela
        de todo login — é aqui que se fica sabendo sem procurar.

        Só aparece quando há fila; não usa requisição nova (mesma chave do sino);
        e herda o recorte de permissão do backend.
      */}
      {/*
        A CAIXA DE ENTRADA VEM ANTES DA FILA DO DIÁRIO.

        As duas são "trabalho a decidir", mas a caixa tem PRAZO dentro e a fila
        de cadastro não: uma ação de 2015 que ninguém cadastrou espera mais uma
        semana sem custo; uma publicação com quinze dias de prazo, não.
      */}
      {pode.processos && <CaixaDePropostas />}
      {pode.processos && <AcoesSemCadastro />}

      {/*
        A FAIXA de "ação nova" continua fora — o que voltou acima é um CARD.

        A faixa dizia "3 ações apareceram no Diário" numa barra de alerta, ao
        lado das que anunciam prazo vencido. Misturar backlog com emergência
        gasta o vermelho das duas. O card diz a mesma coisa sem fingir urgência,
        e cada linha dele abre o cadastro já preenchido — que era a única
        vantagem real que o sino tinha sobre a faixa.
      */}

      {/* Robô do DataJud. Vem ANTES do radar de propósito: se a varredura não
          rodou, o "0 audiências a agendar" abaixo não quer dizer nada. */}
      {pode.processos && <AvisoRobo robo={data.robo} />}
      {/*
        A MESMA COISA DUAS VEZES NÃO É DOIS AVISOS.

        Quando a barra de integrações já diz que o DJEN parou ou não rodou, o
        "nenhuma publicação nova" logo abaixo é a CONSEQUÊNCIA disso —
        apresentada como se fosse um achado independente. Foi o que a tela do
        usuário mostrou: duas faixas sobre o DJEN, uma vermelha e uma âmbar,
        dizendo o mesmo fato de dois ângulos.
      */}
      {pode.processos && (
        <PublicacoesDjen djen={data.djen} calado={integracaoDjenComProblema(data)} />
      )}

      {/* Audiências a agendar (DataJud → Agenda) — o alerta mais acionável da
          home: vem antes das barras porque cada item tem um "próximo passo". */}
      {pode.radarAudiencias && (
        <AudienciasAgendarPanel
          dados={{ items: data.audienciasAAgendar, total: alertas.audienciasAAgendar }}
        />
      )}

      {/* Barras de alerta (agenda) */}
      {/*
        A BARRA "N ATIVIDADES COM HORÁRIO VENCIDO" FOI EMBORA — era a terceira
        cópia do mesmo fato.

        Medido em 08/09/2026: as 8 atrasadas apareciam (1) contadas nesta
        barra, (2) marcadas de âmbar na lista de atividades logo abaixo e
        (3) listadas outra vez no bloco "Pendências ativas" no rodapé. Três
        renderizações, zero informação nova nas duas últimas — e a barra era a
        pior das três, porque dá o NÚMERO sem dizer QUAIS: para agir era
        preciso descer a página de qualquer jeito.

        A fila de atividades agora abre pelas atrasadas, com etiqueta e cor.
        O número está lá, em cima do trabalho, onde dá para resolver.

        A de "paradas há mais de 7 dias" FICA: essa não está em lista nenhuma
        do painel (é `updatedAt`, não `inicio`) e some sozinha em dia limpo.
      */}
      {pode.agenda && alertas.semMovimentacao > 0 && (
        <div className="space-y-2">
          {/* Passou de vermelho sólido para info, e ganhou o número.
              "Atenção!" com fundo vermelho para uma atividade parada há uma
              semana competia visualmente com falha de sistema — e a frase
              seguinte ("manter atualizado é essencial para a qualidade do
              atendimento") repreendia sem informar. O que a pessoa precisa
              saber é QUANTAS são e onde estão. */}
          {alertas.semMovimentacao > 0 && (
            <AlertBar tom="info" href="/agenda" acao="Abrir agenda">
              <strong>{alertas.semMovimentacao}</strong>{' '}
              {alertas.semMovimentacao === 1
                ? 'atividade está parada'
                : 'atividades estão paradas'}{' '}
              há mais de 7 dias.
            </AlertBar>
          )}
        </div>
      )}


      {/* ZONA 2 — os números. Estado do mundo, depois do que precisa de gente. */}
      {/* KPIs globais */}
      {kpiCards.length > 0 && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {kpiCards.map((c, i) => (
            <motion.div key={c.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
              <KpiCard {...c} />
            </motion.div>
          ))}
        </div>
      )}

      {/* FILA DA TRIAGEM. Vem logo após os KPIs porque É o trabalho dela —
          antes, a secretaria abria a home e via o painel do jurídico com
          buracos, sem a própria fila em lugar nenhum. */}
      {ehTriagem && (
        <section>
          <SectionTitle icon={Inbox} texto="Sua fila de hoje" />
          {/*
            SEM GRADE PARA UM CARTÃO SÓ — e isto era regressão minha.

            Aqui havia dois cartões lado a lado ("Contatos a fazer" e a fila de
            atendimentos). Removi o primeiro e deixei a grade de duas colunas
            com um filho: o cartão ficava com metade da largura e a outra metade
            em branco, no painel de quem abre o sistema para trabalhar essa fila.
          */}
          {pode.atendimentos && <AtendimentosPendentes data={data} />}
          {/* Aniversariantes logo abaixo da fila: é a secretaria quem faz o
              contato, e o card só aparece quando há alguém. E ao lado, os
              cadastros que dá para completar hoje — é o mesmo gesto (abrir a
              ficha de alguém e preencher o que falta), e a mesma pessoa. */}
          {pode.filiados && (
            <div
              className={cn(
                'mt-4 grid grid-cols-1 gap-4',
                podeEditarFiliado && 'lg:grid-cols-2',
              )}
            >
              <Aniversariantes
                data={data}
                podeCompletar={podeEditarFiliado}
                onCompletar={setRecadastrando}
              />
              {podeEditarFiliado && (
                <CadastrosACompletar data={data} onCompletar={setRecadastrando} />
              )}
            </div>
          )}
        </section>
      )}

      {/*
        ZONA 3 — O DIA. Cada bloco só aparece se tiver conteúdo; o que estiver
        vazio é anunciado na linha única do fim (zona 4).
      */}
      {/*
        A GRADE SE ADAPTA AO QUE EXISTE — antes reservava a coluna vazia.

        A coluna da esquerda (equipe + audiências) era um `<div>` renderizado
        SEMPRE, mesmo com os dois filhos escondidos pelas guardas de vazio. Como
        a grade é `lg:grid-cols-3`, ela continuava alocando um terço da largura
        para um div sem nada dentro: as atividades ficavam empurradas para a
        direita com um buraco branco do tamanho de um cartão ao lado.

        É o mesmo erro do "bloco vazio não renderiza", um nível acima: não basta
        o BLOCO sumir, a CÉLULA que o segurava tem de sumir junto. Guarda de
        vazio dentro de grade fixa esconde o conteúdo e deixa o espaço.

        Três arranjos, um por combinação real:
          os dois     → 1/3 lateral + 2/3 atividades (como antes)
          só lateral  → as duas cartas lado a lado, aproveitando a largura
          só a fila   → largura inteira
      */}
      {(temColunaLateral || mostrarAtividadesDaEquipe) && (
        <div
          className={cn(
            'grid grid-cols-1 gap-4',
            temColunaLateral && mostrarAtividadesDaEquipe && 'lg:grid-cols-3',
            temColunaLateral && !mostrarAtividadesDaEquipe && 'lg:grid-cols-2',
          )}
        >
          {temColunaLateral && (
            <div className="space-y-4">
              {pode.escalas && !vazio.equipeHoje && <EquipeHoje data={data} />}
              {pode.agenda && !vazio.audienciasSemana && <AudienciasSemana data={data} />}
            </div>
          )}
          {mostrarAtividadesDaEquipe && (
            <div className={cn(temColunaLateral && 'lg:col-span-2')}>
              <AtividadesDoDia
                atrasadas={data.pendenciasAtivas ?? []}
                hoje={data.atividadesHoje}
                proximas={data.proximasAtividades ?? []}
                totalAtrasadas={alertas.atrasadas}
                totalPassaramDaHora={alertas.passaramDaHora ?? 0}
                pessoal={false}
                href={(id) => `/agenda?compromisso=${id}`}
              />
            </div>
          )}
        </div>
      )}

      {/*
        GRÁFICO É INSTRUMENTO DE GESTÃO — e não era de ninguém.

        Tendência de atendimentos e de filiados ao longo do mês responde "como
        vai o sindicato". É a pergunta de quem coordena; não é a de quem tem
        prazo amanhã. O advogado recebia 135 linhas de gráfico entre a agenda
        dele e o acervo dele, todo dia, sem nunca precisar.

        A guarda é por PERFIL, e aqui isso é correto: ela decide ÊNFASE, não
        acesso. O advogado continua podendo ver o mesmo dado em Relatórios se
        tiver permissão — o que muda é que a home dele para de assumir que ele
        quer. Nenhuma guarda deste arquivo alarga permissão; todas só escondem.
      */}
      {ehGestao && (
        <div
          className={cn(
            'grid grid-cols-1 gap-4',
            pode.atendimentos && 'lg:grid-cols-3',
          )}
        >
          <div className={cn(pode.atendimentos && 'lg:col-span-2')}>
            <GraficoTendencia data={data} podeAtend={pode.atendimentos} podeFil={pode.filiados} />
          </div>
          {pode.atendimentos && <GraficoCanais data={data} />}
        </div>
      )}

      {/*
        "PENDÊNCIAS ATIVAS" SAIU — virou o topo da fila de atividades.

        Uma pendência é uma atividade cujo horário passou; não é outra coisa,
        não vive noutro lugar e não merece outro cartão. Das 8 do dia da
        medição, 8 já estavam na lista de cima. O bloco existia para dar
        destaque ao atrasado, e destaque se dá com ORDEM e COR, não com um
        segundo cartão duzentos pixels abaixo.

        Só os atendimentos da triagem continuam aqui.
      */}
      {pode.atendimentos && !ehTriagem && !vazio.atendimentos && (
        <AtendimentosPendentes data={data} />
      )}

      {/* Carga da equipe — instrumento de GESTÃO, restrito a quem coordena.
          O advogado não recebe o dado da API; a Triagem tem acesso à agenda,
          mas a lista de quem está sobrecarregado não é trabalho dela. */}
      {/*
        "CONTATOS A FAZER" SAIU DO PAINEL — pedido direto, e ele estava certo.

        CONTATO é um tipo de atividade como os outros: já entra na fila de
        atividades, com horário, responsável e botão de resolver. Ter um cartão
        próprio para um dos dez tipos era privilégio sem critério — e o cartão
        não fazia nada que a fila não faça melhor, porque nem botão de concluir
        tinha.

        A carga da equipe continua, sozinha e em largura inteira.
      */}
      {ehGestao && data.cargaEquipe && !vazio.cargaEquipe && <CargaEquipe data={data} />}

      {/* Cadastros a completar para quem edita filiado e não é Triagem (esta
          já viu no topo) — a coordenação também trabalha essa fila. */}
      {!ehTriagem && podeEditarFiliado && (
        <CadastrosACompletar data={data} onCompletar={setRecadastrando} />
      )}

      {/* Aniversariantes para os demais perfis (a Triagem já viu no topo).
          O card se esconde sozinho em dia sem aniversário. */}
      {/*
        ANIVERSARIANTE É TRABALHO DE QUEM ATENDE, não de quem litiga.

        Parabenizar filiado é relacionamento — função da secretaria e da
        coordenação. O advogado recebia a lista todo dia entre os prazos dele e
        o acervo dele; medido hoje, são 2 aniversariantes e 8 na semana, e
        nenhum deles muda o que ele faz.

        A Triagem vê a lista LÁ EM CIMA, junto com a fila de atendimento, que é
        onde ela trabalha — por isso `!ehTriagem` aqui: não é exclusão, é não
        repetir. Ênfase, nunca acesso: `pode.filiados` continua mandando.
      */}
      {!ehTriagem && ehGestao && pode.filiados && (
        <Aniversariantes
          data={data}
          podeCompletar={podeEditarFiliado}
          onCompletar={setRecadastrando}
        />
      )}

      {/* O recadastro acontece por cima do painel: quem viu o dado faltando
          conserta sem perder a tela de onde veio. */}
      <CadastroFiliadoModal
        open={!!recadastrando}
        filiadoId={recadastrando}
        onClose={() => setRecadastrando(null)}
        onSalvo={() => {
          setRecadastrando(null);
          qc.invalidateQueries({ queryKey: ['dashboard'] });
        }}
      />

      {/* Leitura de acervo: com quem brigamos, e o que andou nos processos.
          As duas são contexto, não alerta — por isso ficam no rodapé. */}
      {pode.processos && (
        <div
          className={cn(
            'grid grid-cols-1 gap-4',
            !vazio.movimentacoes && 'lg:grid-cols-2',
          )}
        >
          <AdversariosRecorrentes data={data} />
          {!vazio.movimentacoes && <MovimentacoesRecentes data={data} />}
        </div>
      )}

      {/*
        ZONA 4 — O QUE ESTÁ LIMPO, em uma linha, por último.

        Substitui os cartões que existiam só para dizer "nenhum registro". A
        posição é parte da mensagem: boa notícia depois do trabalho, nunca
        antes. Em dia cheio a linha some sozinha.
      */}
      <OQueEstaLimpo itens={limpo} />
    </>
  );
}

// ===========================================================================
// Blocos
// ===========================================================================

function SectionTitle({ icon: Icon, texto }: { icon: typeof Briefcase; texto: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Icon className="h-4 w-4 text-brand-800 dark:text-brand-400" />
      <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">{texto}</h2>
    </div>
  );
}

/**
 * Barra de aviso da home, em TRÊS níveis.
 *
 * Antes eram dois tons e um modificador `forte` que pintava a barra de
 * vermelho sólido — o mesmo peso visual de "sistema fora do ar". Ele estava
 * sendo usado para coisas que não são emergência (o robô sem varredura, uma
 * atividade parada há uma semana), e todos os avisos usavam o mesmo ícone de
 * triângulo. O resultado era um painel que gritava por igual em tudo, e um
 * painel que grita sempre é um painel que ninguém lê.
 *
 *   info     nada errado, só vale saber      → ícone Info, cinza-azulado
 *   atencao  precisa de alguém em algum dia  → ícone Triângulo, âmbar
 *   critico  algo está quebrado agora        → ícone Círculo, rosa
 *
 * `acao` nomeia o destino em vez do genérico "Ver": o rótulo já diz o que vem
 * depois do clique.
 */
function AlertBar({
  children, tom, href, acao = 'Ver', aoAgir, rotuloAcao, agindo,
}: {
  children: React.ReactNode;
  tom: 'info' | 'atencao' | 'critico';
  /**
   * SEM DESTINO É UM CASO LEGÍTIMO. Quase todo aviso daqui leva a uma tela onde
   * se resolve — mas "o DJEN parou de responder" não tem tela: não é trabalho
   * de ninguém dentro do sistema, é uma informação para quem decide abrir
   * chamado. Um link para lugar nenhum seria pior que link nenhum.
   */
  href?: string;
  acao?: string;
  /**
   * UMA ALAVANCA, e não só um destino.
   *
   * O aviso de que as publicações estão atrasadas dizia o diagnóstico e parava.
   * Quem lia não podia fazer nada — e alarme sem saída é o que ensina a
   * ignorar alarme. Com o botão, a faixa vira trabalho: "Buscar agora".
   */
  aoAgir?: () => void;
  rotuloAcao?: string;
  agindo?: boolean;
}) {
  const estilo = {
    info: {
      Icone: Info,
      cor: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700/60 dark:bg-slate-800/40 dark:text-slate-300',
      icone: 'text-slate-500 dark:text-slate-400',
    },
    atencao: {
      Icone: AlertTriangle,
      cor: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200',
      icone: 'text-amber-600 dark:text-amber-400',
    },
    critico: {
      Icone: AlertCircle,
      cor: 'border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-900/50 dark:bg-rose-900/20 dark:text-rose-200',
      icone: 'text-rose-600 dark:text-rose-400',
    },
  }[tom];
  const { Icone } = estilo;

  const corpo = (
    <>
      <span className="flex items-start gap-2.5">
        <Icone className={cn('mt-0.5 h-4 w-4 shrink-0', estilo.icone)} />
        <span className="min-w-0">{children}</span>
      </span>
      {href && (
        <span className="flex shrink-0 items-center gap-0.5 text-xs font-semibold opacity-80">
          {acao} <ChevronRight className="h-3.5 w-3.5" />
        </span>
      )}
    </>
  );

  const classe = cn(
    'flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm',
    estilo.cor,
    href && 'transition hover:brightness-[0.98]',
  );

  // Com botão, a faixa deixa de ser uma linha e vira um bloco — e no celular o
  // botão desce para baixo do texto em vez de espremer a frase.
  if (aoAgir) {
    return (
      <div className={cn('rounded-xl border px-4 py-3 text-sm', estilo.cor)}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <span className="flex items-start gap-2.5">
            <Icone className={cn('mt-0.5 h-4 w-4 shrink-0', estilo.icone)} />
            <span className="min-w-0">{children}</span>
          </span>
          <button
            type="button"
            onClick={aoAgir}
            disabled={agindo}
            className={cn(
              'flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-md border',
              'border-current/30 bg-background/70 px-3 text-xs font-semibold',
              'transition hover:bg-background disabled:opacity-60 sm:h-8',
            )}
          >
            {agindo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {rotuloAcao ?? 'Executar'}
          </button>
        </div>
      </div>
    );
  }

  return href ? (
    <Link href={href} className={classe}>{corpo}</Link>
  ) : (
    <div className={classe}>{corpo}</div>
  );
}

/**
 * Aviso sobre o robô do DataJud — ou silêncio, que é o caso mais comum.
 *
 * Cada situação tem um tom proporcional ao que de fato significa:
 *
 *   SEM_OBJETO  nada monitorado          → NADA. O robô está ocioso, não
 *                                          parado; não há por que avisar.
 *   EM_DIA      varreu nas últimas 36h   → NADA. Funcionar é o esperado.
 *   PRIMEIRA    ainda não varreu         → info. É o estado normal de quem
 *                                          acabou de cadastrar o primeiro
 *                                          processo, não uma falha.
 *   ATRASADO    36h a 3 dias sem varrer  → atenção.
 *   PARADO      +3 dias sem varrer       → crítico. Aqui algo está errado.
 *
 * As falhas pontuais aparecem à parte, em `FalhasCNJ`: o robô pode estar em
 * dia e mesmo assim ter levado recusa do CNJ em alguns processos.
 */
/**
 * AS PUBLICAÇÕES DO DJEN NA HOME.
 *
 * Duas coisas num bloco só, e de propósito: o que chegou e se o robô está vivo.
 * Separá-las produziria o defeito que o `AvisoRobo` já existe para evitar —
 * uma lista vazia sem contexto, que tanto pode significar "não houve
 * publicação" quanto "faz um mês que nada entra".
 *
 * Lista SÓ o que pede providência. Edital e lista de distribuição chegam às
 * dezenas: no acervo real são 339 publicações em três dias para oito
 * advogados, das quais a esmagadora maioria não pede nada de ninguém. Mostrar
 * tudo afogaria a intimação que pede peça em três dias.
 *
 * DESLIGADA não desenha nada. Um bloco permanente dizendo "integração
 * desativada" seria ruído numa instalação que escolheu não usar o DJEN.
 */
/** A barra de integrações já está falando do DJEN? */
function integracaoDjenComProblema(data: ResumoDashboard): boolean {
  return (data.integracoes ?? []).some(
    (i) => i.fonte === 'DJEN' && i.situacao !== 'OK' && i.situacao !== 'SEM_USO',
  );
}

function PublicacoesDjen({
  djen,
  calado,
}: {
  djen: ResumoDashboard['djen'];
  /** A barra de integrações já explicou o silêncio — não repita. */
  calado?: boolean;
}) {
  if (!djen.ativa) return null;

  const desde = djen.ultimaEm ? idadeDoDado(new Date(djen.ultimaEm).getTime()) : null;
  const pessoal = djen.escopo === 'PESSOAL';

  if (djen.situacao === 'PRIMEIRA') {
    return (
      <AlertBar tom="info" href="/processos" acao="Ver processos">
        A integração com o DJEN está ligada, mas ainda não trouxe nenhuma
        publicação. A varredura roda toda madrugada, às 5h.
      </AlertBar>
    );
  }

  if (djen.situacao === 'SILENCIOSA') {
    // A barra de integrações já disse por quê; repetir aqui é a mesma notícia
    // com outra cor, e duas faixas para um fato ensinam a ignorar as duas.
    if (calado) return null;
    /*
      A FRASE CONTRADIZIA A PRÓPRIA FAIXA.

      Ela dizia "fim de semana e recesso explicam silêncio curto" — e aparecia
      justamente no domingo, por causa do fim de semana. O corte era em 48
      HORAS; agora é em dias ÚTEIS, e o texto conta dia útil, que é a unidade
      em que o Diário existe.
    */
    const uteis = djen.diasUteisSemNada;
    return (
      <AlertBar tom="atencao" href="/processos" acao="Ver processos">
        Nenhuma publicação nova do DJEN{' '}
        {uteis != null
          ? `há ${uteis} dia${uteis === 1 ? '' : 's'} útil${uteis === 1 ? '' : 'eis'}`
          : desde}
        . O Diário não circula no fim de semana, então a conta já pula sábado e
        domingo — vale conferir a integração.
      </AlertBar>
    );
  }

  if (!djen.recentes.length) return null;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Newspaper className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            {/*
              O TÍTULO DIZIA "NOS SEUS PROCESSOS" e a lista passou a ser maior
              que isso: entra também o ato que NOMEIA o advogado num processo
              que não está vinculado a ele. Foi assim que a Dra. Jaqueline via
              zero enquanto quatro intimações a citavam. "Suas publicações" cobre
              as duas coisas sem prometer a errada.
            */}
            {pessoal ? 'Suas publicações' : 'Publicações que pedem providência'}
          </p>
          {/*
            "Ver todas" é a resposta à paginação: o painel é RESUMO — seis atos
            dos últimos sete dias. O acervo inteiro, procurável por parte,
            advogado, OAB e teor, mora em /publicacoes.
          */}
          <Link
            href="/publicacoes"
            className="text-xs font-medium text-brand-800 hover:underline dark:text-brand-300"
          >
            {djen.publicacoes7d} em 7 dias · ver todas
          </Link>
        </div>

        <ul className="divide-y">
          {djen.recentes.map((pub) => (
            <li key={pub.id} className="py-2 first:pt-0 last:pb-0">
              <Link
                href={
                  pub.compromissoId && pub.temTarefaAberta
                    ? `/agenda?compromisso=${pub.compromissoId}`
                    : `/processos?processo=${pub.processo?.id ?? ''}`
                }
                className="-mx-2 flex items-start gap-2.5 rounded-lg px-2 py-1.5 transition hover:bg-muted/60"
              >
                {/*
                  O PONTO DIZ SE ALGUÉM PEGOU. Sólido = já virou tarefa aberta
                  na agenda; vazado = o ato pediu algo e ninguém pegou, que é o
                  único estado desta lista que representa risco.
                */}
                <span
                  aria-hidden
                  className={cn(
                    'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                    pub.semTarefa
                      ? 'border-2 border-amber-500 bg-transparent'
                      : 'bg-indigo-500',
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-medium">
                      {pub.providencia && PROVIDENCIA_LABEL[pub.providencia]
                        ? PROVIDENCIA_LABEL[pub.providencia]
                        : (pub.tipoComunicacao ?? 'Publicação')}
                    </span>
                    {/*
                      O PRAZO CORRE PARA QUEM FOI INTIMADO — e a lista mistura
                      duas coisas de peso diferente: o ato que NOMEIA você e o
                      ato do processo que é seu mas intimou outro advogado. Sem
                      a marca, as seis linhas parecem ter a mesma urgência.
                    */}
                    {pub.meCita && (
                      <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
                        Você foi intimado
                      </span>
                    )}
                    {/*
                      DE QUEM CONTRA QUEM.

                      "Contra quem" sempre distinguiu um processo do outro
                      aqui. "De quem" foi acrescentado depois, e só aparece
                      quando NÃO somos nós: o autor é o próprio sindicato em 93
                      dos 127 processos, e repetir o nome dele em toda linha
                      gastaria espaço para dizer o que já se sabia. Quando é a
                      filiada, é a informação que faltava.
                    */}
                    {(pub.processo?.autor || pub.processo?.adversario) && (
                      <span className="min-w-0 truncate text-xs text-muted-foreground">
                        {pub.processo.autor ? `${pub.processo.autor} ` : ''}
                        {pub.processo.adversario ? `× ${pub.processo.adversario}` : ''}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span>{formatDataPura(pub.dataDisponibilizacao)}</span>
                    {pub.processo?.numeroCNJ && (
                      <span className="font-mono text-[11px]">
                        · {formatNPU(pub.processo.numeroCNJ)}
                      </span>
                    )}
                    {/*
                      EM QUE POLO ESTAMOS. A mesma "intimação para
                      manifestar-se" é ataque quando somos autor e defesa
                      quando somos réu — e a lista não dizia qual dos dois.
                    */}
                    {pub.processo?.nossoPolo && (
                      <span>· somos {pub.processo.nossoPolo === 'ATIVO' ? 'autor' : 'réu'}</span>
                    )}
                    {/*
                      O RESPONSÁVEL, COM ROSTO.

                      Numa lista de seis publicações, o nome é a coluna que se
                      lê por último — a foto é reconhecida antes de qualquer
                      texto e responde "isto é meu?" sem obrigar a ler. Só
                      aparece para quem NÃO é o dono da lista: na tela do
                      próprio advogado seria a cara dele em toda linha.
                    */}
                    {!pessoal && pub.processo?.advogado && (
                      <span className="inline-flex min-w-0 items-center gap-1">
                        ·
                        <AvatarPessoa
                          nome={pub.processo.advogado.nomeExibicao || pub.processo.advogado.nome}
                          url={pub.processo.advogado.avatarUrl}
                          tamanho="xs"
                        />
                        <span className="truncate">{primeiroENome(pub.processo.advogado)}</span>
                      </span>
                    )}
                    {/*
                      O prazo é o que o TEXTO menciona, não um vencimento
                      calculado — a contagem oficial depende de dia útil
                      forense e feriado de comarca, que o sistema não conhece.
                    */}
                    {pub.prazoMencionadoDias != null && (
                      <span className="font-medium text-amber-700 dark:text-amber-400">
                        · menciona {pub.prazoMencionadoDias} dias
                      </span>
                    )}
                    {pub.semTarefa && (
                      <span className="font-medium text-amber-700 dark:text-amber-400">
                        · sem tarefa
                      </span>
                    )}
                  </span>
                </span>
                <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/** Primeiro nome, ou o apelido que a pessoa escolheu. */
function primeiroENome(p: { nome: string; nomeExibicao: string | null }): string {
  return p.nomeExibicao || p.nome.split(/\s+/)[0];
}

function AvisoRobo({ robo }: { robo: ResumoDashboard['robo'] }) {
  const {
    situacao, processosMonitorados, ultimaSincronizacao, falhasProcessos,
    horasAteAtraso, desconhecidosNoCnj,
  } = robo;
  const desde = ultimaSincronizacao
    ? idadeDoDado(new Date(ultimaSincronizacao).getTime())
    : null;

  const falhasBar = falhasProcessos.length > 0 && (
    <FalhasCNJ falhas={falhasProcessos} horasAteAtraso={horasAteAtraso} />
  );
  const desconhecidosBar = !!desconhecidosNoCnj?.length && (
    <DesconhecidosNoCnj itens={desconhecidosNoCnj} />
  );

  // Ocioso ou em dia: nenhuma barra sobre o robô. Só as falhas, se houver.
  if (situacao === 'SEM_OBJETO' || situacao === 'EM_DIA') {
    if (!falhasBar && !desconhecidosBar) return null;
    return (
      <div className="space-y-2">
        {falhasBar}
        {desconhecidosBar}
      </div>
    );
  }

  const aviso =
    situacao === 'PRIMEIRA' ? (
      <AlertBar tom="info" href="/processos" acao="Ver processos">
        A primeira varredura do DataJud ainda não rodou. Ela acontece
        automaticamente toda madrugada, e vai buscar os andamentos{' '}
        {processosMonitorados === 1
          ? 'do processo cadastrado'
          : `dos ${processosMonitorados} processos cadastrados`}.
      </AlertBar>
    ) : situacao === 'ATRASADO' ? (
      <AlertBar tom="atencao" href="/processos" acao="Ver processos">
        A varredura do DataJud não roda desde {desde}. Audiências e prazos
        podem estar desatualizados.
      </AlertBar>
    ) : (
      <AlertBar tom="critico" href="/processos" acao="Ver processos">
        A varredura do DataJud está sem rodar há mais de 3 dias — a última foi{' '}
        {desde}. Vale conferir a integração antes de confiar nos prazos.
      </AlertBar>
    );

  return (
    <div className="space-y-2">
      {aviso}
      {falhasBar}
      {desconhecidosBar}
    </div>
  );
}

/**
 * O CNJ AINDA NÃO PUBLICOU — que é diferente de "deu erro".
 *
 * ISTO ERA INVISÍVEL, e não por descuido de tela: a consulta é gravada como
 * SUCESSO, porque ela de fato funcionou — o índice público é que não tem o
 * processo. Como não é falha, nunca entrou na barra de falhas; e como ninguém
 * vê, ninguém conserta.
 *
 * O TEXTO MANDAVA CONFERIR O NÚMERO SEMPRE, e na maior parte das vezes não há
 * nada a conferir. Medido na produção em 07/09/2026: o único caso é um
 * processo **distribuído há 13 dias, status PENDENTE**. O índice do CNJ demora
 * a receber processo novo — mandar a equipe caçar erro de digitação ali é
 * mandar procurar defeito que não existe.
 *
 * Então o aviso agora tem DUAS vozes, separadas por
 * `DIAS_ESPERA_RAZOAVEL_CNJ`:
 *
 *  · dentro do prazo → explica que é normal e que não é preciso fazer nada;
 *  · passado dele    → fala franco: o índice já deveria ter publicado, e o
 *                       palpite mais provável é número errado.
 *
 * SÓ DEPOIS DE TRÊS DIAS insistindo (corte na API): processo distribuído ontem
 * ainda não está no índice, e cobrar isso seria acusar o tribunal de um atraso
 * que é normal.
 */
function DesconhecidosNoCnj({ itens }: { itens: ProcessoDesconhecidoNoCnj[] }) {
  const [aberto, setAberto] = useState(false);
  const n = itens.length;
  /*
    BASTA UM FORA DO PRAZO para o aviso mudar de tom. Se há dez esperando e um
    já passou de um mês, dizer "não é preciso fazer nada" esconderia o único
    que precisa de gente — e é sempre esse que importa.
  */
  const esperando = itens.every((i) => esperaAindaRazoavel(i.desde));

  return (
    <div className="rounded-xl border border-input bg-muted/40 text-sm text-muted-foreground">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:brightness-[0.98]"
      >
        <span className="flex items-center gap-2.5">
          <Info className="h-4 w-4 shrink-0 opacity-70" />
          {/*
            A CONSEQUÊNCIA, E NÃO A CONTAGEM.

            Eu tinha escrito "o robô já perguntou 252 vezes" no título — que é eu
            mostrando serviço. Ninguém decide nada com esse número; ele importa a
            quem for investigar, e por isso desceu para o detalhe.

            O que a pessoa precisa saber é o que está deixando de acontecer:
            **este processo não recebe andamento nenhum**. E, quando é UM só, o
            número cabe na frase — saber qual é vale mais que saber quantos são.
          */}
          <span>
            {esperando ? (
              <>
                {n === 1 ? (
                  <>
                    <strong className="text-foreground">
                      O CNJ ainda não publicou 1 processo
                    </strong>{' '}
                    —{' '}
                    <span className="font-mono text-foreground">
                      {formatNPU(itens[0].numeroCNJ)}
                    </span>
                    , cadastrado há {diasEsperando(itens[0].desde)} dias.
                  </>
                ) : (
                  <>
                    <strong className="text-foreground">
                      O CNJ ainda não publicou {n} processos
                    </strong>{' '}
                    cadastrados recentemente.
                  </>
                )}{' '}
                O índice público demora a receber processo recém-distribuído. O
                sistema continua tentando todo dia — não é preciso fazer nada.
              </>
            ) : (
              <>
                {n === 1 ? (
                  <>
                    <strong className="text-foreground">
                      1 processo não recebe andamentos há {diasEsperando(itens[0].desde)} dias
                    </strong>
                    : o CNJ não reconhece o número{' '}
                    <span className="font-mono text-foreground">
                      {formatNPU(itens[0].numeroCNJ)}
                    </span>
                    .
                  </>
                ) : (
                  <>
                    <strong className="text-foreground">
                      {n} processos não recebem andamentos
                    </strong>
                    : o CNJ não reconhece os números cadastrados.
                  </>
                )}{' '}
                Já passou do tempo que o índice costuma levar — vale conferir se o
                número está digitado certo.
              </>
            )}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-0.5 text-xs font-semibold opacity-80">
          {aberto ? 'Ocultar' : 'Ver quais'}
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', aberto && 'rotate-180')} />
        </span>
      </button>

      {aberto && (
        <ul className="border-t border-input">
          {itens.map((i) => {
            const conteudo = (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-xs font-semibold text-foreground">
                    {formatNPU(i.numeroCNJ)}
                  </span>
                  <span className="block truncate text-xs opacity-80">
                    {i.filiado ?? 'Sem filiado vinculado'}
                    {i.tribunal ? ` · ${i.tribunal}` : ''}
                  </span>
                </span>
                <span className="shrink-0 text-xs">
                  consultado {i.tentativas}× desde{' '}
                  {new Date(i.desde).toLocaleDateString('pt-BR')}
                </span>
              </>
            );
            const classe =
              'flex items-center gap-3 border-t border-input/60 px-4 py-2.5 first:border-t-0 transition hover:bg-muted';
            return (
              <li key={i.numeroCNJ}>
                {i.processoId ? (
                  <Link href={`/processos?processo=${i.processoId}`} className={classe}>
                    {conteudo}
                  </Link>
                ) : (
                  <span className={classe}>{conteudo}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * As recusas do CNJ, com nome e sobrenome.
 *
 * Antes esta era uma AlertBar comum: dizia "2 processos" e levava para
 * `/processos`, a lista inteira, sem filtro nem destaque — clicar não mudava
 * nada na tela, e o aviso não tinha como virar trabalho. Um alerta que não
 * diz QUAL é o problema é só ruído com aparência de zelo.
 *
 * Agora a barra abre no lugar. Fica fechada por padrão (a falha costuma ser
 * passageira e não merece ocupar a home), e cada linha mostra o NPU, de quem
 * é o processo, por que falhou e há quanto tempo — com um clique que abre o
 * processo direto na ficha dele.
 *
 * O que entra aqui é só sincronização de processo JÁ CADASTRADO (ver
 * `falhasDatajud24h` na API) — por isso todo item tem, de fato, para onde ir.
 */
function FalhasCNJ({
  falhas,
  horasAteAtraso = 48,
}: {
  falhas: FalhaDatajud[];
  horasAteAtraso?: number;
}) {
  const [aberto, setAberto] = useState(false);
  const n = falhas.length;
  // Uma chave recusada ou um NPU que o CNJ não reconhece falham de novo
  // amanhã: separá-los evita prometer que "a próxima varredura resolve"
  // quando ela não resolve.
  const persistentes = falhas.filter((f) => !motivoFalhaDatajud(f).passageiro).length;

  /*
    "TENTATIVA QUE FALHOU" NÃO É "PROCESSO DESATUALIZADO" — e a faixa dizia que
    era.

    Ela anunciava "a varredura não conseguiu atualizar 6 processos", em âmbar,
    com seis linhas para clicar. Medido na produção: eram oito timeouts de
    exatos 45s, todos da MESMA rodada, entre a 82ª e a 106ª consulta, com ZERO
    timeouts nas nove noites anteriores. E os seis listados tinham sido lidos
    com sucesso de 33 a 37 horas antes, sem nada novo no CNJ.

    Ou seja: o texto mandava conferir seis processos que estavam em dia. Quem
    conferiu — e foi o usuário quem percebeu — concluiu, com razão, que a faixa
    estava errada. Alerta que o próprio leitor desmente ensina a ignorar todos
    os outros.

    Agora o alarme é só para quem está SEM LEITURA há tempo demais. O resto
    continua visível, porque instabilidade do CNJ é informação — mas em tom de
    informação.
  */
  const atrasado = (f: FalhaDatajud) => {
    // Sem `ultimoSucesso` (API antiga na janela de troca), não dá para afirmar
    // que está em dia: trata como atrasado, que é o lado seguro de errar.
    if (f.ultimoSucesso === undefined) return true;
    if (!f.ultimoSucesso) return true;
    return Date.now() - new Date(f.ultimoSucesso).getTime() > horasAteAtraso * 3_600_000;
  };
  const atrasados = falhas.filter(atrasado).length;
  const soTropeco = atrasados === 0;

  return (
    <div
      className={cn(
        'rounded-xl border text-sm',
        soTropeco
          ? 'border-input bg-muted/40 text-muted-foreground'
          : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200',
      )}
    >
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:brightness-[0.98]"
      >
        <span className="flex items-center gap-2.5">
          {soTropeco ? (
            <Info className="h-4 w-4 shrink-0 opacity-70" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          )}
          <span>
            {soTropeco ? (
              /*
                O CNJ TROPEÇOU, e nada ficou para trás. Dizer isso é útil (a
                instabilidade é real e recorrente) e dizer que "não conseguiu
                atualizar N processos" é falso — os N estão em dia.
              */
              <>
                O CNJ não respondeu a <strong>{n}</strong>{' '}
                {n === 1 ? 'consulta' : 'consultas'} na última varredura.{' '}
                <strong>Nenhum processo ficou para trás</strong> — todos foram lidos
                nas últimas {horasAteAtraso}h.
              </>
            ) : (
              <>
                <strong>{atrasados}</strong>{' '}
                {atrasados === 1 ? 'processo está' : 'processos estão'} sem leitura do
                CNJ há mais de {horasAteAtraso}h.{' '}
                {persistentes === 0 ? (
                  <>A próxima varredura tenta de novo; se insistir, alguém precisa olhar.</>
                ) : (
                  <>
                    <strong>{persistentes}</strong>{' '}
                    {persistentes === 1 ? 'não é problema passageiro' : 'não são problemas passageiros'}
                    {persistentes === 1 ? ' e pede' : ' e pedem'} verificação.
                  </>
                )}
                {n > atrasados && (
                  <>
                    {' '}Outros <strong>{n - atrasados}</strong> tropecaram nesta rodada mas
                    seguem em dia.
                  </>
                )}
              </>
            )}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-0.5 text-xs font-semibold opacity-80">
          {aberto ? 'Ocultar' : 'Ver quais'}
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', aberto && 'rotate-180')} />
        </span>
      </button>

      {aberto && (
        <ul className={cn('border-t', soTropeco ? 'border-input' : 'border-amber-300/70 dark:border-amber-900/50')}>
          {falhas.map((f) => {
            const motivo = motivoFalhaDatajud(f);
            const npu = formatNPU(f.numeroCNJ);
            const conteudo = (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-xs font-semibold">{npu}</span>
                  <span className="block truncate text-xs opacity-80">
                    {f.filiado ?? 'Sem filiado vinculado'}
                    {f.tribunal ? ` · ${f.tribunal}` : ''}
                    {/*
                      A LINHA QUE RESPONDE "MAS ESSE AQUI ESTÁ ATUALIZADO".

                      Sem ela, cada item da lista é uma acusação sem defesa: o
                      processo aparece como problema e nada na tela diz que ele
                      foi lido com sucesso ontem. Foi exatamente essa dúvida que
                      trouxe o usuário até aqui.
                    */}
                    {f.ultimoSucesso
                      ? ` · lido ${tempoRelativo(f.ultimoSucesso)}`
                      : f.ultimoSucesso === null
                        ? ' · nunca lido com sucesso'
                        : ''}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-xs">
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 font-medium',
                      motivo.passageiro
                        ? 'bg-amber-200/70 dark:bg-amber-900/50'
                        : 'bg-rose-200/80 text-rose-900 dark:bg-rose-900/50 dark:text-rose-200',
                    )}
                    // A mensagem técnica do CNJ, para quem for investigar.
                    title={f.mensagemErro ?? undefined}
                  >
                    {motivo.texto}
                  </span>
                  <span className="hidden opacity-70 sm:inline">{tempoRelativo(f.createdAt)}</span>
                  {f.processoId && <ChevronRight className="h-3.5 w-3.5 opacity-70" />}
                </span>
              </>
            );

            return (
              <li key={f.processoId ?? f.numeroCNJ} className="border-t border-amber-300/40 first:border-t-0 dark:border-amber-900/30">
                {/* Sem processoId o processo foi excluído depois da falha: o log
                    sobrevive, mas não há ficha para abrir. */}
                {f.processoId ? (
                  <Link
                    href={`/processos?processo=${f.processoId}`}
                    className="flex items-center gap-3 px-4 py-2.5 transition hover:brightness-[0.97]"
                  >
                    {conteudo}
                  </Link>
                ) : (
                  <span className="flex items-center gap-3 px-4 py-2.5 opacity-70">{conteudo}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * A EQUIPE DE HOJE, POR TURNO.
 *
 * Era uma lista corrida: quatro nomes com "08:00 – 12:00", "08:00 – 12:00",
 * "14:00 – 18:00", "14:00 – 18:00". A informação que importa — QUEM está de
 * plantão AGORA — só saía comparando quatro pares de horários de cabeça.
 *
 * Agrupado por turno, a pergunta se responde de relance: MANHÃ tem estes,
 * TARDE tem aqueles. O cabeçalho do turno só aparece quando há MAIS DE UM —
 * com um turno só ele repetiria o que o intervalo de horas já diz.
 *
 * O ponto colorido à direita é redundante de propósito: ele distingue à
 * distância (verde = tem gente atendendo agora) sem precisar ler a etiqueta.
 */
function EquipeHoje({ data }: { data: ResumoDashboard }) {
  const { plantaoHoje, proximoPlantao } = data.equipeHoje;

  /*
    A HORA DE TERESINA, não a do navegador.

    `toTimeString()` devolve a hora local de quem abre a tela. Coincide no
    Brasil e coincidiu comigo (UTC-3), mas as horas da escala são de Teresina:
    quem abrisse o painel de outro fuso veria "No horário" na hora errada. O
    resto do sistema já resolve isso pelo deslocamento fixo — aqui também.
  */
  const agoraHM = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(11, 16);

  const statusPlantao = (ini: string, fim: string) =>
    agoraHM > fim
      ? { t: 'Encerrado', chip: 'bg-muted text-muted-foreground', ponto: 'bg-muted-foreground/30' }
      : agoraHM >= ini
        ? {
            t: 'No horário',
            chip: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
            ponto: 'bg-emerald-500',
          }
        : {
            t: 'Aguardando',
            chip: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
            ponto: 'bg-amber-400',
          };

  /*
    TRÊS BALDES, e o do meio existe porque plantão de dia inteiro existe.
    Sem ele, 08:00–18:00 cairia em "manhã" e a tarde ficaria mentindo vazia.
  */
  const turnoDe = (ini: string, fim: string) =>
    fim <= '13:00' ? 'MANHÃ' : ini >= '12:00' ? 'TARDE' : 'DIA INTEIRO';

  const ordemTurno = { 'MANHÃ': 0, 'DIA INTEIRO': 1, 'TARDE': 2 } as const;
  const porTurno = new Map<string, typeof plantaoHoje>();
  for (const p of [...plantaoHoje].sort((a, b) => a.horaInicio.localeCompare(b.horaInicio))) {
    const t = turnoDe(p.horaInicio, p.horaFim);
    porTurno.set(t, [...(porTurno.get(t) ?? []), p]);
  }
  const turnos = [...porTurno.entries()].sort(
    (a, b) => ordemTurno[a[0] as keyof typeof ordemTurno] - ordemTurno[b[0] as keyof typeof ordemTurno],
  );
  const mostrarCabecalhoDeTurno = turnos.length > 1;

  return (
    <SectionCard
      title="Equipe disponível hoje"
      icon={UserCheck}
      count={plantaoHoje.length}
      actionHref="/escalas"
      actionLabel="Escalas"
    >
      {plantaoHoje.length === 0 ? (
        <EmptyState icon={UserCheck}>Ninguém de plantão hoje.</EmptyState>
      ) : (
        <div className="space-y-3">
          {turnos.map(([turno, pessoas]) => (
            <div key={turno}>
              {mostrarCabecalhoDeTurno && (
                <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {turno}
                </p>
              )}
              <ul className="space-y-0.5">
                {pessoas.map((p) => {
                  const st = statusPlantao(p.horaInicio, p.horaFim);
                  return (
                    <li key={p.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5">
                      <AvatarMini pessoa={p.advogado} size={32} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{primeiroNome(p.advogado)}</p>
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3 shrink-0" aria-hidden />
                          <span className="tabular-nums">
                            {p.horaInicio} – {p.horaFim}
                          </span>
                          <span
                            className={cn(
                              'rounded px-1.5 py-px text-[10px] font-medium',
                              st.chip,
                            )}
                          >
                            {st.t}
                          </span>
                        </p>
                      </div>
                      <span
                        className={cn('h-2 w-2 shrink-0 rounded-full', st.ponto)}
                        aria-hidden
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
      {proximoPlantao && (
        <div className="mt-3 border-t pt-2.5">
          <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {/*
              DATA PURA: `escalas_advogados.data` é `@db.Date` e chega como
              meia-noite UTC. `new Date(...).toLocaleDateString` num navegador
              UTC-3 puxava para 21h do dia anterior — a escala de SEGUNDA
              aparecia como DOMINGO. Foi o bug relatado, e era meu.
            */}
            {formatDataPura(proximoPlantao.data, {
              weekday: 'long',
              day: '2-digit',
              month: '2-digit',
            })}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 px-2">
            {proximoPlantao.advogados.map((a) => (
              <span
                key={a.id}
                className="flex items-center gap-1.5 rounded-full bg-muted py-0.5 pl-0.5 pr-2.5 text-xs"
              >
                <AvatarMini pessoa={a} size={20} />
                {primeiroNome(a)}
              </span>
            ))}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

function AudienciasSemana({ data }: { data: ResumoDashboard }) {
  const itens = data.audienciasSemana;
  return (
    <SectionCard title="Audiências da semana" icon={Gavel} count={itens.length} actionHref="/agenda">
      {itens.length === 0 ? (
        <EmptyState icon={Gavel}>Nenhuma audiência nos próximos 7 dias.</EmptyState>
      ) : (
        <ul className="space-y-1">
          {itens.map((c) => (
            <li key={c.id}>
                {/* Leva à ATIVIDADE, não ao módulo: o atalho existe para
                    poupar a procura, e parar na lista devolvia o problema. */}
              <Link href={`/agenda?compromisso=${c.id}`} className="flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-muted/60">
                <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                  <span className="text-[10px] font-semibold uppercase leading-none">
                    {new Date(c.inicio).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}
                  </span>
                  <span className="text-base font-bold leading-tight">{new Date(c.inicio).getDate()}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{c.titulo}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {horaCurta(c.inicio)}{c.local ? ` · ${c.local}` : ''}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

/**
 * CARGA DA EQUIPE — só para quem gere (Coordenação/Administrador).
 *
 * O painel respondia "quantas atividades estão atrasadas na casa?", mas não
 * "de quem?". Sem esse recorte, a gestão via o número e não sabia onde agir.
 * Ordenado por atrasadas: é o gargalo que exige ação, não o volume.
 */
function CargaEquipe({ data }: { data: ResumoDashboard }) {
  const itens = data.cargaEquipe ?? [];
  const maior = Math.max(1, ...itens.map((i) => i.abertas));

  return (
    <SectionCard title="Carga da equipe" icon={Users} count={itens.length} actionHref="/agenda" actionLabel="Agenda">
      {itens.length === 0 ? (
        <EmptyState icon={CheckCircle2}>Nenhuma atividade em aberto na equipe.</EmptyState>
      ) : (
        <ul className="space-y-2.5">
          {itens.map(({ advogado, abertas, atrasadas }) => (
            <li key={advogado.id} className="flex items-center gap-3">
              {advogado.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={advogado.avatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
              ) : (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-800 text-xs font-bold text-white dark:bg-brand-900/40 dark:text-brand-200">
                  {(advogado.nomeExibicao || advogado.nome).charAt(0)}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="flex items-center justify-between gap-2 text-sm font-medium">
                  <span className="truncate">{advogado.nomeExibicao || advogado.nome}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {abertas} {abertas === 1 ? 'aberta' : 'abertas'}
                    {atrasadas > 0 && (
                      <span className="ml-1.5 font-semibold text-rose-600 dark:text-rose-400">
                        · {atrasadas} atrasada{atrasadas === 1 ? '' : 's'}
                      </span>
                    )}
                  </span>
                </p>
                {/* Barra proporcional ao maior da equipe — a comparação é o dado */}
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn('h-full rounded-full', atrasadas > 0 ? 'bg-rose-500' : 'bg-brand-600')}
                    style={{ width: `${Math.round((abertas / maior) * 100)}%` }}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

/**
 * ANIVERSARIANTES DO DIA — filiados e equipe na mesma lista.
 *
 * É a única ação do painel que gera relacionamento em vez de resolver
 * pendência: um "parabéns" custa um clique e o filiado percebe o sindicato.
 * O botão do WhatsApp já leva a mensagem pronta, porque o atrito de escrever
 * é o que faz a intenção morrer.
 */
/**
 * QUEM PASSOU POR AQUI E ESTÁ COM A FICHA PELA METADE — a fila do balcão.
 *
 * A dívida real é de sete mil fichas (98% sem telefone, 69% sem CPF), e é
 * justamente por isso que ESTA lista não é ela. Sete mil nomes não são uma fila
 * de trabalho: é um relatório de dívida que ninguém abre duas vezes. Aqui só
 * entra quem está EM JOGO — teve atendimento nos últimos 60 dias ou é parte de
 * um processo. São pessoas com quem o sindicato acabou de falar, e o dado ainda
 * está ao alcance.
 *
 * Completar abre o formulário completo em passos, sem sair do painel.
 */
function CadastrosACompletar({
  data, onCompletar,
}: {
  data: ResumoDashboard;
  onCompletar: (filiadoId: string) => void;
}) {
  const itens = data.cadastrosACompletar ?? [];
  if (itens.length === 0) return null;

  return (
    <SectionCard title="Cadastros a completar" icon={UserCog} count={itens.length}>
      <ul className="divide-y divide-border/60">
        {itens.map((f) => (
          <li key={f.id} className="flex items-center gap-3 px-2 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{f.nome}</p>
              <p className="truncate text-xs text-muted-foreground">
                Falta {f.falta.join(', ')}
                {f.motivo === 'ATENDIMENTO' ? ' · atendido há pouco' : ' · tem processo'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onCompletar(f.id)}
              className="shrink-0 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition hover:bg-muted"
            >
              Completar
            </button>
          </li>
        ))}
      </ul>
      <p className="border-t px-2 pt-2 text-[11px] leading-snug text-muted-foreground">
        Só quem teve atendimento recente ou tem processo — são os cadastros que dá para
        completar hoje.
      </p>
    </SectionCard>
  );
}

/**
 * AS FONTES EXTERNAS PARARAM? — e o aviso só existe quando pararam.
 *
 * Este painel já dizia "a varredura rodou?" e "chegou publicação?". Nenhum dos
 * dois respondia "a integração QUEBROU?", e a diferença custou semanas: quando
 * a ponte do DJEN caiu, a home mostrou "silenciosa", que se lê como semana
 * parada. A leitura agora sai do log de chamadas — se a requisição saiu e o que
 * voltou.
 *
 * NADA APARECE QUANDO ESTÁ TUDO BEM. Um selo verde permanente vira paisagem em
 * uma semana e some junto com ele o dia em que fica vermelho.
 */
/** "DJEN" e "DATAJUD" são nomes de API. Quem lê a home quer o nome da coisa. */
/*
  A FRASE DE CADA FONTE VEM ESCRITA INTEIRA — nome genérico + adjetivo fixo dá
  erro de concordância: "os andamentos não são atualiz*adas*". São duas fontes;
  duas frases escritas à mão custam menos que um gerador de português.
*/
const O_QUE_A_FONTE_TRAZ: Record<
  string,
  { nome: string; oQue: string; incompleto: string }
> = {
  DJEN: {
    nome: 'Diário de Justiça',
    oQue: 'as publicações do Diário',
    incompleto: 'Algumas publicações podem não ter chegado.',
  },
  DATAJUD: {
    nome: 'DataJud',
    oQue: 'os andamentos dos processos',
    incompleto: 'Alguns andamentos podem não ter chegado.',
  },
};

/**
 * A INTEGRAÇÃO ESTÁ ATRASADA? — uma frase, e só quando algo de fato ficou para
 * trás.
 *
 * DUAS COISAS ESTAVAM ERRADAS AQUI, e as duas eram minhas.
 *
 * 1. O GATILHO ERA "24h SEM CHAMADA". Com uma varredura diária isso dispara em
 *    qualquer soluço. O usuário viu a faixa numa segunda às 00h46 porque a
 *    última busca tinha sido sexta às 16h35 — UM dia útil, com o Diário parado
 *    no fim de semana e a edição de segunda ainda inexistente. Nada tinha se
 *    perdido. Agora o corte é de DOIS dias úteis: aí sim há uma edição inteira
 *    que não entrou.
 *
 * 2. O TEXTO TINHA UM PARÁGRAFO TÉCNICO PENDURADO. "Nenhuma chamada foi
 *    registrada nas últimas 24h — nem com erro. Isso aponta para a varredura
 *    agendada, e não para o CNJ." Isso é anotação de manutenção, e num aviso
 *    de painel só faz a coisa parecer mais quebrada do que está. A distinção
 *    continua existindo — ela mudou a FRASE, em vez de virar um parágrafo.
 */
function SaudeDasIntegracoes({
  data,
  podeVarrerDjen,
}: {
  data: ResumoDashboard;
  /** Só o Administrador dispara a varredura completa (a rota exige o perfil). */
  podeVarrerDjen?: boolean;
}) {
  const qc = useQueryClient();

  /*
    A ALAVANCA É RÁPIDA — medido em produção: 15 consultas em 62 segundos.

    Eu tinha suposto que era pesada (o teste local demorou 14 minutos), mas ali
    TODA chamada falhava e era repetida; no ar a rodada inteira leva um minuto.
    Ainda assim o botão diz quanto custa: um clique que segura a tela por um
    minuto sem avisar é um clique que ninguém dá duas vezes.
  */
  const varrer = useMutation({
    // Sem argumento: a janela diária de sempre. O histórico é outro botão,
    // noutra tela, porque é uma passada única e cara.
    mutationFn: () => varrerDjenAgora(),
    onSuccess: (r) => {
      toast.success(
        r.ingeridas > 0
          ? `${r.ingeridas} publicação(ões) nova(s) do Diário.`
          : 'Busca concluída — nada novo no Diário.',
      );
      qc.invalidateQueries({ queryKey: ['dashboard-resumo'] });
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message ?? 'Não foi possível buscar no Diário agora.'),
  });

  const problemas = (data.integracoes ?? []).filter(
    (i) => i.situacao === 'PARADA' || i.situacao === 'INSTAVEL' || i.situacao === 'NAO_RODOU',
  );
  if (problemas.length === 0) return null;

  return (
    <>
      {problemas.map((i) => {
        const instavel = i.situacao === 'INSTAVEL';
        const naoRodou = i.situacao === 'NAO_RODOU';
        const fonte = O_QUE_A_FONTE_TRAZ[i.fonte] ?? {
          nome: i.fonte,
          oQue: 'os dados dessa fonte',
          incompleto: 'Alguns dados podem não ter chegado.',
        };
        const quando = i.ultimoSucesso
          ? new Date(i.ultimoSucesso).toLocaleDateString('pt-BR', {
              weekday: 'long', day: '2-digit', month: '2-digit',
            })
          : null;

        return (
          <AlertBar
            key={i.fonte}
            tom="atencao"
            aoAgir={i.fonte === 'DJEN' && podeVarrerDjen ? () => varrer.mutate() : undefined}
            rotuloAcao={varrer.isPending ? 'Buscando…' : 'Buscar agora'}
            agindo={varrer.isPending}
          >
            {instavel ? (
              <>
                <strong className="font-semibold">{fonte.incompleto}</strong> O{' '}
                {fonte.nome} recusou {i.falhas24} de {i.ok24 + i.falhas24}{' '}
                consultas hoje.
              </>
            ) : (
              <>
                O sistema{' '}
                {quando ? 'não recebe' : 'ainda não recebeu'}{' '}
                <strong className="font-semibold">{fonte.oQue}</strong>
                {quando ? ` desde ${quando}` : ''}.{' '}
                {naoRodou
                  ? 'A busca automática, que roda toda madrugada, não executou.'
                  : `O ${fonte.nome} não respondeu às últimas tentativas.`}
              </>
            )}
            {/*
              O BOTÃO DIZ QUANTO CUSTA — e diz nos dois estados, não só num
              deles. Um clique que segura a tela por um minuto sem avisar é um
              clique que ninguém dá duas vezes.
            */}
            {i.fonte === 'DJEN' && podeVarrerDjen && (
              <span className="mt-0.5 block text-[11px] opacity-80">
                Buscar agora consulta o Diário para todos os advogados — leva cerca
                de um minuto.
              </span>
            )}
          </AlertBar>
        );
      })}
    </>
  );
}

function Aniversariantes({
  data, podeCompletar, onCompletar,
}: {
  data: ResumoDashboard;
  /** Quem edita filiado ganha o atalho de recadastro. */
  podeCompletar?: boolean;
  onCompletar?: (filiadoId: string) => void;
}) {
  const itens = data.aniversariantes ?? [];
  if (itens.length === 0) return null; // dia sem aniversário não vira card vazio

  return (
    <SectionCard title="Aniversariantes de hoje" icon={Cake} count={itens.length}>
      <ul className="divide-y divide-border/60">
        {itens.map((p) => {
          const primeiroNome = p.nome.split(' ')[0];
          const msg = `Olá, ${primeiroNome}! O ${tenant.sigla} deseja a você um feliz aniversário! 🎉`;
          const zap = p.telefone
            ? `https://wa.me/55${p.telefone.replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`
            : null;
          return (
            <li key={`${p.tipo}-${p.id}`} className="flex items-center gap-3 px-2 py-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-pink-100 dark:bg-pink-950/40">
                <Cake className="h-4 w-4 text-pink-700 dark:text-pink-300" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{p.nome}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {p.idade > 0 && `${p.idade} anos · `}
                  {p.tipo === 'FILIADO' ? 'Filiado(a)' : 'Equipe'}
                </p>
              </div>
              {zap ? (
                <a
                  href={zap}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 rounded-lg bg-[#25D366] px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-[#20bd5a]"
                >
                  Parabenizar
                </a>
              ) : podeCompletar && p.tipo === 'FILIADO' ? (
                /*
                  SEM TELEFONE ERA BECO SEM SAÍDA — e é o caso mais comum.

                  Medido em 04/09/2026: 7.137 dos 7.291 filiados não têm
                  telefone. O card dizia "sem telefone" e acabava ali: não dava
                  para parabenizar nem para consertar. O aniversário é o melhor
                  momento para completar a ficha, porque a pessoa já está na
                  tela e há um motivo para ligar.
                */
                <button
                  type="button"
                  onClick={() => onCompletar?.(p.id)}
                  className="shrink-0 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition hover:bg-muted"
                >
                  Completar cadastro
                </button>
              ) : (
                <span className="shrink-0 text-[11px] text-muted-foreground">sem telefone</span>
              )}
            </li>
          );
        })}
      </ul>
      {/*
        A LISTA É UMA AMOSTRA, e dizer isso é obrigação.

        Só 499 dos 7.291 filiados têm data de nascimento no cadastro (7%). Sem
        esta linha, quem parabeniza dois hoje conclui que parabenizou todo
        mundo — e a ausência de aniversariante num dia parece "não tem", quando
        é "não sabemos".
      */}
      <p className="border-t px-2 pt-2 text-[11px] leading-snug text-muted-foreground">
        Só aparece quem tem data de nascimento no cadastro.
      </p>
    </SectionCard>
  );
}

/** "8,3 h" ou "2 d 4 h" — hora crua acima de um dia não se lê. */
function duracaoLegivel(horas: number): string {
  if (horas < 1) return `${Math.round(horas * 60)} min`;
  if (horas < 24) return `${horas.toString().replace('.', ',')} h`;
  const d = Math.floor(horas / 24);
  const h = Math.round(horas % 24);
  return h ? `${d} d ${h} h` : `${d} d`;
}

function AtendimentosPendentes({ data }: { data: ResumoDashboard }) {
  const itens = data.atendimentosPendentes;
  const tm = data.tempoMedioTriagem;
  return (
    <SectionCard title="Atendimentos pendentes" icon={Inbox} count={data.kpis.atendimentosPendentes} actionHref="/atendimentos" actionLabel="Triagem">
      {/* Tempo médio de resolução: a régua da triagem. Fica no card dos
          atendimentos porque é ali que ele significa alguma coisa — solto num
          KPI, viraria número sem contexto. */}
      {tm?.horas !== null && tm?.horas !== undefined && (
        <p className="mb-2 flex items-center gap-1.5 rounded-lg bg-muted/60 px-2.5 py-1.5 text-[11px] text-muted-foreground">
          <Timer className="h-3.5 w-3.5 shrink-0" />
          Tempo médio de resolução:{' '}
          <strong className="text-foreground">{duracaoLegivel(tm.horas)}</strong>
          <span className="opacity-70">· {tm.amostra} resolvidos em 30 dias</span>
        </p>
      )}
      {itens.length === 0 ? (
        <EmptyState icon={CheckCircle2}>Nenhum atendimento aguardando resolução.</EmptyState>
      ) : (
        <ul className="divide-y divide-border/60">
          {itens.map((a) => (
            <li key={a.id}>
              <Link href={`/atendimentos?atendimento=${a.id}`} className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition hover:bg-muted/60">
                <span className="w-1 shrink-0 self-stretch rounded-full bg-amber-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    <span className="text-muted-foreground">#{a.numero}</span> {a.filiado.nomeCompleto}
                  </p>
                  <p className="text-xs text-muted-foreground">{CANAL_LABEL[a.canal]} · aberto {tempoRelativo(a.createdAt)}</p>
                </div>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                  Pendente
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

/**
 * CONTRA QUEM O SINDICATO LITIGA — a leitura que faltava.
 *
 * Um sindicato não processa cento e vinte réus diferentes: processa os mesmos
 * empregadores, de novo e de novo. Na produção, FMS/THE aparece em 10 processos
 * ativos, Unimed em 7, Hapvida em 6 — e nenhuma tela dizia isso. É a informação
 * que sustenta a decisão de sentar para negociar, propor um TAC ou trocar dez
 * ações individuais por uma coletiva.
 *
 * Três processos é o piso: menos que isso é coincidência, não padrão. O bloco
 * some sozinho quando ninguém alcança o piso.
 */
function AdversariosRecorrentes({ data }: { data: ResumoDashboard }) {
  // `?? []` não é paranoia: web e API são serviços separados no Railway e
  // sobem em minutos diferentes. Num rollback da API, o campo some e o
  // acesso direto derrubaria a home inteira — não só este bloco.
  const itens = data.adversarios ?? [];
  if (!itens.length) return null;
  const maior = itens[0].processos;

  return (
    <SectionCard
      title="Contra quem litigamos"
      icon={Swords}
      count={itens.length}
      actionHref="/panorama"
      actionLabel="Panorama"
    >
      <ul className="space-y-1">
        {itens.map((a) => (
          <li key={a.id}>
            <Link
              href={`/processos?parteExternaId=${a.id}`}
              className="-mx-2 block rounded-lg px-2 py-1.5 transition hover:bg-muted/60"
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-sm">{a.nome}</span>
                <span className="shrink-0 text-xs font-medium text-muted-foreground">
                  {a.processos}
                </span>
              </span>
              {/*
                A barra é comparação, não decoração: sem ela, "10, 7, 6, 5" é
                uma coluna de números que ninguém lê. Com ela, dá para ver de
                relance que um réu pesa o dobro do outro.
              */}
              <span
                aria-hidden
                className="mt-1 block h-1 rounded-full bg-brand-100 dark:bg-brand-950/50"
              >
                <span
                  className="block h-full rounded-full bg-brand-600 dark:bg-brand-500"
                  style={{ width: `${Math.round((a.processos / maior) * 100)}%` }}
                />
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
        Processos ativos por parte contrária. Clique para ver a lista — ou abra o Panorama
        para saber o que essas ações pedem e como vêm sendo julgadas.
      </p>
    </SectionCard>
  );
}

function MovimentacoesRecentes({ data }: { data: ResumoDashboard }) {
  const itens = data.movimentacoesRecentes;
  return (
    <SectionCard title="Movimentações recentes (DataJud · 7 dias)" icon={Landmark} count={itens.length} actionHref="/processos">
      {itens.length === 0 ? (
        <EmptyState icon={Landmark}>Nenhuma movimentação processual nos últimos 7 dias.</EmptyState>
      ) : (
        <ul className="divide-y divide-border/60">
          {itens.map((m) => (
            <li key={m.id}>
              <Link href={`/processos?processo=${m.processo.id}`} className="flex items-start gap-3 rounded-lg px-2 py-2.5 transition hover:bg-muted/60">
                <Landmark className="mt-0.5 h-4 w-4 shrink-0 text-brand-800 dark:text-brand-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{m.descricao}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {m.processo.numeroCNJ}
                    {m.processo.filiado ? ` · ${m.processo.filiado.nomeCompleto}` : ''}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{tempoRelativo(m.dataMovimento)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

// ===========================================================================
// Gráficos
// ===========================================================================

function GraficoTendencia({ data, podeAtend, podeFil }: { data: ResumoDashboard; podeAtend: boolean; podeFil: boolean }) {
  const abas = [
    podeAtend && { key: 'atendimentos' as const, label: 'Atendimentos (14 dias)' },
    podeFil && { key: 'filiados' as const, label: 'Quadro associativo (6 meses)' },
  ].filter(Boolean) as { key: 'atendimentos' | 'filiados'; label: string }[];
  const [aba, setAba] = useState<'atendimentos' | 'filiados'>(abas[0]?.key ?? 'atendimentos');
  /**
   * A cor da marca COMO ESTÁ NA TELA — não a compilada no build. Ver
   * `useCorDaMarca`: quem troca a cor em Configurações mudava a interface
   * inteira e não mudava os gráficos.
   */
  const corMarca = useCorDaMarca(800);
  const corMarcaClara = useCorDaMarca(600);

  /**
   * No quadro associativo, as séries são alternáveis: comparar entrada e saída
   * lado a lado é o ponto, mas isolar uma delas responde "quanto perdemos em
   * março?" sem a outra curva atrapalhando a leitura da escala.
   */
  const [series, setSeries] = useState<{ entradas: boolean; saidas: boolean; saldo: boolean }>({
    entradas: true, saidas: true, saldo: false,
  });
  const alternar = (k: keyof typeof series) =>
    setSeries((s) => {
      const proximo = { ...s, [k]: !s[k] };
      // Nunca deixa o gráfico vazio: desligar a última série não faz sentido.
      return Object.values(proximo).some(Boolean) ? proximo : s;
    });

  const ehFiliados = aba === 'filiados';
  const chartData = ehFiliados ? data.graficos.movimentacaoQuadro : data.graficos.atendimentos14dias;
  const xKey = ehFiliados ? 'mes' : 'dia';

  return (
    <Card className="h-full">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3.5">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-brand-800 dark:text-brand-400" />
          <h3 className="text-sm font-semibold">Tendência</h3>
        </div>
        {abas.length > 1 && (
          <div className="flex rounded-lg border p-0.5">
            {abas.map((a) => (
              <button key={a.key} onClick={() => setAba(a.key)}
                className={cn('rounded-md px-2.5 py-1 text-xs font-medium transition',
                  aba === a.key ? 'bg-brand-800 text-white' : 'text-muted-foreground hover:text-foreground')}>
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {/* Transparência sobre a lacuna: parte da base veio da carga sem data de
          filiação e fica FORA da série. Dizer o número é mais honesto do que
          deixar o gráfico parecer completo. */}
      {ehFiliados && data.graficos.filiadosSemDataFiliacao > 0 && (
        <p className="border-b px-5 py-2 text-[11px] text-muted-foreground">
          <strong>{data.graficos.filiadosSemDataFiliacao.toLocaleString('pt-BR')}</strong> filiados
          da base importada estão sem data de filiação e não entram no gráfico.
        </p>
      )}

      {/* Legenda interativa — só no quadro associativo, onde há o que comparar */}
      {ehFiliados && (
        <div className="flex flex-wrap gap-1.5 border-b px-5 py-2">
          {([
            ['entradas', 'Entradas', corMarca],
            ['saidas', 'Saídas', COR_SAIDA],
            ['saldo', 'Saldo', COR_SALDO],
          ] as const).map(([k, rotulo, cor]) => (
            <button
              key={k}
              type="button"
              onClick={() => alternar(k)}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition',
                series[k] ? 'bg-muted' : 'opacity-45 hover:opacity-70',
              )}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: cor }} />
              {rotulo}
            </button>
          ))}
        </div>
      )}

      <CardContent className="h-64 p-4">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
            <defs>
              {/* `grad-marca`, e não mais `grad-verde`: o nome dizia a cor de UM
                  cliente num código que serve a vários — e a cor agora vem da
                  marca em tempo de execução, então nem hoje ela é verde em toda
                  instalação. */}
              <linearGradient id="grad-marca" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={corMarcaClara} stopOpacity={0.55} />
                <stop offset="95%" stopColor={corMarcaClara} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="grad-saida" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={COR_SAIDA} stopOpacity={0.4} />
                <stop offset="95%" stopColor={COR_SAIDA} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
            <XAxis dataKey={xKey} fontSize={11} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis fontSize={11} allowDecimals={false} tickLine={false} axisLine={false} width={28} />
            <Tooltip
              contentStyle={{ borderRadius: 12, border: '1px solid hsl(var(--border))', fontSize: 12 }}
              labelStyle={{ fontWeight: 600 }}
            />
            {ehFiliados ? (
              <>
                {series.entradas && (
                  <Area type="monotone" dataKey="entradas" name="Entradas" stroke={corMarca}
                    strokeWidth={2} fill="url(#grad-marca)" />
                )}
                {series.saidas && (
                  <Area type="monotone" dataKey="saidas" name="Saídas" stroke={COR_SAIDA}
                    strokeWidth={2} fill="url(#grad-saida)" />
                )}
                {series.saldo && (
                  <Area type="monotone" dataKey="saldo" name="Saldo" stroke={COR_SALDO}
                    strokeWidth={2} strokeDasharray="4 3" fill="none" />
                )}
              </>
            ) : (
              <Area type="monotone" dataKey="total" name="Total" stroke={corMarca} strokeWidth={2} fill="url(#grad-marca)" />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function GraficoCanais({ data }: { data: ResumoDashboard }) {
  const dados = data.graficos.atendimentosPorCanal
    .filter((c) => c.total > 0)
    .map((c) => ({ nome: CANAL_LABEL[c.canal], total: c.total }));
  const total = dados.reduce((s, d) => s + d.total, 0);

  return (
    <Card className="h-full">
      <div className="flex items-center gap-2 border-b px-5 py-3.5">
        <Inbox className="h-4 w-4 text-brand-800 dark:text-brand-400" />
        <h3 className="text-sm font-semibold">Atendimentos por canal</h3>
      </div>
      <CardContent className="p-4">
        {total === 0 ? (
          <EmptyState icon={Inbox}>Sem atendimentos registrados.</EmptyState>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="relative h-40 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={dados} dataKey="total" nameKey="nome" cx="50%" cy="50%" innerRadius={45} outerRadius={68} paddingAngle={2} strokeWidth={0}>
                    {dados.map((_, i) => (
                      <Cell key={i} fill={PALETA_CATEGORICA[i % PALETA_CATEGORICA.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid hsl(var(--border))', fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold leading-none">{total}</span>
                <span className="text-[11px] text-muted-foreground">total</span>
              </div>
            </div>
            <ul className="grid w-full grid-cols-2 gap-x-3 gap-y-1.5">
              {dados.map((d, i) => (
                <li key={d.nome} className="flex items-center gap-1.5 text-xs">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: PALETA_CATEGORICA[i % PALETA_CATEGORICA.length] }} />
                  <span className="truncate text-muted-foreground">{d.nome}</span>
                  <span className="ml-auto font-semibold tabular-nums">{d.total}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ===========================================================================
// Skeleton de carregamento
// ===========================================================================

function SkeletonHome() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[104px] animate-pulse rounded-xl border bg-muted/40" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="h-72 animate-pulse rounded-xl border bg-muted/40" />
        <div className="h-72 animate-pulse rounded-xl border bg-muted/40 lg:col-span-2" />
      </div>
    </div>
  );
}
