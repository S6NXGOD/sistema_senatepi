'use client';

import { useMemo, useState } from 'react';
import { formatDataPura, diasDesdeDataPura } from '@/lib/data-pura';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  criarTarefaDaPublicacao, previaDaTarefa, umaPublicacao, varrerDjenAgora, resultadoDaVarredura,
} from '@/lib/djen';
import { atrasoEscalonado } from '@/lib/movimento';
import { useAnimacaoDeGrafico } from '@/lib/grafico';
import { celularParaWhatsApp, linkWhatsApp } from '@/lib/whatsapp';
import {
  Carregando, Esqueleto, EsqueletoCartoes, EsqueletoGrafico, EsqueletoLinhas,
} from '@/components/ui/esqueleto';
import { RecadastrarModal } from '@/components/filiados/recadastrar-modal';
import { ChipEncaminhamento } from '@/components/atendimentos/estado-do-encaminhamento';
import {
  Briefcase, Clock, AlarmClock, Users, Gavel, CalendarDays,
  Flame, AlertTriangle, Landmark, Inbox, UserCheck, RefreshCw, Cake, Timer,
  CheckCircle2, ChevronRight, ChevronDown, FolderKanban, TrendingUp, Info, AlertCircle, Loader2,
  Newspaper, CalendarPlus, CalendarClock, ExternalLink,
  FileCheck2, Hourglass, Headset, Swords, UserCog,
} from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell,
} from 'recharts';
import { useAuth } from '@/lib/auth';
import { podeEditar, podeVer, PERFIL_LABEL, type PerfilUsuario } from '@/lib/permissoes';
import { CANAIS, CANAL_LABEL } from '@/lib/atendimentos';
import {
  getResumoDashboard, saudacao, dataPorExtenso, tempoRelativo, horaCurta,
  primeiroNome, motivoFalhaDatajud, esperaAindaRazoavel, diasEsperando, diasSemAcesso,
  separarDesconhecidos, ultimaTentativaDoCnj,
  linkDaAgenda, linkDosPrazosDaSemana, seloDasAudienciasDaSemana,
  textoDoLinkDeRecadastro, mensagemDeAniversario, DIAS_PARA_PARADO,
  barraDoAtendimento, cartaoDosAtendimentos, explicacaoDaPublicacaoSemTarefa, kpiDoBalcao, kpiDosAtendimentos,
  fatiasDosCanais, registrarAniversario, estadoDosAniversarios, resumoDosAniversarios, soOPrimeiroNome,
  type ResumoDashboard, type FalhaDatajud, type ProcessoDesconhecidoNoCnj,
} from '@/lib/dashboard';
import { AvatarPessoa } from '@/components/ui/avatar-pessoa';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { LinhaDaCarteira } from '@/components/dashboard/linha-da-carteira';
import { MovimentoNoDiario } from '@/components/dashboard/movimento-no-diario';
import { CadastroFiliadoModal } from '@/components/filiados/cadastro-filiado-modal';
import { formatNPU } from '@/lib/processos';
// A prévia mostra QUANDO a tarefa cai na agenda — no fuso de Teresina,
// como o resto do sistema (ver `data-br.util` do lado da API).
import { formatDataHora } from '@/lib/agenda';
import { PROVIDENCIA_LABEL } from '@/lib/djen';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  KpiCard, SectionCard, EmptyState, AvatarMini,
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
        <SkeletonHome pode={pode} role={role} />
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
 *
 * PASSA PARA DIAS DEPOIS DE 48 h (18/09/2026). A mesma função serve ao "atualizado
 * há X" do cabeçalho (segundos) e ao "a última varredura foi há X" do robô, que
 * pode estar parado há semanas. Sem o corte, a tela dizia "a última foi há
 * 1008 h" — verdade que ninguém lê: são 42 dias. Hora acima de dois dias é
 * número que a pessoa precisa dividir de cabeça.
 */
function idadeDoDado(quando: number): string {
  const s = Math.max(0, Math.round((Date.now() - quando) / 1000));
  if (s < 45) return 'agora há pouco';
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  const horas = Math.round(s / 3600);
  if (horas < 48) return `há ${horas} h`;
  const dias = Math.round(horas / 24);
  return dias < 60 ? `há ${dias} dias` : `há ${Math.round(dias / 30)} meses`;
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
  /* Enquanto houver aniversariante sem decisão, o cartão pede alguém e divide a
     grade com os cadastros a completar; cuidado, ele vira uma linha acima. */
  const aniversariosPedemAlguem =
    estadoDosAniversarios(data.aniversariantes ?? []).pendentes > 0;
  const qc = useQueryClient();
  const { user } = useAuth();
  /**
   * Id do filiado sendo recadastrado por cima do painel. Quem viu o dado
   * faltando conserta sem perder a tela de onde veio.
   */
  const [recadastrando, setRecadastrando] = useState<string | null>(null);
  /** O formulário presencial, aberto pela porta "preencher agora" do recadastramento. */
  const [presencial, setPresencial] = useState<string | null>(null);
  /** Quem GRAVA filiado: é de quem é a fila de recadastro. */
  const podeEditarFiliado = podeEditar(role, user?.permissoes, 'filiados');
  /** O nome para o cabeçalho do recadastramento — de onde quer que o clique tenha vindo. */
  const nomeDoFiliado = (id: string): string =>
    (data.cadastrosACompletar ?? []).find((f) => f.id === id)?.nome ??
    (data.aniversariantes ?? []).find((p) => p.id === id)?.nome ??
    '';

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
    /*
      DUAS CONDIÇÕES QUE PRECISAM ANDAR JUNTAS. A permissão esconde o cartão e
      a API manda nulo para o mesmo perfil — amarrar o render ao DADO evita que
      uma das duas mude sozinha e o cartão apareça vazio (ou com número que não
      deveria ter saído do servidor).
    */
    pode.processos && kpis.processosAtivos !== null && {
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
    /*
      COM A TRIAGEM (15/09/2026): conta só o que pede uma ação dela, e abre a
      lista no MESMO recorte. O que espera a consulta está na agenda de quem
      atende e não soma aqui.
    */
    /*
      E NÃO PARA A TRIAGEM, que já tem o dela (18/09/2026). "Com a triagem" e
      "Comigo, com a triagem" eram dois cartões quase homônimos na MESMA tela:
      um conta a fila da casa, o outro a fila dela. Para quem trabalha a fila,
      o número que importa é o próprio — o da casa vira ruído com nome parecido.
    */
    pode.atendimentos && !ehTriagem && {
      ...kpiDosAtendimentos(kpis),
      icon: Clock, cor: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
    },
    /* Prazo é do jurídico. A Triagem acompanha a agenda, mas o prazo da semana
       não é trabalho dela e competia com os três números do balcão. */
    pode.agenda && !ehTriagem && {
      label: 'Prazos esta semana', valor: kpis.prazosSemana, sub: 'próximos 7 dias',
      icon: AlarmClock, cor: 'bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400',
      // No advogado a API conta só os prazos dele: o link leva `pessoa=eu`.
      href: linkDosPrazosDaSemana(data.escopo),
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
    OS NÚMEROS DA CASA — e ONDE eles ficam depende de quem está olhando.

    Para quem tem CARTEIRA PRÓPRIA não vão: eram dez contadores no painel do
    advogado (seis na carteira e mais quatro aqui), e "Filiados ativos" nunca
    mudou uma decisão de advogado.

    Para a TRIAGEM eles sobem para junto do balcão dela (18/09/2026): "tô
    achando muito embaixo a informação da quantidade filiados, processos etc.".
    Estavam mesmo — depois da fila, dos aniversariantes e dos cadastros a
    completar, a quase uma tela inteira de rolagem. Junto do balcão eles são o
    que são: o pano de fundo do dia dela, ao lado do que ela mesma produziu.

    Para a gestão seguem onde estavam, depois do que precisa de gente.
  */
  /*
    A GRADE ACOMPANHA O QUE EXISTE (18/09/2026). Era `lg:grid-cols-4` fixo, e a
    Triagem — que perdeu "Com a triagem" (duplicado) e "Prazos esta semana"
    (não é dela) — ficava com UM cartão ocupando um quarto da largura e três
    quartos em branco. É o mesmo defeito que este arquivo já corrigiu duas vezes
    em outros blocos.
  */
  const gradeDeNumeros = !escopoPessoal && kpiCards.length > 0 ? (
    <div
      className={cn(
        'grid gap-4',
        kpiCards.length === 1 && 'grid-cols-1 sm:max-w-xs',
        kpiCards.length === 2 && 'grid-cols-2',
        kpiCards.length === 3 && 'grid-cols-2 lg:grid-cols-3',
        kpiCards.length >= 4 && 'grid-cols-2 lg:grid-cols-4',
      )}
    >
      {kpiCards.map((c, i) => (
        /*
          ENTRADA POR CSS, na inserção: a revalidação de 60 s não repete nada.
          O escalonamento tem teto (200 ms no total) e some com "reduzir
          movimento". Era framer só para isto.
        */
        <div key={c.label} className="animate-surgir" style={{ animationDelay: atrasoEscalonado(i) }}>
          <KpiCard {...c} />
        </div>
      ))}
    </div>
  ) : null;

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
      {/*
        A CARTEIRA VEM ANTES DO TRABALHO — e isto é correção de rota do mesmo
        dia (18/09/2026). Ver `LinhaDaCarteira`: eram dez contadores, viraram
        uma linha de texto, e o dono pediu os números de volta ("a dashboard tem
        que ter dados"). São quatro, custam ~200px em duas fileiras no telefone,
        e a fila de trabalho continua visível sem rolar.
      */}
      {minhaCarteira && (
        <LinhaDaCarteira carteira={minhaCarteira} prazosNaSemana={kpis.prazosSemana ?? 0} />
      )}

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

      {/*
        SUA EQUIPE, LOGO DEPOIS DA SUA AGENDA. O que é seu vem primeiro; em
        seguida, o que é dos colegas dos seus casos — em âmbar só quando ninguém
        está cuidando. A API manda o bloco só para o advogado.
      */}
      {pode.agenda && alertas.daEquipe && <DaSuaEquipe daEquipe={alertas.daEquipe} />}



      {/*
        A FILA DO BALCÃO. O painel já mostrava "atendimentos pendentes" — o
        número do sindicato inteiro. Quem atende precisa do próprio: quanto EU
        registrei hoje, e quanto ainda está na minha mão.
      */}
      {data.minhaTriagem && (
        <section>
          <SectionTitle icon={Headset} texto="Meu balcão hoje" />
          {/*
            O MESMO ESPAÇAMENTO DA CARTEIRA. Aqui era `gap-4` no telefone
            enquanto a carteira do advogado usa `gap-2` — 16 px a mais roubados
            de três cartões que já estavam apertados.
          */}
          <div className="grid grid-cols-3 gap-2 sm:gap-4">
            <KpiCard label="Registrei hoje" valor={data.minhaTriagem.registradosHoje} sub="atendimentos"
              icon={Headset} cor="bg-brand-50 text-brand-800 dark:bg-brand-900/30 dark:text-brand-400" href="/atendimentos" destaque />
            {/* Pela fila (15/09/2026): o que só espera a consulta não está "comigo". */}
            <KpiCard {...kpiDoBalcao(data.minhaTriagem)}
              icon={Clock} cor="bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400" destaque />
            <KpiCard label="Filiações hoje" valor={data.minhaTriagem.filiadosHoje} sub="cadastros novos"
              icon={Users} cor="bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400" href="/filiados" destaque />
          </div>
          {/*
            OS NÚMEROS DA CASA LOGO ABAIXO DO BALCÃO — ver `gradeDeNumeros`.
            Eles estavam a quase uma tela de rolagem daqui, depois da fila, dos
            aniversariantes e dos cadastros a completar.
          */}
          {ehTriagem && gradeDeNumeros && <div className="mt-3">{gradeDeNumeros}</div>}
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
      {pode.processos && <AvisoRobo robo={data.robo} resumido={escopoPessoal} />}
      {/*
        A MESMA COISA DUAS VEZES NÃO É DOIS AVISOS.

        Quando a barra de integrações já diz que o DJEN parou ou não rodou, o
        "nenhuma publicação nova" logo abaixo é a CONSEQUÊNCIA disso —
        apresentada como se fosse um achado independente. Foi o que a tela do
        usuário mostrou: duas faixas sobre o DJEN, uma vermelha e uma âmbar,
        dizendo o mesmo fato de dois ângulos.
      */}
      {pode.processos && (
        <PublicacoesDjen
          djen={data.djen}
          calado={integracaoDjenComProblema(data)}
          /*
            OS DOIS MÓDULOS, como o radar de audiências ao lado.

            A rota vive em `@Modulo('processos')` e é um POST — quem tem
            `processos: VISUALIZAR` toma 403 mesmo com a agenda liberada. Gatear
            só pela agenda ofereceria um botão que a API recusa depois do
            clique, que é o defeito que `podeExcluir` existe para não repetir.
          */
          podeCriarTarefa={
            podeEditar(role, user?.permissoes, 'processos') &&
            podeEditar(role, user?.permissoes, 'agenda')
          }
        />
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
      {/*
        ATIVIDADE PARADA HÁ 7 DIAS É COBRANÇA (18/09/2026). Para o advogado a
        conta é do que é DELE; para a coordenação, da casa. Para a Triagem era a
        casa inteira, com o rosto de cada responsável, numa tela em que ela tem
        `agenda: VISUALIZAR` — ver que o jurídico está devendo sem poder tocar.
      */}
      {pode.agenda && !ehTriagem && alertas.semMovimentacao > 0 && (
        <div className="space-y-2">
          {/* Passou de vermelho sólido para info, e ganhou o número.
              "Atenção!" com fundo vermelho para uma atividade parada há uma
              semana competia visualmente com falha de sistema — e a frase
              seguinte ("manter atualizado é essencial para a qualidade do
              atendimento") repreendia sem informar. O que a pessoa precisa
              saber é QUANTAS são e onde estão. */}
          {alertas.semMovimentacao > 0 && (
            <AtividadesParadas total={alertas.semMovimentacao} itens={alertas.paradas ?? []} />
          )}
        </div>
      )}


      {/*
        FILA DA TRIAGEM — ANTES DOS NÚMEROS (18/09/2026).

        Ela vinha DEPOIS dos KPIs da casa e da faixa de atividades paradas do
        jurídico: a secretaria abria o sistema e via três contagens e o atraso
        dos advogados antes da própria fila. Trabalho antes de número é a regra
        da casa, e aqui ela estava invertida justamente para quem tem a fila
        mais concreta de todas.
      */}
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
          {/*
            A GRADE SÓ EXISTE QUANDO OS DOIS SÃO CARTÃO (18/09/2026).

            Com o dia de aniversários já cuidado, `Aniversariantes` encolhe para
            UMA LINHA — e dentro de uma grade de duas colunas essa linha era
            esticada pela vizinha, que tem doze cadastros: uma caixa verde
            VAZIA do tamanho de meia tela para dizer uma frase. Agora a linha
            sai da grade e fica em cima, onde custa 32px.
          */}
          {pode.filiados && (
            <div className="mt-4 space-y-4">
              {!aniversariosPedemAlguem && (
                <Aniversariantes
                  data={data}
                  podeCompletar={podeEditarFiliado}
                  onCompletar={setRecadastrando}
                />
              )}
              <div
                className={cn(
                  'grid grid-cols-1 gap-4',
                  aniversariosPedemAlguem && podeEditarFiliado && 'lg:grid-cols-2',
                )}
              >
                {aniversariosPedemAlguem && (
                  <Aniversariantes
                    data={data}
                    podeCompletar={podeEditarFiliado}
                    onCompletar={setRecadastrando}
                  />
                )}
                {podeEditarFiliado && (
                  <CadastrosACompletar data={data} onCompletar={setRecadastrando} />
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {/* ZONA 2 — os números. Para a Triagem eles já saíram lá em cima. */}
      {!ehTriagem && gradeDeNumeros}



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
              {pode.agenda && !vazio.audienciasSemana && <AudienciasSemana data={data} pessoal={escopoPessoal} />}
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
                /* O placar nominal ("Esperando por: Fulano 3") é de quem
                   coordena. A Triagem via os nomes com o atraso de cada um numa
                   tela em que não pode resolver nada — ver `porPessoa`. */
                cobra={ehGestao}
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
      {/*
        A TRIAGEM PASSOU A VER OS GRÁFICOS — 18/09/2026.

        "Esse gráfico 'Atendimentos por canal' assim como outros não deveriam
        aparecer para a triagem também para terem base?" — e a resposta é sim.
        Ela é quem REGISTRA o atendimento: por onde as pessoas procuram o
        sindicato e como o volume andou nos 14 dias é a base do trabalho dela,
        não relatório de diretoria. Gestão via, quem produz o dado não via.

        A guarda passou de PERFIL para MÓDULO, que é o que a casa manda: quem
        tem `atendimentos` vê os dois; o advogado, que tem carteira própria e
        atendimentos só de leitura, continua fora — ali é ênfase, não acesso,
        e o dado dele está em Relatórios.
      */}
      {pode.atendimentos && !escopoPessoal && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <GraficoTendencia data={data} podeAtend={pode.atendimentos} podeFil={pode.filiados} />
          </div>
          <GraficoCanais data={data} />
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
      {/*
        A FILA DA TRIAGEM NÃO É DO ADVOGADO (18/09/2026). O dono perguntou se
        "Com a triagem" era mesmo necessário no painel dele. Não é: ele tem
        `atendimentos: VISUALIZAR`, nenhum toque dele resolve uma linha daquela
        fila, e o cartão ainda trazia a régua de desempenho da secretaria.
        Painel que mostra trabalho que você não pode fazer ensina a não ler o
        painel. Continua na Triagem e na Coordenação, onde é trabalho de quem vê.
      */}
      {pode.atendimentos && !ehTriagem && !escopoPessoal && !vazio.atendimentos && (
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

      {/*
        O RECADASTRO ACONTECE POR CIMA DO PAINEL, e com as DUAS portas.

        O painel abria direto o formulário presencial. Quem foi "atendido há
        pouco" costuma ter falado pelo WhatsApp, e a porta certa é o link — que
        estava na ficha e no cadastro de processo, não aqui. O modal é o mesmo
        deles; `semNavegar` mantém a pessoa no painel quando escolhe preencher
        agora.

        E a chave é a do painel: `['dashboard']` não existe, e a pessoa recém-
        completada ficava na fila até o refetch de 60 s.
      */}
      {recadastrando && (
        <RecadastrarModal
          open
          filiadoId={recadastrando}
          filiadoNome={nomeDoFiliado(recadastrando)}
          semNavegar
          onRecadastrarPresencial={(id) => {
            setRecadastrando(null);
            setPresencial(id);
          }}
          onClose={() => {
            setRecadastrando(null);
            qc.invalidateQueries({ queryKey: ['dashboard-resumo'] });
          }}
        />
      )}
      <CadastroFiliadoModal
        open={!!presencial}
        filiadoId={presencial}
        onClose={() => setPresencial(null)}
        onSalvo={() => {
          setPresencial(null);
          qc.invalidateQueries({ queryKey: ['dashboard-resumo'] });
        }}
      />

      {/* Leitura de acervo: com quem brigamos, e o que andou nos processos.
          As duas são contexto, não alerta — por isso ficam no rodapé. */}
      {/*
        O ACERVO VOLTOU PARA O ADVOGADO — e a correção é do título, não do bloco.

        Eu tinha tirado os dois do painel dele. O dono: "'Contra quem litigamos'
        aparece para a triagem, por que não ao advogado? Não há mais gráficos e
        informações que deveriam aparecer para os advogados?" — e ele está
        certo. Saber contra quem se litiga mais e o que andou nos processos É
        informação de advogado; o defeito nunca foi o conteúdo.

        O DEFEITO ERA O RÓTULO. "Contra quem litigamos" com conteúdo recortado
        pelo acervo DELE prometia a instituição e entregava a carteira — duas
        coisas discordando na mesma moldura. E "Movimentações recentes" chamava
        de recente o que o DataJud entrega com mediana de 62 dias de atraso.
        Os dois títulos passaram a dizer a verdade — ver `AdversariosRecorrentes`
        e `MovimentacoesRecentes`, mais abaixo neste arquivo.
      */}
      {/*
        E O ADVOGADO GANHOU UM GRÁFICO. Ele tinha ZERO e a Triagem, quatro —
        todos sobre atendimento e filiação. O ritmo do Diário é o dele, é
        diário de verdade (o DataJud atrasa 62 dias) e mora aqui, na leitura,
        porque não pede nada: o que pede está em "Suas publicações", acima.
      */}
      {pode.processos && (
        <div
          className={cn(
            'grid grid-cols-1 gap-4',
            (data.movimentoNoDiario ? 1 : 0) + (vazio.movimentacoes ? 0 : 1) +
              (data.adversarios.length ? 1 : 0) >
              1 && 'lg:grid-cols-2',
          )}
        >
          {data.movimentoNoDiario && <MovimentoNoDiario mov={data.movimentoNoDiario} />}
          <AdversariosRecorrentes data={data} pessoal={escopoPessoal} />
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

  /*
    O NÍVEL `info` NÃO É UM ALARME, e parava de se vestir como um (18/09/2026).

    Pela própria escala desta função, `info` é "nada errado, só vale saber" — e
    ainda assim desenhava o mesmo retângulo com borda, fundo e 4 linhas que o
    "algo está quebrado agora". Dois desses empurravam os números do painel para
    fora da primeira dobra no telefone.

    Aqui ele vira UMA LINHA discreta: sem borda, sem fundo, texto apagado. O que
    pede alguém — `atencao` e `critico` — continua exatamente como era. A régua
    da casa é que o corte nunca esconde o que pede atenção; esconder o que não
    pede é o contrário disso, é devolver espaço a quem precisa.
  */
  if (tom === 'info' && !aoAgir) {
    return (
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-1 text-xs text-muted-foreground">
        <span className="flex items-start gap-1.5">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
          <span className="min-w-0">{children}</span>
        </span>
        {href && (
          <Link href={href} className="shrink-0 font-medium underline-offset-2 hover:underline">
            {acao}
          </Link>
        )}
      </div>
    );
  }

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
  podeCriarTarefa,
}: {
  djen: ResumoDashboard['djen'];
  /** A barra de integrações já explicou o silêncio — não repita. */
  calado?: boolean;
  /** Grava na agenda? Só então o atalho "Criar tarefa" aparece. */
  podeCriarTarefa?: boolean;
}) {
  if (!djen.ativa) return null;

  const desde = djen.ultimaEm ? idadeDoDado(new Date(djen.ultimaEm).getTime()) : null;
  const pessoal = djen.escopo === 'PESSOAL';

  if (djen.situacao === 'PRIMEIRA') {
    return (
      /* Estado e tranquilidade na MESMA frase: nada de expansor — ver AlertBar. */
      <AlertBar tom="info" href="/processos" acao="Ver processos">
        O DJEN está ligado e ainda não trouxe publicação — a varredura roda toda madrugada.
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
            O painel é RESUMO — seis atos dos últimos sete dias. O acervo
            inteiro, procurável por parte, advogado, OAB e teor, mora em
            /publicacoes.

            E O LINK LEVA A SEMANA QUE O NÚMERO CONTOU. Abria `/publicacoes`
            puro — as 2.066 do acervo, em 12/09/2026 — e os sete dias tinham de
            ser achados rolando. A tela conta cópias (uma por intimado) e o
            painel conta atos, então o total de lá pode ser um pouco maior; a
            semana é a mesma.
          */}
          <Link
            href="/publicacoes?dias=7"
            className="text-xs font-medium text-brand-800 hover:underline dark:text-brand-300"
          >
            {djen.publicacoes7d} em 7 dias · ver a semana
          </Link>
        </div>

        <ul className="divide-y">
          {djen.recentes.map((pub) => (
            <LinhaPublicacao
              key={pub.id}
              pub={pub}
              pessoal={pessoal}
              podeCriarTarefa={podeCriarTarefa}
            />
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

/**
 * O ESTADO DO ROBÔ DO DATAJUD.
 *
 * `resumido` é o painel de quem tem CARTEIRA PRÓPRIA (18/09/2026). Lá este
 * componente podia empilhar TRÊS elementos — a barra do robô, a lista de
 * processos que o CNJ recusou e a dos NPUs que ele não conhece — e, somado à
 * faixa do DJEN logo acima, dava quatro avisos seguidos sobre saúde de
 * integração no painel de quem não conserta integração nenhuma.
 *
 * Resumido, sobra UMA linha: o pior estado, com o número das listas dentro dela
 * em vez de duas listas abertas. O corte não esconde nada que peça atenção — o
 * aviso continua ali, e quem cuida disso (administração) segue vendo inteiro.
 */
function AvisoRobo({ robo, resumido }: { robo: ResumoDashboard['robo']; resumido?: boolean }) {
  // Nulo = quem não vê processo. Não é "tudo em dia": é "não é para você".
  if (!robo) return null;
  const {
    situacao, processosMonitorados, ultimaSincronizacao, falhasProcessos,
    horasAteAtraso, desconhecidosNoCnj,
  } = robo;
  const desde = ultimaSincronizacao
    ? idadeDoDado(new Date(ultimaSincronizacao).getTime())
    : null;

  const quantosPendem = falhasProcessos.length + (desconhecidosNoCnj?.length ?? 0);
  const falhasBar = !resumido && falhasProcessos.length > 0 && (
    <FalhasCNJ
      falhas={falhasProcessos}
      horasAteAtraso={horasAteAtraso}
      total={robo.falhas24h}
      atrasadosNoServidor={robo.atrasados24h}
    />
  );
  const desconhecidosBar = !resumido && !!desconhecidosNoCnj?.length && (
    <DesconhecidosNoCnj itens={desconhecidosNoCnj} />
  );

  /*
    NO PAINEL DE CARTEIRA, as duas listas viram uma linha discreta. Elas são
    conferência de cadastro e saúde de integração — trabalho de quem administra,
    não do advogado que abriu a tela para despachar prazo. E a linha diz o
    número para ninguém achar que sumiu.
  */
  if (resumido && (situacao === 'SEM_OBJETO' || situacao === 'EM_DIA')) {
    if (quantosPendem === 0) return null;
    return (
      <p className="px-1 text-xs text-muted-foreground">
        {quantosPendem === 1
          ? '1 processo com pendência de leitura no CNJ'
          : `${quantosPendem} processos com pendência de leitura no CNJ`}
        {' — '}
        <Link href="/processos" className="underline underline-offset-2 hover:text-foreground">
          conferir em Processos
        </Link>
      </p>
    );
  }

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
        A primeira varredura do DataJud ainda não rodou — ela acontece toda madrugada, e vai
        buscar{' '}
        {processosMonitorados === 1
          ? 'o processo cadastrado'
          : `os ${processosMonitorados} processos cadastrados`}
        .
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
  /*
    UM FORA DO PRAZO NÃO ACUSA OS OUTROS SEIS (25/09/2026).

    Antes o tom da faixa inteira saía de `itens.every(esperaAindaRazoavel)`:
    bastava um item velho para os recentes receberem "vale conferir se o número
    está digitado certo". Medido na produção: eram 7 itens, UM de 32 dias e
    quatro do TRT22 com 11 — e a tela mandava conferir os de onze dias também.
    Ver `separarDesconhecidos`.
  */
  const { passaramDoPrazo, aindaNoPrazo, ordenados } = separarDesconhecidos(itens);
  const nVelhos = passaramDoPrazo.length;
  const nNovos = aindaNoPrazo.length;

  return (
    <div className="rounded-xl border border-input bg-muted/40 text-sm text-muted-foreground">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition hover:brightness-[0.98]"
      >
        <span className="flex min-w-0 items-start gap-2.5">
          <Info className="mt-0.5 h-4 w-4 shrink-0 opacity-70" />
          {/*
            A CONSEQUÊNCIA, E NÃO A CONTAGEM.

            Eu tinha escrito "o robô já perguntou 252 vezes" no título — que é eu
            mostrando serviço. Ninguém decide nada com esse número; ele importa a
            quem for investigar, e por isso desceu para o detalhe. Em 25/09 ele
            saiu também do detalhe, porque lá ele estava mentindo: ver
            `ultimaTentativaDoCnj`.
          */}
          <span className="min-w-0">
            {nVelhos > 0 && (
              <>
                <strong className="text-foreground">
                  {nVelhos === 1 ? (
                    <>
                      1 processo não recebe andamentos há{' '}
                      {diasEsperando(passaramDoPrazo[0].desde)} dias
                    </>
                  ) : (
                    <>{nVelhos} processos não recebem andamentos há mais de um mês</>
                  )}
                </strong>
                : o CNJ não reconhece{' '}
                {nVelhos === 1 ? (
                  <span className="font-mono text-foreground">
                    {formatNPU(passaramDoPrazo[0].numeroCNJ)}
                  </span>
                ) : (
                  <>os números cadastrados</>
                )}
                . Já passou do tempo que o índice costuma levar — vale conferir se o
                número está digitado certo.
              </>
            )}
            {/*
              OS RECENTES NA MESMA FRASE, DEPOIS, E SEM ACUSAÇÃO. Um bloco só:
              destaque de subconjunto se faz com ordem e cor, nunca com uma
              segunda caixa repetindo o mesmo assunto.
            */}
            {nNovos > 0 && (
              <>
                {nVelhos > 0 && ' '}
                {nVelhos > 0 ? (
                  <>
                    Outros {nNovos === 1 ? 'aguardam' : nNovos + ' aguardam'} publicação há
                    poucos dias, o que é normal.
                  </>
                ) : nNovos === 1 ? (
                  <>
                    <strong className="text-foreground">
                      O CNJ ainda não publicou 1 processo
                    </strong>{' '}
                    —{' '}
                    <span className="font-mono text-foreground">
                      {formatNPU(aindaNoPrazo[0].numeroCNJ)}
                    </span>
                    , cadastrado há {diasEsperando(aindaNoPrazo[0].desde)} dias. O índice
                    público demora a receber processo recém-distribuído. O sistema
                    continua tentando todo dia — não é preciso fazer nada.
                  </>
                ) : (
                  <>
                    <strong className="text-foreground">
                      O CNJ ainda não publicou {nNovos} processos
                    </strong>{' '}
                    cadastrados recentemente. O índice público demora a receber processo
                    recém-distribuído. O sistema continua tentando todo dia — não é
                    preciso fazer nada.
                  </>
                )}
              </>
            )}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-0.5 pt-0.5 text-xs font-semibold opacity-80">
          {aberto ? 'Ocultar' : 'Ver quais'}
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', aberto && 'rotate-180')} />
        </span>
      </button>

      {aberto && (
        <ul className="border-t border-input">
          {ordenados.map((i) => {
            const passou = !esperaAindaRazoavel(i.desde);
            const conteudo = (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-xs font-semibold text-foreground">
                    {formatNPU(i.numeroCNJ)}
                  </span>
                  <span className="block truncate text-xs opacity-80">
                    {i.filiado ?? 'Sem filiado vinculado'}
                    {i.tribunal ? ` · ${i.tribunal}` : ''}
                  </span>
                </span>
                {/*
                  A IDADE E O RITMO, NO LUGAR DO TOTAL ACUMULADO.

                  "consultado 272× desde 24/08/2026" fazia o leitor ver o robô
                  batendo no CNJ centenas de vezes. Ele bate UMA por noite; 260
                  daquelas 272 são de antes de 12/09, de um defeito de ritmo já
                  corrigido, e o contador não sabe disso porque conta linha de
                  log. "Sem resposta há N dias" diz o problema; a última
                  tentativa diz que o sistema não desistiu.
                */}
                {/*
                  NO CELULAR AS DUAS COLUNAS NÃO CABEM. Lado a lado em 400px, o
                  tempo espremia o NPU até "0856490-91.2026.8.18.0…" — e o
                  número é a identidade da linha, a única coisa que alguém vai
                  copiar para conferir no tribunal. Empilha no telefone,
                  alinhado à esquerda; volta para a direita a partir de `sm`.
                */}
                <span className="shrink-0 text-xs leading-tight sm:text-right">
                  <span className={cn('block', passou && 'font-semibold text-foreground')}>
                    sem resposta há {diasEsperando(i.desde)} dias
                  </span>
                  <span className="block opacity-70">
                    última tentativa {ultimaTentativaDoCnj(i.ultima)}
                  </span>
                </span>
              </>
            );
            const classe = cn(
              'flex flex-col gap-1 border-t border-input/60 px-4 py-2.5 first:border-t-0 transition hover:bg-muted',
              'sm:flex-row sm:items-center sm:gap-3',
              /*
                COR SÓ EM QUEM PEDE ALGUÉM — e a barra da esquerda faz o
                trabalho que o fundo sozinho não fazia em tela clara: a 7% de
                âmbar a linha suspeita era indistinguível das outras seis.
              */
              passou
                ? 'border-l-2 border-l-amber-500 bg-amber-500/[0.06] dark:bg-amber-400/[0.08]'
                : 'border-l-2 border-l-transparent',
            );
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
  total,
  atrasadosNoServidor,
}: {
  falhas: FalhaDatajud[];
  horasAteAtraso?: number;
  /**
   * O número REAL de processos que falharam — a lista pode vir cortada. Sem
   * ele, "outros 24" era `25 - 1` calculado em cima do próprio corte, e mentia
   * quando havia 27 (foi o caso em 24/09/2026).
   */
  total?: number;
  /** Quantos estão atrasados de verdade, contados no servidor, sem corte. */
  atrasadosNoServidor?: number;
}) {
  const [aberto, setAberto] = useState(false);
  // Uma chave recusada ou um NPU que o CNJ não reconhece falham de novo
  // amanhã: separá-los evita prometer que "a próxima varredura resolve"
  // quando ela não resolve.
  const ehPersistente = (f: FalhaDatajud) => !motivoFalhaDatajud(f).passageiro;

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
  /*
    E EM 24/09/2026, O MESMO DEFEITO DO OUTRO LADO. A régua de 48h era aplicada
    também ao processo DORMENTE — encerrado, arquivado —, que o robô relê a cada
    sete dias, de propósito. Os três acusados naquela manhã tinham o ciclo
    31/08 → 08/09 → 16/09 → 24/09 em dia. Cobrar 48h de quem o robô visita a
    cada oito dias é uma acusação que nunca deixaria de aparecer.

    Hoje quem decide é o SERVIDOR (`falha-do-cnj.util`), com o ciclo de cada
    processo: dois ciclos sem leitura, sejam 48h ou 14 dias. A tela não
    recalcula — recalcular era a terceira cópia da mesma regra.
  */
  const atrasado = (f: FalhaDatajud) => {
    if (f.atrasada !== undefined) return f.atrasada;
    // API da janela de troca: cai na régua antiga, que é o comportamento de
    // antes. Sem `ultimoSucesso` não dá para afirmar que está em dia, e tratar
    // como atrasado é o lado seguro de errar.
    if (f.ultimoSucesso === undefined) return true;
    if (!f.ultimoSucesso) return true;
    return Date.now() - new Date(f.ultimoSucesso).getTime() > horasAteAtraso * 3_600_000;
  };
  /*
    OS NÚMEROS SÃO OS DO SERVIDOR, não os da lista. A lista vem cortada em 25;
    contar em cima dela foi o que produziu "1 processo" onde eram 3, e
    "outros 24" onde eram 24 de 27.
  */
  const pedemAtencao = falhas.filter(atrasado);
  const n = total ?? falhas.length;
  const atrasados = atrasadosNoServidor ?? pedemAtencao.length;
  const soTropeco = atrasados === 0;
  const naoCouberam = Math.max(0, atrasados - pedemAtencao.length);
  /*
    "NÃO É PROBLEMA PASSAGEIRO" SÓ VALE PARA QUEM ESTÁ ATRASADO. Antes contava
    o motivo de TODAS as falhas, inclusive as dos 24 que estão em dia — e aí a
    frase dizia "3 não são problemas passageiros" sobre processos que ninguém
    precisava olhar.
  */
  const persistentes = pedemAtencao.filter(ehPersistente).length;

  return (
    <div
      className={cn(
        'rounded-xl border text-sm',
        soTropeco
          ? 'border-input bg-muted/40 text-muted-foreground'
          : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200',
      )}
    >
      {/*
        SEM NADA PARA VER, NAO HA BOTAO. Quando so houve tropeco, a lista seria
        de processos que estao EM DIA — foi exatamente isso que encheu a tela
        com 25 linhas iguais em 24/09/2026, e o que a pessoa procurava ali era
        "qual e o que eu preciso olhar?". A frase ja responde tudo.
      */}
      <button
        type="button"
        onClick={() => !soTropeco && setAberto((v) => !v)}
        aria-expanded={soTropeco ? undefined : aberto}
        disabled={soTropeco}
        className={cn(
          'flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition',
          soTropeco ? 'cursor-default' : 'hover:brightness-[0.98]',
        )}
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
                <strong>Nenhum processo ficou para trás</strong> — todos estão dentro
                do prazo de releitura.
              </>
            ) : (
              /*
                "HÁ MAIS DE 48H" SAIU DA FRASE. Com duas faixas de varredura, o
                número seria diferente para cada linha — 48h para o processo
                vivo, 14 dias para o dormente. "Perdeu a vez duas vezes
                seguidas" é o que as duas têm em comum, e é o que a pessoa
                precisa saber: não é soluço, é padrão.
              */
              <>
                <strong>{atrasados}</strong>{' '}
                {atrasados === 1 ? 'processo perdeu' : 'processos perderam'} as duas
                últimas leituras do CNJ.{' '}
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
                    {' '}Outros <strong>{n - atrasados}</strong> tropeçaram nesta rodada mas
                    seguem em dia.
                  </>
                )}
              </>
            )}
          </span>
        </span>
        {!soTropeco && (
          <span className="flex shrink-0 items-center gap-0.5 text-xs font-semibold opacity-80">
            {aberto ? 'Ocultar' : `Ver ${pedemAtencao.length === 1 ? 'qual' : 'quais'}`}
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', aberto && 'rotate-180')} />
          </span>
        )}
      </button>

      {aberto && !soTropeco && (
        <ul className="border-t border-amber-300/70 dark:border-amber-900/50">
          {pedemAtencao.map((f) => {
            const motivo = motivoFalhaDatajud(f);
            const npu = formatNPU(f.numeroCNJ);
            const conteudo = (
              <>
                <span className="min-w-0 flex-1 basis-full sm:basis-1/2">
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
                {/*
                  NO CELULAR, O MOTIVO NÃO PODE COMER O NÚMERO (24/09/2026).

                  A pastilha era `shrink-0` e o texto dela — "nossa varredura
                  passou do limite de consultas do CNJ" — não quebra. A 400px
                  ela tomava a linha inteira e o NPU, que é QUEM o item é,
                  sumia: sobrava um motivo técnico sem dono.

                  Agora ela encolhe e corta antes do número. Quem precisa do
                  motivo inteiro tem o `title`; quem precisa saber de qual
                  processo se trata — que é todo mundo — lê o NPU sempre.
                */}
                <span className="flex w-full min-w-0 shrink items-center gap-2 text-xs sm:w-auto sm:shrink-0">
                  <span
                    className={cn(
                      'truncate rounded-full px-2 py-0.5 font-medium',
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
                  {f.processoId && <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-70" />}
                </span>
              </>
            );

            return (
              <li key={f.processoId ?? f.numeroCNJ} className="border-t border-amber-300/40 first:border-t-0 dark:border-amber-900/30">
                {/* Sem processoId o processo foi excluído depois da falha: o log
                    sobrevive, mas não há ficha para abrir. */}
                {/*
                  NO CELULAR A LINHA VIRA DUAS: número em cima, motivo embaixo.
                  Lado a lado a 400px, um dos dois some — e o que sumia era o
                  número, que é a identidade do item.
                */}
                {f.processoId ? (
                  <Link
                    href={`/processos?processo=${f.processoId}`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 transition hover:brightness-[0.97]"
                  >
                    {conteudo}
                  </Link>
                ) : (
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 opacity-70">
                    {conteudo}
                  </span>
                )}
              </li>
            );
          })}
          {/*
            O CORTE DIZ QUE CORTOU. Em 24/09/2026 o corte comeu 2 dos 3
            atrasados e ninguem soube: a tela dizia "1" e parecia completa.
            Lista truncada que se apresenta como inteira e pior que lista
            nenhuma — ver o cabecalho de falha-do-cnj.util na API.
          */}
          {naoCouberam > 0 && (
            <li className="border-t border-amber-300/40 px-4 py-2.5 text-xs opacity-80 dark:border-amber-900/30">
              e mais <strong>{naoCouberam}</strong>{' '}
              {naoCouberam === 1 ? 'processo' : 'processos'} na mesma situação — abra a
              lista de processos para ver todos.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * A EQUIPE DE HOJE — quem está no balcão agora, e quando alguém volta.
 *
 * TRÊS COISAS QUE O CARTÃO NÃO DIZIA, e as três saíram de olhar o dado real:
 *
 *  1. O ESTADO ESTAVA ESCRITO DUAS VEZES. Havia um ponto colorido à direita E
 *     uma etiqueta ("No horário") ao lado da hora. Quando concordam — que é o
 *     caso normal — a etiqueta é ruído. Agora a COR da hora carrega o estado, e
 *     a palavra só aparece quando ela não é óbvia: "encerrado" e "aguardando"
 *     precisam de explicação, "no horário" não.
 *
 *  2. O PRÓXIMO PLANTÃO NÃO DIZIA A QUE HORAS. A consulta já trazia
 *     `horaInicio`/`horaFim`; o objeto da API as descartava.
 *
 *  3. NEM A QUE DISTÂNCIA ESTAVA. Medido na produção em 10/09/2026: a escala
 *     pula o fim de semana, então o próximo plantão fica tipicamente a QUATRO
 *     dias. "Segunda-feira, 14/09" obriga a fazer a conta de cabeça para
 *     responder o que importa — quanto tempo ninguém está de plantão.
 *
 * A hora do plantão é TEXTO (`"09:00"`), não instante: comparar com o relógio
 * de Teresina é comparar duas strings, e por isso não passa por `Date`.
 */
function EquipeHoje({ data }: { data: ResumoDashboard }) {
  // Nulo sem acesso a escalas; o bloco só monta com plantão, mas o tipo não sabe.
  const { plantaoHoje, proximoPlantao } = data.equipeHoje ?? { plantaoHoje: [], proximoPlantao: null };

  /*
    A HORA DE TERESINA, não a do navegador.

    `toTimeString()` devolve a hora local de quem abre a tela. Coincide no
    Brasil, mas as horas da escala são de Teresina: quem abrisse de outro fuso
    veria "no horário" na hora errada.
  */
  const agoraHM = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(11, 16);

  /**
   * O ESTADO DO PLANTÃO, em cor e — só quando precisa — em palavra.
   *
   * `rotulo` é `null` para quem está no horário: a hora verde e o ponto verde
   * já dizem, e repetir em texto era a redundância que o cartão tinha.
   */
  const estadoPlantao = (ini: string, fim: string) =>
    agoraHM > fim
      ? { rotulo: 'encerrado', hora: 'text-muted-foreground', ponto: 'bg-muted-foreground/30' }
      : agoraHM >= ini
        ? { rotulo: null, hora: 'text-emerald-600 dark:text-emerald-400', ponto: 'bg-emerald-500' }
        : {
            rotulo: 'aguardando',
            hora: 'text-amber-600 dark:text-amber-400',
            ponto: 'bg-amber-400',
          };

  /*
    TRÊS BALDES, e o do meio existe porque plantão de dia inteiro existe: sem
    ele, 08:00–18:00 cairia em "manhã" e a tarde ficaria mentindo vazia. Na
    produção do SENATEPI quase toda escala é 09:00–12:00, então o cabeçalho de
    turno praticamente nunca aparece — e é essa a intenção.
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
    (a, b) =>
      ordemTurno[a[0] as keyof typeof ordemTurno] - ordemTurno[b[0] as keyof typeof ordemTurno],
  );
  const mostrarCabecalhoDeTurno = turnos.length > 1;

  /*
    QUANTO FALTA PARA O PRÓXIMO PLANTÃO — por dia de calendário, não por horas.

    Subtrair instantes daria "3,8 dias" e arredondaria errado na virada. A data
    é `@db.Date` (meia-noite UTC), então a conta é de dia contra dia — é a mesma
    régua de `diasDesdeDataPura`, com o sinal invertido.
  */
  const emQuantosDias = proximoPlantao ? -(diasDesdeDataPura(proximoPlantao.data) ?? 0) : 0;
  const distancia =
    emQuantosDias <= 1 ? 'amanhã' : emQuantosDias > 1 ? `em ${emQuantosDias} dias` : null;

  /*
    A API passou a mandar as horas em `pessoas`; `advogados` é a forma antiga,
    que ainda chega durante a janela de troca do deploy (web e API sobem em
    serviços separados). Sem horas, o cabeçalho simplesmente não as mostra.
  */
  const pessoasDoProximo =
    proximoPlantao?.pessoas ??
    (proximoPlantao?.advogados ?? []).map((a) => ({
      horaInicio: '',
      horaFim: '',
      advogado: a,
    }));

  /** Uma faixa só para o dia inteiro? Então ela vai no cabeçalho, não por linha. */
  const faixasDoProximo = [...new Set(pessoasDoProximo.map((p) => `${p.horaInicio}–${p.horaFim}`))];
  const faixaUnica =
    faixasDoProximo.length === 1 && faixasDoProximo[0] !== '–' ? faixasDoProximo[0] : null;

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
                  const st = estadoPlantao(p.horaInicio, p.horaFim);
                  return (
                    <li
                      key={p.id}
                      className="flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-muted/40"
                    >
                      <AvatarMini pessoa={p.advogado} size={40} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{primeiroNome(p.advogado)}</p>
                        <p
                          className={cn(
                            'mt-0.5 flex items-center gap-1.5 text-xs font-medium',
                            st.hora,
                          )}
                        >
                          <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          <span className="tabular-nums">
                            {p.horaInicio} – {p.horaFim}
                          </span>
                          {/* Só o que a cor não explica sozinha. */}
                          {st.rotulo && (
                            <span className="font-normal text-muted-foreground">· {st.rotulo}</span>
                          )}
                        </p>
                      </div>
                      <span
                        className={cn('h-2.5 w-2.5 shrink-0 rounded-full', st.ponto)}
                        aria-label={st.rotulo ?? 'no horário'}
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}

      {proximoPlantao && pessoasDoProximo.length > 0 && (
        <div className="mt-3 border-t pt-2.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 px-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {/*
                DATA PURA: `escalas_advogados.data` é `@db.Date` e chega como
                meia-noite UTC. `new Date(...).toLocaleDateString` num navegador
                UTC-3 puxava para 21h do dia anterior — a escala de SEGUNDA
                aparecia como DOMINGO.
              */}
              {formatDataPura(proximoPlantao.data, {
                weekday: 'long',
                day: '2-digit',
                month: '2-digit',
              })}
              {faixaUnica && (
                <span className="font-normal normal-case tracking-normal"> · {faixaUnica}</span>
              )}
            </p>
            {/*
              A DISTÂNCIA é o que a data sozinha não responde: são QUATRO dias
              sem ninguém de plantão, não um.
            */}
            {distancia && (
              <span className="shrink-0 text-[11px] text-muted-foreground/80">{distancia}</span>
            )}
          </div>
          <ul className="mt-1.5 space-y-0.5 px-2">
            {pessoasDoProximo.map(({ advogado, horaInicio, horaFim }) => (
              <li key={advogado.id} className="flex items-center gap-2 text-xs">
                <AvatarMini pessoa={advogado} size={24} />
                <span className="truncate">{primeiroNome(advogado)}</span>
                {/*
                  Horas por LINHA só quando as pessoas do dia divergem — senão a
                  faixa já está no cabeçalho e repetir é ruído.
                */}
                {!faixaUnica && horaInicio && (
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {horaInicio} – {horaFim}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}
function AudienciasSemana({ data, pessoal }: { data: ResumoDashboard; pessoal?: boolean }) {
  const itens = data.audienciasSemana;
  return (
    <SectionCard
      title="Audiências da semana"
      icon={Gavel}
      /*
        O SELO É O TOTAL DO "VER", não o tamanho da lista (13/09/2026): a lista
        vem cortada em 8 e sem a audiência que ficou para trás, e dava 2 ao lado
        de "Minhas audiências 4". Sem o total da API, sem número.
      */
      count={seloDasAudienciasDaSemana(data)}
      actionHref={linkDaAgenda({ aba: '7dias', tipo: 'AUDIENCIA', ...(pessoal ? { pessoa: 'eu' } : {}) })}
    >
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
 * SUA EQUIPE — as tarefas dos casos em que você é reserva.
 *
 * "QUANDO O ADVOGADO ENTRA DE RESERVA, ELE É AVISADO? AFINAL, É UMA EQUIPE." —
 * 12/09/2026. Não era, até a tarefa atrasar, e atrasar chegava tarde: das 8
 * tarefas abertas do robô, 5 tinham o responsável sem entrar havia uma semana ou
 * mais, e só 2 já tinham ficado para trás.
 *
 * UM BLOCO, DOIS TONS — a ordem é a da urgência, e o destaque é cor, nunca um
 * segundo bloco:
 *
 *  · ÂMBAR — ninguém está cuidando: o responsável sumiu, ou o dia virou. Cada
 *    linha diz de quem é e por quê; assumir é um toque dentro da atividade.
 *  · NEUTRO E RECOLHIDO — o que a equipe tem nos próximos sete dias, em dia e
 *    com o dono por perto. Não é cobrança: é saber, para cobrir quando precisar.
 *
 * Âmbar e não vermelho: o atraso é do colega, não de quem está lendo.
 */
function DaSuaEquipe({
  daEquipe,
}: {
  daEquipe: NonNullable<ResumoDashboard['alertas']['daEquipe']>;
}) {
  const [verAcompanhando, setVerAcompanhando] = useState(false);
  const { precisam, totalPrecisam, acompanhando, totalAcompanhando } = daEquipe;
  if (!totalPrecisam && !totalAcompanhando) return null;

  return (
    <section className="space-y-2">
      {totalPrecisam > 0 && (
        <div className="overflow-hidden rounded-xl border border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          <div className="px-4 pb-2 pt-3">
            <p className="flex items-center gap-2 text-sm">
              <Users className="h-4 w-4 shrink-0 opacity-80" />
              <strong>
                {totalPrecisam === 1
                  ? 'Uma atividade da sua equipe está sem ninguém cuidando'
                  : `${totalPrecisam} atividades da sua equipe estão sem ninguém cuidando`}
              </strong>
            </p>
            <p className="mt-0.5 pl-6 text-xs opacity-80">
              Você é reserva nesses casos. Abra, combine com quem responde e, se for o caso, assuma.
            </p>
          </div>
          <ul className="border-t border-amber-200 dark:border-amber-900/50">
            {precisam.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/agenda?compromisso=${t.id}`}
                  className="flex items-center gap-3 border-t border-amber-200/70 px-4 py-2.5 transition first:border-t-0 hover:bg-amber-100/70 dark:border-amber-900/40 dark:hover:bg-amber-950/50"
                >
                  <AvatarPessoa
                    nome={t.responsavel.nomeExibicao || t.responsavel.nome}
                    url={t.responsavel.avatarUrl}
                    tamanho="xs"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold">{t.titulo}</span>
                    <span className="block truncate text-xs opacity-80">
                      {t.detalhe} · para {formatDataHora(t.inicio)}
                    </span>
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" />
                </Link>
              </li>
            ))}
            {/*
              O TETO É DE DEZ; dizer quantas ficaram fora impede a lista de parecer
              o todo. O número NÃO é link: nenhuma aba da agenda recorta "sem
              ninguém cuidando". O caminho oferecido é o recorte que existe — as
              atividades em que você é reserva —, dito com o nome dele.
            */}
            {totalPrecisam > precisam.length && (
              <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-amber-200/70 px-4 py-2 text-xs dark:border-amber-900/40">
                <span>e mais {totalPrecisam - precisam.length} que não cabem aqui</span>
                <Link
                  href={linkDaAgenda({ aba: 'aberto', reservaDe: 'eu' })}
                  className="inline-flex min-h-11 items-center gap-1 font-medium underline-offset-2 hover:underline sm:min-h-8"
                >
                  Ver as atividades em que você é reserva
                  <ChevronRight className="h-3.5 w-3.5 opacity-60" />
                </Link>
              </li>
            )}
          </ul>
        </div>
      )}

      {totalAcompanhando > 0 && (
        <div className="overflow-hidden rounded-xl border bg-card text-sm">
          <button
            type="button"
            onClick={() => setVerAcompanhando((v) => !v)}
            aria-expanded={verAcompanhando}
            className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition hover:bg-muted/50"
          >
            <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
              <Users className="h-4 w-4 shrink-0" />
              <span className="truncate">
                <span className="font-medium text-foreground">Acompanhando</span>
                {' — '}
                {totalAcompanhando === 1
                  ? '1 atividade da equipe nos próximos 7 dias'
                  : `${totalAcompanhando} atividades da equipe nos próximos 7 dias`}
              </span>
            </span>
            <ChevronDown
              className={cn(
                'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                verAcompanhando && 'rotate-180',
              )}
            />
          </button>
          {verAcompanhando && (
            <ul className="divide-y border-t">
              {acompanhando.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/agenda?compromisso=${t.id}`}
                    className="flex items-center gap-3 px-4 py-2 transition hover:bg-muted/50"
                  >
                    <AvatarPessoa
                      nome={t.responsavel.nomeExibicao || t.responsavel.nome}
                      url={t.responsavel.avatarUrl}
                      tamanho="xs"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{t.titulo}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        de {primeiroENome(t.responsavel)} · {formatDataHora(t.inicio)}
                      </span>
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              ))}
              {totalAcompanhando > acompanhando.length && (
                <li className="px-4 py-2 text-xs text-muted-foreground">
                  e mais {totalAcompanhando - acompanhando.length} na agenda
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * CARGA DA EQUIPE — só para quem gere (Coordenação/Administrador).
 *
 * O painel respondia "quantas atividades estão atrasadas na casa?", mas não
 * "de quem?". Sem esse recorte, a gestão via o número e não sabia onde agir.
 *
 * SEM RANKING (13/09/2026): era ordenada por atrasadas, com barra proporcional
 * ao maior da equipe e o atraso em rosa — um pódio ao contrário. Agora é ordem
 * alfabética, sem barra, com o atraso em âmbar. A conta é a régua `daPessoa`
 * (responde ou foi posta ali por gente; a reserva do robô fica fora), e o
 * clique abre a agenda da pessoa na MESMA régua.
 *
 * DUAS COISAS ENTRARAM EM 12/09/2026, e nenhuma é aviso novo:
 *
 *  · A LINHA ABRE A AGENDA DA PESSOA. Quem coordena não cumpre o prazo de
 *    ninguém: cobra ou redistribui, e para isso precisa da lista dela aberta.
 *
 *  · O ÚLTIMO ACESSO, quando passa de uma semana. O sino e a faixa só alcançam
 *    quem abre o sistema — das três atrasadas da casa, duas eram de alguém que
 *    não entrava havia 39 dias. Âmbar quando há atraso junto, que é a soma que
 *    pede uma ligação; cinza quando não há.
 */
function CargaEquipe({ data }: { data: ResumoDashboard }) {
  const nomeDe = (a: { nome: string; nomeExibicao?: string | null }) => a.nomeExibicao || a.nome;
  const itens = [...(data.cargaEquipe ?? [])].sort((a, b) =>
    nomeDe(a.advogado).localeCompare(nomeDe(b.advogado), 'pt-BR'),
  );

  return (
    <SectionCard title="Carga da equipe" icon={Users} count={itens.length} actionHref="/agenda" actionLabel="Agenda">
      {itens.length === 0 ? (
        <EmptyState icon={CheckCircle2}>Nenhuma atividade em aberto na equipe.</EmptyState>
      ) : (
        <ul className="space-y-1">
          {itens.map(({ advogado, abertas, atrasadas, ultimoAcesso }) => {
            const ausencia = diasSemAcesso(ultimoAcesso);
            return (
              <li key={advogado.id}>
                <Link
                  href={linkDaAgenda({ aba: 'aberto', pessoa: advogado.id })}
                  className="-mx-2 flex min-h-11 items-center gap-3 rounded-lg px-2 py-1.5 transition hover:bg-muted/60"
                >
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
                          <span className="ml-1.5 font-semibold text-amber-700 dark:text-amber-400">
                            · {atrasadas} atrasada{atrasadas === 1 ? '' : 's'}
                          </span>
                        )}
                      </span>
                    </p>
                    {ausencia !== null && (
                      <p
                        className={cn(
                          'mt-1 text-[11px] leading-snug',
                          atrasadas > 0
                            ? 'font-medium text-amber-700 dark:text-amber-400'
                            : 'text-muted-foreground',
                        )}
                      >
                        {ausencia === 'NUNCA'
                          ? 'Ainda não entrou no sistema'
                          : `Último acesso há ${ausencia} dias`}
                      </p>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
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
  /*
    O CABEÇALHO CONTA A FILA INTEIRA; a lista mostra até 12. Com a API de antes
    (sem o total), o total é o que chegou — e não se afirma corte nenhum.
  */
  const total = Math.max(itens.length, data.cadastrosACompletarTotal ?? itens.length);
  const cortou = total > itens.length;

  return (
    <SectionCard title="Cadastros a completar" icon={UserCog} count={total}>
      <ul className="divide-y divide-border/60">
        {itens.map((f) => {
          /*
            O ESTADO DO LINK, NÃO O EVENTO: "link ativo até 15h20" ou "respondeu
            pelo link em 12/09". Nunca "enviado" — o sistema não sabe se chegou.
          */
          const link = textoDoLinkDeRecadastro(f);
          return (
            <li key={f.id} className="flex items-center gap-3 px-2 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{f.nome}</p>
                <p className="truncate text-xs text-muted-foreground">
                  Falta {f.falta.join(', ')}
                  {f.motivo === 'ATENDIMENTO' ? ' · atendido há pouco' : ' · tem processo'}
                </p>
                {link && <p className="truncate text-xs font-medium text-foreground/80">{link}</p>}
              </div>
              <button
                type="button"
                onClick={() => onCompletar(f.id)}
                className="flex h-11 shrink-0 items-center rounded-lg border px-3 text-xs font-medium transition hover:bg-muted sm:h-8"
              >
                Completar
              </button>
            </li>
          );
        })}
      </ul>
      <p className="border-t px-2 pt-2 text-[11px] leading-snug text-muted-foreground">
        {cortou && `Aparecem ${itens.length} de ${total}, em ordem alfabética. `}
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
  /*
    O SICONFI FALTAVA AQUI, e o texto reserva vazava para a tela (24/09/2026):
    "O sistema não recebe OS DADOS DESSA FONTE desde terça-feira, 22/09" — uma
    frase que não diz o que ficou faltando e que ninguém sabe se é grave.

    Na produção o robô do Tesouro rodou hoje e a faixa não apareceu; bastava um
    dia ruim. Fonte nova sem entrada neste mapa continua caindo no reserva — é
    a rede, não o normal.
  */
  SICONFI: {
    nome: 'Tesouro Nacional',
    oQue: 'as contas públicas dos municípios',
    incompleto: 'Algumas contas públicas podem estar desatualizadas.',
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
      /*
        A BUSCA PODE TERMINAR SEM TER BUSCADO NADA — ver `resultadoDaVarredura`.

        "Aqui deu 'busca concluída e nada novo no diário' mas a barra amarela
        persiste. Realmente a busca foi um sucesso?" Não era: o log da produção
        naquele minuto dizia "Varredura sem resposta: as 165 consulta(s)
        falharam". A tela olhava só `ingeridas === 0` e usava a MESMA frase para
        "o Diário não tinha nada" e para "o Diário não respondeu nada".
      */
      const { tom, texto } = resultadoDaVarredura(r);
      if (tom === 'erro') toast.error(texto);
      else if (tom === 'aviso') toast.warning(texto);
      else toast.success(texto);
      qc.invalidateQueries({ queryKey: ['dashboard-resumo'] });
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message ?? 'Não foi possível buscar no Diário agora.'),
  });

  /*
    DUAS FAIXAS PARA O MESMO FATO — e elas se CONTRADIZIAM (24/09/2026).

    Na mesma dobra do painel liam-se, uma embaixo da outra:

      "Alguns andamentos podem não ter chegado. O DataJud recusou 27 das 170
       leituras registradas hoje."
      "O CNJ não respondeu a 27 consultas na última varredura. Nenhum processo
       ficou para trás."

    O mesmo evento, contado duas vezes, com conclusões opostas. E a segunda é
    a que serve: ela sabe QUAIS processos ficaram para trás — que é a pergunta
    de quem lê. A primeira mede a proporção de tentativas que não voltaram, o
    que é telemetria da rodada.

    Então, quando a faixa dos processos vai falar, esta se cala sobre o DataJud
    instável. Quem não vê processos (`robo` nulo) continua recebendo o aviso da
    fonte, que aí é a única voz. Mesma régua de
    `faixa-cala-o-que-a-tela-diz`.
  */
  const aFaixaDosProcessosVaiFalar = (data.robo?.falhasProcessos?.length ?? 0) > 0;

  const problemas = (data.integracoes ?? []).filter(
    (i) =>
      (i.situacao === 'PARADA' || i.situacao === 'INSTAVEL' || i.situacao === 'NAO_RODOU') &&
      !(i.fonte === 'DATAJUD' && i.situacao === 'INSTAVEL' && aFaixaDosProcessosVaiFalar),
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
                {/*
                  "LEITURAS REGISTRADAS", E NÃO "CONSULTAS" (21/09/2026).

                  `falhas24`/`ok24` são `count(*)` de LINHAS DO LOG, e cada
                  rodada escreve várias: o resumo e uma por processo. A faixa
                  dizia "recusou 4 de 4 consultas hoje" numa noite em que o log
                  interno registrava "as 165 consulta(s) falharam" — o número
                  certo estava dentro da mensagem, e o da tela era outra coisa
                  com o mesmo nome. Contar linha e chamar de consulta é o mesmo
                  defeito que fazia o alarme contradizer o robô.

                  O número em si serve — ele mede a proporção de tentativas que
                  não voltaram. O que estava errado era o substantivo.
                */}
                <strong className="font-semibold">{fonte.incompleto}</strong> O{' '}
                {fonte.nome} recusou {i.falhas24} das {i.ok24 + i.falhas24}{' '}
                leituras registradas hoje.
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
  const qc = useQueryClient();
  const estado = estadoDosAniversarios(itens);
  const [salvando, setSalvando] = useState<string | null>(null);
  /*
    ABRIR O WHATSAPP NÃO É TER CUMPRIMENTADO — 18/09/2026.

    O clique gravava PARABENIZADO na hora, assumindo que abrir a conversa é
    falar com a pessoa. Não é: o número pode estar errado, a conversa pode não
    ser enviada, a pessoa pode desistir no meio. O dono pediu o contrário —
    "clicou e perguntar: você parabenizou a filiada? Se clicar sim ele é
    dispensado" —, e ele está certo: quem sabe se o parabéns saiu é quem
    escreveu, não o navegador.
  */
  const [perguntando, setPerguntando] = useState<{ id: string; tipo: 'FILIADO' | 'COLABORADOR'; nome: string } | null>(null);

  /*
    A DECISÃO É UM FATO, e por isso ela é gravada dos dois lados. "Deixar
    passar" sem registro seria um botão de fechar, e a casa não tem botão de
    fechar. O registro também impede o que acontecia antes: duas pessoas da
    secretaria cumprimentando a mesma filiada enquanto ninguém fala com a outra.
  */
  async function decidir(
    p: { id: string; tipo: 'FILIADO' | 'COLABORADOR'; nome: string },
    desfecho: 'PARABENIZADO' | 'DEIXOU_PASSAR',
  ) {
    setSalvando(p.id);
    try {
      await registrarAniversario({ pessoaId: p.id, tipo: p.tipo, desfecho });
      qc.invalidateQueries({ queryKey: ['dashboard-resumo'] });
      toast.success(
        desfecho === 'PARABENIZADO'
          ? `${soOPrimeiroNome(p.nome)} foi cumprimentada(o).`
          : `${soOPrimeiroNome(p.nome)} ficou para depois.`,
      );
    } catch {
      toast.error('Não deu para registrar. Tente de novo.');
    } finally {
      setSalvando(null);
    }
  }

  if (itens.length === 0) return null; // dia sem aniversário não vira card vazio

  /*
    DIA CUIDADO VIRA UMA LINHA (18/09/2026). O cartão não some: a casa ter
    cumprimentado três pessoas hoje é boa notícia, e boa notícia vira linha —
    nunca desaparecimento, que a pessoa leria como "não havia ninguém".
  */
  if (estado.fechado) {
    return (
      <p className="flex flex-wrap items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2 text-xs text-brand-900 dark:border-brand-900 dark:bg-brand-950/20 dark:text-brand-200">
        <Cake className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Aniversários de hoje: {resumoDosAniversarios(estado)}.
      </p>
    );
  }

  return (
    <SectionCard title="Aniversariantes de hoje" icon={Cake} count={estado.pendentes}>
      <ul className="divide-y divide-border/60">
        {/*
          QUEM JÁ FOI CUIDADO SAI DA LISTA, mas não do dia: o resumo verde no
          rodapé conta os dois desfechos. Manter a pessoa cumprimentada na lista
          faria o cartão nunca encolher, e um cartão que não encolhe deixa de
          ser lido.
        */}
        {itens.filter((p) => !p.decisao).map((p) => {
          /*
            SÓ CELULAR ABRE CONVERSA. A montagem antiga punha "55" na frente de
            qualquer coisa: número com DDI virava 5555…, fixo abria conversa com
            quem não tem WhatsApp. A regra é a única do sistema (lib/whatsapp).
          */
          const celular = celularParaWhatsApp(p.telefone);
          const zap = celular ? linkWhatsApp(celular, mensagemDeAniversario(p.nome, tenant.sigla)) : null;
          const ocupado = salvando === p.id;
          return (
            <li key={`${p.tipo}-${p.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-2 py-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-pink-100 dark:bg-pink-950/40">
                <Cake className="h-4 w-4 text-pink-700 dark:text-pink-300" />
              </span>
              {/*
                O NOME NÃO CEDE PRIMEIRO. Em 400px, com o botão verde na mesma
                linha, "JOANA DE CONFERÊNCIA" virava "JOA…" e a idade "41 an…":
                o `flex-1` deixava o nome encolher até nada enquanto o botão
                ficava inteiro. A pessoa é o assunto do cartão.
              */}
              <div className="min-w-0 flex-1 basis-[calc(100%-3rem)]">
                <p className="truncate text-sm font-medium">{p.nome}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {p.idade > 0 && `${p.idade} anos · `}
                  {p.tipo === 'FILIADO' ? 'Filiado(a)' : 'Equipe'}
                </p>
              </div>
              {/* No telefone os botões descem para a própria linha, recuados
                  sob o nome; no desktop voltam para a direita da pessoa. */}
              <div className="ml-11 flex w-full shrink-0 items-center gap-1.5 sm:ml-0 sm:w-auto">
                {zap && (
                  /*
                    ABRIR A CONVERSA JÁ É O CUMPRIMENTO. O clique leva ao
                    WhatsApp e grava o fato no mesmo gesto — pedir depois "e aí,
                    você falou com ela?" é a cerimônia que faz gente parar de
                    usar a ferramenta.
                  */
                  <a
                    href={zap}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setPerguntando({ id: p.id, tipo: p.tipo, nome: p.nome })}
                    className="flex h-11 shrink-0 items-center rounded-lg bg-[#25D366] px-3 text-xs font-medium text-white transition hover:bg-[#20bd5a] sm:h-9"
                  >
                    Parabenizar
                  </a>
                )}
                {!zap && podeCompletar && p.tipo === 'FILIADO' && (
                  /*
                    SEM TELEFONE ERA BECO SEM SAÍDA — e é o caso mais comum.
                    Medido em 04/09/2026: 7.137 dos 7.291 filiados não têm
                    telefone. O aniversário é o melhor momento para completar a
                    ficha, porque há um motivo para ligar.
                  */
                  <button
                    type="button"
                    onClick={() => onCompletar?.(p.id)}
                    className="flex h-11 shrink-0 items-center rounded-lg border px-3 text-xs font-medium transition hover:bg-muted sm:h-9"
                  >
                    Completar cadastro
                  </button>
                )}
                {!zap && !(podeCompletar && p.tipo === 'FILIADO') && (
                  <span className="text-[11px] text-muted-foreground">sem celular</span>
                )}
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() => decidir(p, 'DEIXOU_PASSAR')}
                  title={`Tirar ${soOPrimeiroNome(p.nome)} da lista de hoje, registrando que ninguém cumprimentou`}
                  className="flex h-11 shrink-0 items-center rounded-lg px-2.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50 sm:h-9"
                >
                  {ocupado ? '…' : 'Deixar passar'}
                </button>
              </div>
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
        {(estado.parabenizados > 0 || estado.deixouPassar > 0) &&
          ` Hoje: ${resumoDosAniversarios(estado)}.`}
      </p>

      {/*
        A PERGUNTA DEPOIS DO WHATSAPP. Enter confirma porque tem volta: se a
        pessoa errar, basta abrir a conversa de novo e responder outra vez — o
        registro é por (pessoa, dia) e se sobrescreve. "Ainda não" fecha sem
        gravar nada, e a pessoa continua na lista.
      */}
      <ConfirmDialog
        open={!!perguntando}
        title={perguntando ? `Você parabenizou ${soOPrimeiroNome(perguntando.nome)}?` : ''}
        confirmLabel="Sim, parabenizei"
        /*
          OS DOIS BOTÕES APARECEM, e por isso este diálogo NÃO usa
          `confirmarComEnter`: com o Enter ligado o cancelar some, e aqui
          "Ainda não" não é desistir — é a outra resposta da pergunta. Esconder
          uma das duas respostas atrás de um X é transformar pergunta em
          confirmação.
        */
        cancelLabel="Ainda não"
        loading={salvando === perguntando?.id}
        icon={<Cake className="h-6 w-6" />}
        onConfirm={async () => {
          if (perguntando) await decidir(perguntando, 'PARABENIZADO');
          setPerguntando(null);
        }}
        onClose={() => setPerguntando(null)}
        description={
          <p className="text-sm text-muted-foreground">
            Respondendo que sim, {perguntando ? soOPrimeiroNome(perguntando.nome) : 'a pessoa'} sai
            da lista de hoje e fica registrado que a casa cumprimentou.
          </p>
        }
      />
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
  /*
    A FILA DA TRIAGEM (15/09/2026). A lista é do que pede a triagem; o que
    espera a consulta vira uma linha neutra com link, porque o mesmo atraso já
    aparece na agenda de quem atende.
  */
  const cartao = cartaoDosAtendimentos(data);
  const itens = cartao.itens;
  const tm = data.tempoMedioTriagem;
  return (
    <SectionCard title={cartao.titulo} icon={Inbox} count={cartao.contagem} actionHref={cartao.href} actionLabel="Triagem">
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
        <EmptyState icon={CheckCircle2}>{cartao.vazio}</EmptyState>
      ) : (
        <ul className="divide-y divide-border/60">
          {itens.map((a) => (
            <li key={a.id}>
              <Link href={`/atendimentos?atendimento=${a.id}`} className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition hover:bg-muted/60">
                <span className={cn('w-1 shrink-0 self-stretch rounded-full', barraDoAtendimento(a))} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    <span className="text-muted-foreground">#{a.numero}</span> {a.filiado.nomeCompleto}
                  </p>
                  <p className="text-xs text-muted-foreground">{CANAL_LABEL[a.canal]} · aberto {tempoRelativo(a.createdAt)}</p>
                  {/*
                    EM QUE PÉ ESTÁ A CONSULTA — o estado vem pronto da API e o chip
                    é o mesmo da tela de atendimentos: âmbar só no que pede a
                    triagem, verde no atendido. "Pendente" genérico não dizia se
                    alguém já tinha marcado a consulta.
                  */}
                  {a.encaminhamento && (
                    <ChipEncaminhamento
                      encaminhamento={a.encaminhamento}
                      statusAtendimento="PENDENTE"
                      fila={a.fila}
                      className="mt-1"
                    />
                  )}
                </div>
                {/* "Pendente" só para quem ainda não tem desfecho: o resto já diz em que pé está. */}
                {!a.desfecho && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                    Pendente
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {cartao.aguardandoConsulta > 0 && (
        <Link
          href={cartao.hrefAguardando}
          className="mt-1 flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground transition hover:bg-muted/60 hover:text-foreground"
        >
          e mais {cartao.aguardandoConsulta} aguardando a consulta <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
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
/**
 * OS ADVERSÁRIOS QUE MAIS APARECEM — da casa, ou da carteira de quem olha.
 *
 * O CONTEÚDO SEMPRE FOI RECORTADO PELO ESCOPO (a API filtra pelo acervo do
 * advogado em `meuAcervo`); o que mentia era o título, que dizia "litigamos"
 * para uma lista que é de UMA pessoa. Cheguei a remover o bloco do painel dele
 * por causa disso — errado: o conserto é o rótulo, não a ausência.
 */
function AdversariosRecorrentes({ data, pessoal }: { data: ResumoDashboard; pessoal: boolean }) {
  // `?? []` não é paranoia: web e API são serviços separados no Railway e
  // sobem em minutos diferentes. Num rollback da API, o campo some e o
  // acesso direto derrubaria a home inteira — não só este bloco.
  const itens = data.adversarios ?? [];
  if (!itens.length) return null;
  const maior = itens[0].processos;

  return (
    <SectionCard
      title={pessoal ? 'Contra quem você mais litiga' : 'Contra quem litigamos'}
      icon={Swords}
      count={itens.length}
      actionHref="/panorama"
      actionLabel="Panorama"
    >
      <ul className="space-y-1">
        {itens.map((a) => (
          <li key={a.id}>
            <Link
              /* O número conta processos ATIVOS: a lista abre no mesmo recorte. */
              href={`/processos?parteExternaId=${a.id}&status=ATIVO`}
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

/**
 * O TÍTULO DIZ DE ONDE VEM, E NÃO CHAMA DE RECENTE O QUE NÃO É (18/09/2026).
 *
 * Era "Movimentações recentes (DataJud · 7 dias)". "Recente" é falso: a base
 * pública do CNJ entrega com mediana de 62 dias de atraso neste acervo. Quem lê
 * "recentes" e não encontra o ato de ontem conclui que o sistema perdeu alguma
 * coisa — quando o que aconteceu é que o tribunal ainda não publicou.
 *
 * A lista é do acervo de quem olha: a consulta ganhou `meuAcervo` no mesmo dia,
 * e antes disso o advogado lia oito andamentos de processos dos colegas.
 */
function MovimentacoesRecentes({ data }: { data: ResumoDashboard }) {
  const itens = data.movimentacoesRecentes;
  return (
    <SectionCard title="Últimos andamentos que o CNJ publicou" icon={Landmark} count={itens.length} actionHref="/processos">
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
  /** 600 ms em vez dos 1.500 do recharts, e nada com "reduzir movimento". */
  const animacao = useAnimacaoDeGrafico();

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
    <Card className="h-full animate-surgir">
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
                    strokeWidth={2} fill="url(#grad-marca)" {...animacao} />
                )}
                {series.saidas && (
                  <Area type="monotone" dataKey="saidas" name="Saídas" stroke={COR_SAIDA}
                    strokeWidth={2} fill="url(#grad-saida)" {...animacao} />
                )}
                {series.saldo && (
                  <Area type="monotone" dataKey="saldo" name="Saldo" stroke={COR_SALDO}
                    strokeWidth={2} strokeDasharray="4 3" fill="none" {...animacao} />
                )}
              </>
            ) : (
              <Area type="monotone" dataKey="total" name="Total" stroke={corMarca} strokeWidth={2} fill="url(#grad-marca)" {...animacao} />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

/**
 * ATENDIMENTOS POR CANAL — "5 o quê?", perguntou o dono (18/09/2026).
 *
 * Ele estava lendo o markup certo: a legenda era bolinha + nome + número cru, e
 * a única palavra que dava unidade ("Atendimentos") estava no título do cartão,
 * a 200px e três níveis de DOM de distância. O número agora vem com a
 * participação ao lado, o centro da rosca diz a unidade por extenso, e cada
 * linha carrega a frase inteira para o `title` e para o leitor de tela.
 *
 * E O PERÍODO PASSOU A ESTAR ESCRITO. Este gráfico é de TODO o histórico e fica
 * lado a lado com o de volume, que é de 14 dias — quem lê supõe que os dois
 * falam do mesmo tempo. Mantive todo o histórico (em 14 dias a produção tem 10
 * atendimentos, e uma rosca com n=10 é ruído) e escrevi o período no cabeçalho.
 *
 * Ver `fatiasDosCanais` para a cor por ENTIDADE e o destino de cada fatia.
 */
function GraficoCanais({ data }: { data: ResumoDashboard }) {
  const fatias = fatiasDosCanais(
    data.graficos.atendimentosPorCanal,
    CANAL_LABEL,
    CANAIS,
    [...PALETA_CATEGORICA],
  );
  const total = fatias.reduce((s, d) => s + d.total, 0);
  const animacao = useAnimacaoDeGrafico();

  return (
    <Card className="h-full animate-surgir" style={{ animationDelay: atrasoEscalonado(1) }}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b px-5 py-3.5">
        <Inbox className="h-4 w-4 shrink-0 text-brand-800 dark:text-brand-400" />
        <h3 className="text-sm font-semibold">Atendimentos por canal</h3>
        <span className="ml-auto text-[11px] text-muted-foreground">todo o histórico</span>
      </div>
      <CardContent className="p-4">
        {total === 0 ? (
          <EmptyState icon={Inbox}>Sem atendimentos registrados.</EmptyState>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="relative h-40 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={fatias} dataKey="total" nameKey="nome" cx="50%" cy="50%" innerRadius={45} outerRadius={68} paddingAngle={2} strokeWidth={0} {...animacao}>
                    {fatias.map((d) => (
                      <Cell key={d.canal} fill={d.cor} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v: number) => [`${v} ${v === 1 ? 'atendimento' : 'atendimentos'}`, '']}
                    contentStyle={{ borderRadius: 12, border: '1px solid hsl(var(--border))', fontSize: 12 }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold leading-none tabular-nums">{total}</span>
                <span className="text-[11px] text-muted-foreground">
                  {total === 1 ? 'atendimento' : 'atendimentos'}
                </span>
              </div>
            </div>
            {/*
              A LEGENDA VIROU O CAMINHO. `/atendimentos?canal=X` já existia e
              ninguém chegava lá: o cartão era um beco sem saída. Uma coluna no
              telefone — duas colunas de 170px cortavam "Presencial" e o número.
            */}
            <ul className="grid w-full grid-cols-1 gap-y-0.5 sm:grid-cols-2 sm:gap-x-3">
              {fatias.map((d) => (
                <li key={d.canal}>
                  <Link
                    href={d.href}
                    title={d.descricao}
                    aria-label={d.descricao}
                    className="flex min-h-[32px] items-center gap-1.5 rounded-md px-1 text-xs transition hover:bg-muted"
                  >
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: d.cor }} />
                    <span className="truncate text-muted-foreground">{d.nome}</span>
                    <span className="ml-auto shrink-0 font-semibold tabular-nums">{d.total}</span>
                    <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">
                      {d.fatia}%
                    </span>
                  </Link>
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

/**
 * O ESQUELETO TEM A FORMA DO QUE O PERFIL VAI VER.
 *
 * Eram quatro cartões e dois gráficos para todo mundo — o advogado via o
 * esboço de dois gráficos que nunca chegam, e a tela pulava quando a lista de
 * atividades aparecia no lugar deles. A forma segue os mesmos `pode.*` e a mesma
 * régua de gestão do conteúdo.
 */
function SkeletonHome({
  pode,
  role,
}: {
  pode: { processos: boolean; atendimentos: boolean; agenda: boolean; filiados: boolean };
  role: PerfilUsuario;
}) {
  const cartoes = [pode.processos, pode.atendimentos, pode.agenda, pode.filiados].filter(Boolean).length;
  const gestao = role === 'ADMINISTRADOR' || role === 'COORDENACAO';
  return (
    <Carregando texto="Carregando o painel" className="space-y-4">
      {pode.agenda && (
        <div className="overflow-hidden rounded-xl border bg-card" aria-hidden="true">
          <div className="border-b bg-muted/30 px-3 py-2.5">
            <Esqueleto className="h-4 w-32" />
          </div>
          <EsqueletoLinhas quantidade={3} altura={60} />
        </div>
      )}
      {cartoes > 0 && <EsqueletoCartoes quantidade={cartoes} />}
      {gestao && (
        <div className={cn('grid grid-cols-1 gap-4', pode.atendimentos && 'lg:grid-cols-3')}>
          <EsqueletoGrafico className={cn(pode.atendimentos && 'lg:col-span-2')} />
          {pode.atendimentos && <EsqueletoGrafico />}
        </div>
      )}
    </Carregando>
  );
}

/**
 * UMA LINHA DA LISTA DE PUBLICACOES -- que agora ABRE no lugar.
 *
 * O relato foi direto: "clico e abre o processo, normal, mas nao me mostrando o
 * teor". E era isso mesmo: a linha mandava a pessoa para outra tela e deixava o
 * ato -- o que o juiz escreveu, a unica coisa capaz de responder "isto e
 * urgente?" -- a mais dois cliques de distancia.
 *
 * Ler o teor nao e navegar para lugar nenhum: e abrir a gaveta onde ja se esta.
 * O texto vem sob demanda e so na primeira vez que a linha abre -- sao 1.498
 * publicacoes no acervo, e carregar o teor de todas para mostrar seis seria
 * pagar caro por nada.
 *
 * E A ACAO VEM JUNTO DO TEXTO, que e onde a decisao acontece. "Sem tarefa" era
 * um diagnostico sem remedio: virar tarefa exigia abrir o processo, ir na
 * agenda e digitar tudo de novo. Quatro telas para uma decisao de um segundo --
 * que e exatamente como uma intimacao vira prazo perdido.
 */
/**
 * Ação secundária em forma de link. O `Button` da casa não aceita `asChild`, e
 * um `<button onClick={router.push}>` perderia o "abrir em nova aba" com o
 * botão do meio — que é justamente o que se faz com "abrir o processo".
 * 44px no telefone, 36px a partir do tablet.
 */
const ACAO_SECUNDARIA =
  'inline-flex min-h-11 items-center gap-1.5 rounded-lg border bg-card px-3 text-xs font-medium transition hover:bg-muted sm:min-h-9';

function LinhaPublicacao({
  pub,
  pessoal,
  podeCriarTarefa,
}: {
  pub: ResumoDashboard['djen']['recentes'][number];
  pessoal: boolean;
  podeCriarTarefa?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  /**
   * A PRÉVIA VEM ANTES DA CRIAÇÃO — e não é firula.
   *
   * "Ao clicar em Criar tarefa vai direto para criar tarefa mas não tenho nem um
   * preview de como ela vai ficar." Data, urgência e dono são decididos pelo
   * sistema a partir da providência e da idade do ato; criar às cegas é pedir
   * confiança agora e conferência depois. Mostrar antes é mais barato do que
   * desfazer — e desfazer, aqui, significa cancelar uma tarefa que já apareceu
   * na agenda de outra pessoa.
   */
  const [vendoPrevia, setVendoPrevia] = useState(false);
  const qc = useQueryClient();

  const {
    data: teor, isLoading: carregandoTeor, isError: erroNoTeor, refetch: buscarTeorDeNovo, isFetching: buscandoTeor,
  } = useQuery({
    queryKey: ['publicacao', pub.id],
    queryFn: () => umaPublicacao(pub.id),
    enabled: aberto,
    staleTime: 5 * 60_000,
  });

  const { data: previa, isLoading: carregandoPrevia } = useQuery({
    queryKey: ['publicacao', pub.id, 'previa'],
    queryFn: () => previaDaTarefa(pub.id),
    enabled: vendoPrevia,
    staleTime: 60_000,
  });

  const criar = useMutation({
    mutationFn: () => criarTarefaDaPublicacao(pub.id),
    onSuccess: (r) => {
      toast.success(
        r.criada ? 'Atividade criada para o dono do caso.' : 'Esta publicação já tinha atividade.',
      );
      setVendoPrevia(false);
      for (const k of [['dashboard-resumo'], ['publicacao', pub.id], ['compromissos'], ['minhas-pendencias']]) {
        qc.invalidateQueries({ queryKey: k });
      }
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message ?? 'Não foi possível criar a atividade.'),
  });

  const idDaTarefa = teor?.compromisso?.id ?? pub.compromissoId;
  const temTarefa = !!teor?.compromisso || pub.temTarefaAberta;
  const idDoProcesso = teor?.processo?.id ?? pub.processo?.id ?? '';
  // O motivo do robô, pela tabela da ficha; a cópia do mesmo ato não oferece tarefa repetida.
  const semTarefa = explicacaoDaPublicacaoSemTarefa({ temTarefa, teor });

  return (
    <li className="py-2 first:pt-0 last:pb-0">
<button
              type="button"
              onClick={() => setAberto((v) => !v)}
              aria-expanded={aberto}
              className="-mx-2 flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-muted/60"
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
              <ChevronRight
                className={cn(
                  'mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                  aberto && 'rotate-90',
                )}
              />
            </button>

      {aberto && (
        <div className="mt-2 rounded-lg border bg-muted/30 p-3">
          {carregandoTeor ? (
            <Carregando texto="Buscando o teor" className="space-y-1.5">
              <Esqueleto className="h-3 w-full" />
              <Esqueleto className="h-3 w-11/12" />
              <Esqueleto className="h-3 w-2/3" />
            </Carregando>
          ) : erroNoTeor ? (
            /*
              A FALHA É NOSSA, NÃO DO TRIBUNAL. Só `isLoading` era olhado: com a
              busca falhando, `teor` ficava vazio e a tela afirmava "o tribunal
              publicou este ato sem texto" — um fato sobre o tribunal causado
              por erro de rede.
            */
            <div className="flex flex-col gap-2 text-xs text-amber-900 sm:flex-row sm:items-center sm:justify-between dark:text-amber-200">
              <span>Não foi possível carregar o teor agora.</span>
              <button
                type="button"
                onClick={() => buscarTeorDeNovo()}
                disabled={buscandoTeor}
                className="inline-flex min-h-11 items-center gap-1.5 self-start rounded-lg border bg-card px-3 font-medium text-foreground transition hover:bg-muted disabled:opacity-60 sm:min-h-9"
              >
                {buscandoTeor ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Tentar de novo
              </button>
            </div>
          ) : (
            <>
              {/*
                O ATO COMO O TRIBUNAL ESCREVEU. Altura limitada com rolagem
                própria: um despacho tem três linhas, um acórdão tem três
                páginas, e a lista não pode virar nenhum dos dois.
              */}
              <p className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground/90">
                {teor?.texto?.trim() || 'O tribunal publicou este ato sem texto, só com o cabeçalho.'}
              </p>
              {teor?.nomeOrgao && (
                <p className="mt-2 text-[11px] text-muted-foreground">{teor.nomeOrgao}</p>
              )}
            </>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {/*
              A ACAO PRINCIPAL E A QUE FALTAVA. So aparece quando ha o que fazer:
              sem tarefa, e para quem grava na agenda.
            */}
            {!temTarefa && podeCriarTarefa && !vendoPrevia && !carregandoTeor && semTarefa.podeCriar && (
              <Button size="sm" className="h-11 sm:h-9" onClick={() => setVendoPrevia(true)}>
                <CalendarPlus className="h-4 w-4" /> Criar tarefa
              </Button>
            )}
            {semTarefa.tarefaDoMesmoAtoId && (
              <Link href={`/agenda?compromisso=${semTarefa.tarefaDoMesmoAtoId}`} className={ACAO_SECUNDARIA}>
                <CalendarClock className="h-4 w-4" /> Abrir a tarefa do mesmo ato
              </Link>
            )}
            {temTarefa && idDaTarefa && (
              <Link href={`/agenda?compromisso=${idDaTarefa}`} className={ACAO_SECUNDARIA}>
                <CalendarClock className="h-4 w-4" /> Ver a tarefa
              </Link>
            )}
            {idDoProcesso && (
              <Link href={`/processos?processo=${idDoProcesso}`} className={ACAO_SECUNDARIA}>
                <Gavel className="h-4 w-4" /> Abrir o processo
              </Link>
            )}
            {teor?.link && (
              <a
                href={teor.link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-muted-foreground transition hover:text-foreground sm:min-h-9"
              >
                <ExternalLink className="h-3.5 w-3.5" /> No Diário
              </a>
            )}
          </div>

          {/*
            A PRÉVIA. Não é um modal: a pessoa já está com a gaveta aberta e o
            teor à vista — tirar isso da frente para perguntar "confirma?" seria
            esconder justamente o que embasa a resposta.
          */}
          {vendoPrevia && (
            <div className="mt-3 rounded-lg border border-brand-400/70 bg-brand-50/60 p-3 dark:border-brand-700 dark:bg-brand-900/15">
              {carregandoPrevia ? (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Montando a tarefa…
                </p>
              ) : !previa ? (
                /*
                  O SISTEMA NÃO RECONHECEU PROVIDÊNCIA — e dizer isso é melhor
                  que oferecer um botão que vai falhar. O caminho existe: a
                  agenda, onde a pessoa descreve o que precisa ser feito.
                */
                <div className="space-y-2">
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    O sistema não reconheceu uma providência neste ato, então não sabe que tarefa
                    criar nem para quando. Dá para criar pela agenda, descrevendo o que precisa ser
                    feito.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Link href="/agenda" className={ACAO_SECUNDARIA}>
                      <CalendarPlus className="h-4 w-4" /> Ir para a agenda
                    </Link>
                    <button
                      type="button"
                      onClick={() => setVendoPrevia(false)}
                      className="min-h-11 px-2 text-xs font-medium text-muted-foreground hover:text-foreground sm:min-h-9"
                    >
                      Fechar
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Vai entrar assim na agenda
                  </p>
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                    {previa.titulo}
                    {previa.urgente && (
                      <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-800 dark:bg-red-900/40 dark:text-red-200">
                        Urgente
                      </span>
                    )}
                  </p>
                  <dl className="mt-2 space-y-1 text-xs">
                    <div className="flex gap-2">
                      <dt className="shrink-0 text-muted-foreground">Quando</dt>
                      <dd className="font-medium">{formatDataHora(previa.inicio)}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="shrink-0 text-muted-foreground">Para quem</dt>
                      <dd className="font-medium">
                        {previa.responsavel
                          ? previa.responsavel.nomeExibicao || previa.responsavel.nome
                          : 'sem responsável definido no processo'}
                      </dd>
                    </div>
                  </dl>
                  {/*
                    O MOTIVO DA URGÊNCIA, por extenso. Tarja vermelha sem porquê
                    é a marca que ensina todo mundo a ignorar a tarja.
                  */}
                  {previa.urgente && previa.urgenteMotivo && (
                    <p className="mt-2 text-[11px] leading-relaxed text-red-800 dark:text-red-300">
                      {previa.urgenteMotivo}
                    </p>
                  )}
                  <p className="mt-2 whitespace-pre-wrap text-[11px] leading-relaxed text-muted-foreground">
                    {previa.descricao}
                  </p>
                  {/*
                    QUEM CLICA NÃO VIRA DONO. Dizer isso aqui evita a surpresa de
                    procurar a tarefa na própria agenda e não achar.
                  */}
                  <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                    A tarefa fica com o dono do caso, não com você. Para assumir, use o botão
                    "Assumir" dentro dela.
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button size="sm" className="h-11 sm:h-9" onClick={() => criar.mutate()} disabled={criar.isPending}>
                      {criar.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CalendarPlus className="h-4 w-4" />
                      )}
                      Criar assim
                    </Button>
                    <button
                      type="button"
                      onClick={() => setVendoPrevia(false)}
                      disabled={criar.isPending}
                      className="min-h-11 px-2 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50 sm:min-h-9"
                    >
                      Agora não
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/*
            POR QUE NÃO HÁ TAREFA — quando o robô DECIDIU, e não quando falhou.
            A distinção existe no dado (`tarefaDispensadaMotivo`) e é o que separa
            "o sistema pensou nisto" de "o sistema deixou passar".
          */}
          {semTarefa.ajuda && (
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{semTarefa.ajuda}</p>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * AS ATIVIDADES PARADAS — com nome, e a um toque de distância.
 *
 * O relato: "diz 'uma atividade parada há mais de 7 dias', eu clico e abre a
 * agenda, mas não abre a atividade que está parada". Era isso mesmo. A faixa
 * levava para `/agenda` puro, e a agenda abre na aba de HOJE: a pessoa caía num
 * quadro vazio, com "92 em outras datas", e tinha de adivinhar qual era. O
 * número sem o nome obriga a procurar — e aviso que obriga a procurar é aviso
 * que se aprende a ignorar.
 *
 * A agenda já sabia abrir uma atividade por `?compromisso=<id>` (troca a aba,
 * leva o calendário ao mês dela e marca o cartão). Só faltava a faixa saber
 * QUAL mandar abrir.
 *
 * DOIS JEITOS, conforme quantas:
 *
 *  · UMA — a frase já diz qual é, de quem é e há quanto tempo, e a faixa
 *    inteira é o atalho. "Ver quais" para um item só seria um clique a mais
 *    para ver o que já cabia na frase.
 *  · VÁRIAS — abre no lugar, como o aviso do CNJ logo acima: cada linha com o
 *    rosto do responsável, e cada uma leva à própria atividade.
 *
 * Tom de informação, e não de alarme: parada não é atrasada. Atraso tem faixa
 * própria na lista de atividades; aqui é "alguém esqueceu disto?".
 */
function AtividadesParadas({
  total,
  itens,
}: {
  total: number;
  itens: NonNullable<ResumoDashboard['alertas']['paradas']>;
}) {
  const [aberto, setAberto] = useState(false);
  const diasParada = (iso: string) =>
    Math.max(7, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
  const nomeDe = (r: (typeof itens)[number]['responsavel']) =>
    r ? primeiroENome(r) : 'sem responsável';

  /*
    A API DA JANELA DE TROCA não manda a lista. Sem itens, a faixa volta a ser o
    que era — número e agenda — em vez de sumir ou quebrar enquanto os dois
    serviços não sobem juntos.
  */
  if (!itens.length) {
    return (
      <AlertBar tom="info" href="/agenda" acao="Abrir agenda">
        <strong>{total}</strong> {total === 1 ? 'atividade está parada' : 'atividades estão paradas'}{' '}
        há mais de 7 dias.
      </AlertBar>
    );
  }

  const casca = 'rounded-xl border border-input bg-muted/40 text-sm text-muted-foreground';

  if (total === 1) {
    const a = itens[0];
    return (
      <Link
        href={`/agenda?compromisso=${a.id}`}
        className={cn(casca, 'flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-muted')}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <Info className="h-4 w-4 shrink-0 opacity-70" />
          <span className="min-w-0">
            <strong className="text-foreground">{a.titulo}</strong> está parada há{' '}
            {diasParada(a.updatedAt)} dias
            <span className="hidden sm:inline"> — de {nomeDe(a.responsavel)}</span>.
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-0.5 text-xs font-semibold opacity-80">
          Abrir <ChevronRight className="h-3.5 w-3.5" />
        </span>
      </Link>
    );
  }

  return (
    <div className={casca}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:brightness-[0.98]"
      >
        <span className="flex items-center gap-2.5">
          <Info className="h-4 w-4 shrink-0 opacity-70" />
          <span>
            <strong className="text-foreground">{total} atividades estão paradas</strong> há mais de 7
            dias.
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-0.5 text-xs font-semibold opacity-80">
          {aberto ? 'Ocultar' : 'Ver quais'}
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', aberto && 'rotate-180')} />
        </span>
      </button>

      {aberto && (
        <ul className="border-t border-input">
          {itens.map((a) => (
            <li key={a.id}>
              <Link
                href={`/agenda?compromisso=${a.id}`}
                className="flex items-center gap-3 border-t border-input/60 px-4 py-2.5 transition first:border-t-0 hover:bg-muted"
              >
                {a.responsavel ? (
                  <AvatarPessoa
                    nome={a.responsavel.nomeExibicao || a.responsavel.nome}
                    url={a.responsavel.avatarUrl}
                    tamanho="xs"
                  />
                ) : (
                  <span className="h-5 w-5 shrink-0 rounded-full bg-muted" aria-hidden />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-foreground">{a.titulo}</span>
                  <span className="block truncate text-xs opacity-80">
                    {nomeDe(a.responsavel)} · era para {formatDataHora(a.inicio)}
                  </span>
                </span>
                <span className="shrink-0 text-xs">parada há {diasParada(a.updatedAt)}d</span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" />
              </Link>
            </li>
          ))}
          {/*
            O TETO É DE DEZ, e dizer isso é o que impede a lista de parecer o
            todo. Acima disso o lugar de trabalhar é a agenda.
          */}
          {/*
            O número não é link: nenhuma aba da agenda recorta "parada há 7 dias"
            (é `updatedAt`, não `inicio`), e abrir a agenda genérica mostraria
            outro número.
          */}
          {total > itens.length && (
            <li className="border-t border-input/60 px-4 py-2.5 text-xs">
              e mais {total - itens.length} — a lista mostra as dez paradas há mais tempo.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
