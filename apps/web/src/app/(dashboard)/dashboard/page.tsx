'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Briefcase, Clock, AlarmClock, Users, Gavel, CalendarDays,
  Flame, AlertTriangle, Landmark, Inbox, UserCheck, Activity, RefreshCw, Cake, Timer,
  CheckCircle2, ChevronRight, ChevronDown, FolderKanban, TrendingUp, Info, AlertCircle, Loader2,
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
  primeiroNome, motivoFalhaDatajud, PALETA_CANAL,
  type ResumoDashboard, type FalhaDatajud,
} from '@/lib/dashboard';
import { formatNPU } from '@/lib/processos';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  KpiCard, SectionCard, EmptyState, CompromissoRow, AvatarMini,
} from '@/components/dashboard/widgets';
import { AudienciasAgendarPanel } from '@/components/processos/audiencias-agendar-panel';
import { cn } from '@/lib/utils';

const BADGE_ROLE: Record<PerfilUsuario, string> = {
  ADMINISTRADOR: 'bg-rose-600 text-white',
  COORDENACAO: 'bg-senatepi-800 text-white',
  ADVOGADO: 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900',
  TRIAGEM: 'bg-sky-600 text-white',
};

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
    <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-senatepi-800 to-senatepi-600 p-5 text-white shadow-sm md:p-6">
      <div className="pointer-events-none absolute -right-8 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
      <div className="pointer-events-none absolute -bottom-12 right-24 h-32 w-32 rounded-full bg-senatepi-400/20 blur-2xl" />
      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm text-white/80">
            <Activity className="h-4 w-4" />
            <span>Painel · SENATEPI</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold md:text-3xl">{saudacao(nome)} 👋</h1>
          <p className="mt-0.5 text-sm text-white/80">{dataPorExtenso()}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className={cn('rounded-full px-3 py-1 text-xs font-semibold shadow-sm', BADGE_ROLE[role])}>
            {PERFIL_LABEL[role]}
          </span>
          {/* "Tempo real" era propaganda: o painel recarrega a cada 60s. Dizer
              QUANDO o dado foi buscado é a informação que o usuário usa para
              decidir se atualiza a página antes de tomar uma decisão. */}
          <span className="flex items-center gap-1.5 text-[11px] text-white/70">
            <RefreshCw className="h-3 w-3" />
            {escopo === 'PESSOAL' && 'Sua carteira · '}
            {atualizadoEm ? `atualizado ${idadeDoDado(atualizadoEm)}` : 'carregando…'}
          </span>
        </div>
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
  pode: Record<'processos' | 'atendimentos' | 'agenda' | 'filiados' | 'escalas' | 'radarAudiencias', boolean>;
  role: PerfilUsuario;
}) {
  const { kpis, minhaCarteira, alertas } = data;

  /** Perfis que coordenam a operação — os únicos que veem a carga da equipe. */
  const ehGestao = role === 'ADMINISTRADOR' || role === 'COORDENACAO';
  /**
   * A Triagem é atendimento: a fila dela (contatos e atendimentos) vem PRIMEIRO,
   * antes dos blocos do jurídico. Antes, ela via o painel do advogado com
   * buracos onde faltava permissão — nunca o próprio trabalho em destaque.
   */
  const ehTriagem = role === 'TRIAGEM';

  // KPIs globais, filtrados pelo que o perfil pode ver.
  const kpiCards = [
    pode.processos && {
      label: 'Processos ativos', valor: kpis.processosAtivos, sub: 'em andamento',
      icon: Briefcase, cor: 'bg-senatepi-50 text-senatepi-800 dark:bg-senatepi-900/30 dark:text-senatepi-400',
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

  return (
    <>
      {/* Minha carteira — só advogado */}
      {minhaCarteira && (
        <section>
          <SectionTitle icon={FolderKanban} texto="Minha carteira" />
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard label="Meus processos" valor={minhaCarteira.meusProcessos} sub="vinculados a mim"
              icon={Briefcase} cor="bg-senatepi-50 text-senatepi-800 dark:bg-senatepi-900/30 dark:text-senatepi-400" href="/processos" destaque />
            <KpiCard label="Minhas audiências" valor={minhaCarteira.minhasAudiencias} sub="esta semana"
              icon={Gavel} cor="bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400" href="/agenda" destaque />
            <KpiCard label="Atrasadas" valor={minhaCarteira.atrasadas} sub="pendentes agora"
              icon={AlertTriangle} cor="bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400" href="/agenda" destaque />
            <KpiCard label="Urgentes" valor={minhaCarteira.urgentes} sub="próximos 7 dias"
              icon={Flame} cor="bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400" href="/agenda" destaque />
          </div>
        </section>
      )}

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
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ContatosHoje data={data} />
            {pode.atendimentos && <AtendimentosPendentes data={data} />}
          </div>
          {/* Aniversariantes logo abaixo da fila: é a secretaria quem faz o
              contato, e o card só aparece quando há alguém. */}
          {pode.filiados && (
            <div className="mt-4">
              <Aniversariantes data={data} />
            </div>
          )}
        </section>
      )}

      {/* Robô do DataJud. Vem ANTES do radar de propósito: se a varredura não
          rodou, o "0 audiências a agendar" abaixo não quer dizer nada. */}
      {pode.processos && <AvisoRobo robo={data.robo} />}

      {/* Audiências a agendar (DataJud → Agenda) — o alerta mais acionável da
          home: vem antes das barras porque cada item tem um "próximo passo". */}
      {pode.radarAudiencias && (
        <AudienciasAgendarPanel
          dados={{ items: data.audienciasAAgendar, total: alertas.audienciasAAgendar }}
        />
      )}

      {/* Barras de alerta (agenda) */}
      {pode.agenda && (alertas.atrasadas > 0 || alertas.semMovimentacao > 0) && (
        <div className="space-y-2">
          {alertas.atrasadas > 0 && (
            <AlertBar tom="atencao" href="/agenda" acao="Abrir agenda">
              <strong>{alertas.atrasadas}</strong>{' '}
              {alertas.atrasadas === 1
                ? 'atividade com horário vencido'
                : 'atividades com horário vencido'}{' '}
              e ainda em aberto.
            </AlertBar>
          )}
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

      {/* Grade principal: equipe/audiências (1) + atividades de hoje (2) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          {pode.escalas && <EquipeHoje data={data} />}
          {pode.agenda && <AudienciasSemana data={data} />}
        </div>
        {pode.agenda && (
          <div className="lg:col-span-2">
            <AtividadesHoje data={data} pessoal={data.escopo === 'PESSOAL'} />
          </div>
        )}
      </div>

      {/* Gráficos */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <GraficoTendencia data={data} podeAtend={pode.atendimentos} podeFil={pode.filiados} />
        </div>
        {pode.atendimentos && <GraficoCanais data={data} />}
      </div>

      {/* Pendências ativas + atendimentos pendentes.
          A Triagem já viu os atendimentos no topo — não repete aqui. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {pode.agenda && <PendenciasAtivas data={data} pessoal={data.escopo === 'PESSOAL'} />}
        {pode.atendimentos && !ehTriagem && <AtendimentosPendentes data={data} />}
      </div>

      {/* Carga da equipe — instrumento de GESTÃO, restrito a quem coordena.
          O advogado não recebe o dado da API; a Triagem tem acesso à agenda,
          mas a lista de quem está sobrecarregado não é trabalho dela. */}
      {ehGestao && data.cargaEquipe && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <CargaEquipe data={data} />
          {/* Ao lado: quem coordena precisa ver se o contato com o filiado está
              andando ANTES das audiências — é o que evita ausência na pauta. */}
          <ContatosHoje data={data} />
        </div>
      )}

      {/* Aniversariantes para os demais perfis (a Triagem já viu no topo).
          O card se esconde sozinho em dia sem aniversário. */}
      {!ehTriagem && pode.filiados && <Aniversariantes data={data} />}

      {/* Movimentações DataJud */}
      {pode.processos && <MovimentacoesRecentes data={data} />}
    </>
  );
}

// ===========================================================================
// Blocos
// ===========================================================================

function SectionTitle({ icon: Icon, texto }: { icon: typeof Briefcase; texto: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Icon className="h-4 w-4 text-senatepi-800 dark:text-senatepi-400" />
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
  children, tom, href, acao = 'Ver',
}: {
  children: React.ReactNode;
  tom: 'info' | 'atencao' | 'critico';
  href: string;
  acao?: string;
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

  return (
    <Link
      href={href}
      className={cn(
        'flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm transition hover:brightness-[0.98]',
        estilo.cor,
      )}
    >
      <span className="flex items-center gap-2.5">
        <Icone className={cn('h-4 w-4 shrink-0', estilo.icone)} />
        <span>{children}</span>
      </span>
      <span className="flex shrink-0 items-center gap-0.5 text-xs font-semibold opacity-80">
        {acao} <ChevronRight className="h-3.5 w-3.5" />
      </span>
    </Link>
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
function AvisoRobo({ robo }: { robo: ResumoDashboard['robo'] }) {
  const { situacao, processosMonitorados, ultimaSincronizacao, falhasProcessos } = robo;
  const desde = ultimaSincronizacao
    ? idadeDoDado(new Date(ultimaSincronizacao).getTime())
    : null;

  const falhasBar = falhasProcessos.length > 0 && <FalhasCNJ falhas={falhasProcessos} />;

  // Ocioso ou em dia: nenhuma barra sobre o robô. Só as falhas, se houver.
  if (situacao === 'SEM_OBJETO' || situacao === 'EM_DIA') {
    return falhasBar || null;
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
function FalhasCNJ({ falhas }: { falhas: FalhaDatajud[] }) {
  const [aberto, setAberto] = useState(false);
  const n = falhas.length;
  // Uma chave recusada ou um NPU que o CNJ não reconhece falham de novo
  // amanhã: separá-los evita prometer que "a próxima varredura resolve"
  // quando ela não resolve.
  const persistentes = falhas.filter((f) => !motivoFalhaDatajud(f).passageiro).length;

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:brightness-[0.98]"
      >
        <span className="flex items-center gap-2.5">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>
            A varredura do DataJud não conseguiu atualizar <strong>{n}</strong>{' '}
            {n === 1 ? 'processo' : 'processos'} nas últimas 24h.{' '}
            {persistentes === 0 ? (
              <>Costuma ser instabilidade passageira — a próxima varredura tenta de novo.</>
            ) : persistentes === n ? (
              <>
                {n === 1 ? 'A falha não é passageira' : 'As falhas não são passageiras'}:
                tentar de novo não resolve sem alguém verificar.
              </>
            ) : (
              <>
                <strong>{persistentes}</strong>{' '}
                {persistentes === 1 ? 'não é passageira' : 'não são passageiras'} e
                {persistentes === 1 ? ' pede' : ' pedem'} verificação.
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
        <ul className="border-t border-amber-300/70 dark:border-amber-900/50">
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

function EquipeHoje({ data }: { data: ResumoDashboard }) {
  const { plantaoHoje, proximoPlantao } = data.equipeHoje;
  const agoraHM = new Date().toTimeString().slice(0, 5);
  const statusPlantao = (ini: string, fim: string) =>
    agoraHM > fim ? { t: 'Encerrado', c: 'text-muted-foreground' }
      : agoraHM >= ini ? { t: 'No horário', c: 'text-emerald-600 dark:text-emerald-400' }
        : { t: 'Aguardando', c: 'text-amber-600 dark:text-amber-400' };

  return (
    <SectionCard title="Equipe disponível hoje" icon={UserCheck} count={plantaoHoje.length} actionHref="/escalas" actionLabel="Escalas">
      {plantaoHoje.length === 0 ? (
        <EmptyState icon={UserCheck}>Ninguém de plantão hoje.</EmptyState>
      ) : (
        <ul className="space-y-1">
          {plantaoHoje.map((p) => {
            const st = statusPlantao(p.horaInicio, p.horaFim);
            return (
              <li key={p.id} className="flex items-center gap-3 rounded-lg px-2 py-2">
                <AvatarMini pessoa={p.advogado} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{primeiroNome(p.advogado)}</p>
                  <p className="text-xs text-muted-foreground">{p.horaInicio} – {p.horaFim}</p>
                </div>
                <span className={cn('text-xs font-medium', st.c)}>{st.t}</span>
              </li>
            );
          })}
        </ul>
      )}
      {proximoPlantao && (
        <div className="mt-2 border-t pt-3">
          <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Próximo plantão · {new Date(proximoPlantao.data).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 px-2">
            {proximoPlantao.advogados.map((a) => (
              <span key={a.id} className="flex items-center gap-1.5 rounded-full bg-muted py-0.5 pl-0.5 pr-2.5 text-xs">
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
              <Link href="/agenda" className="flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-muted/60">
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

function AtividadesHoje({ data, pessoal }: { data: ResumoDashboard; pessoal: boolean }) {
  const itens = data.atividadesHoje;
  return (
    <SectionCard title={pessoal ? 'Minhas atividades de hoje' : 'Atividades de hoje'} icon={CalendarDays} count={itens.length} actionHref="/agenda">
      {itens.length === 0 ? (
        <EmptyState icon={CheckCircle2}>Nenhuma atividade agendada para hoje.</EmptyState>
      ) : (
        <ul className="divide-y divide-border/60">
          {itens.map((c) => (
            <li key={c.id}>
              <CompromissoRow c={c} />
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function PendenciasAtivas({ data, pessoal }: { data: ResumoDashboard; pessoal: boolean }) {
  const itens = data.pendenciasAtivas;
  return (
    <SectionCard title="Pendências ativas" icon={AlarmClock} count={itens.length} actionHref="/agenda">
      {itens.length === 0 ? (
        <EmptyState icon={CheckCircle2}>{pessoal ? 'Tudo em dia! Nenhuma pendência pessoal.' : 'Nenhuma pendência em aberto.'}</EmptyState>
      ) : (
        <ul className="divide-y divide-border/60">
          {itens.map((c) => (
            <li key={c.id}>
              <CompromissoRow c={c} mostrarData />
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
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-senatepi-100 text-xs font-bold text-senatepi-800 dark:bg-senatepi-900/40 dark:text-senatepi-300">
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
                    className={cn('h-full rounded-full', atrasadas > 0 ? 'bg-rose-500' : 'bg-senatepi-600')}
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
 * FILA DA TRIAGEM — as tarefas de contato com o filiado (as que o robô cria
 * antes de cada audiência). A secretaria via o painel do jurídico com buracos;
 * este é o trabalho dela.
 */
function ContatosHoje({ data }: { data: ResumoDashboard }) {
  const itens = data.contatosHoje ?? [];
  return (
    <SectionCard title="Contatos a fazer" icon={UserCheck} count={itens.length} actionHref="/agenda" actionLabel="Agenda">
      {itens.length === 0 ? (
        <EmptyState icon={CheckCircle2}>Nenhum contato pendente. Tudo em dia.</EmptyState>
      ) : (
        <ul className="divide-y divide-border/60">
          {itens.map((c) => (
            <li key={c.id}>
              <Link href="/agenda" className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition hover:bg-muted/60">
                <span className={cn('w-1 shrink-0 self-stretch rounded-full',
                  new Date(c.inicio) < new Date() ? 'bg-rose-500' : 'bg-cyan-400')} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{c.titulo}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {c.filiado?.nomeCompleto ?? 'Sem filiado'} · {horaCurta(c.inicio)}
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
 * ANIVERSARIANTES DO DIA — filiados e equipe na mesma lista.
 *
 * É a única ação do painel que gera relacionamento em vez de resolver
 * pendência: um "parabéns" custa um clique e o filiado percebe o sindicato.
 * O botão do WhatsApp já leva a mensagem pronta, porque o atrito de escrever
 * é o que faz a intenção morrer.
 */
function Aniversariantes({ data }: { data: ResumoDashboard }) {
  const itens = data.aniversariantes ?? [];
  if (itens.length === 0) return null; // dia sem aniversário não vira card vazio

  return (
    <SectionCard title="Aniversariantes de hoje" icon={Cake} count={itens.length}>
      <ul className="divide-y divide-border/60">
        {itens.map((p) => {
          const primeiroNome = p.nome.split(' ')[0];
          const msg = `Olá, ${primeiroNome}! O SENATEPI deseja a você um feliz aniversário! 🎉`;
          const zap = p.telefone
            ? `https://wa.me/55${p.telefone.replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`
            : null;
          return (
            <li key={`${p.tipo}-${p.id}`} className="flex items-center gap-3 px-2 py-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-pink-100 text-sm dark:bg-pink-950/40">
                🎂
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
              ) : (
                <span className="shrink-0 text-[11px] text-muted-foreground">sem telefone</span>
              )}
            </li>
          );
        })}
      </ul>
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
              <Link href="/atendimentos" className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition hover:bg-muted/60">
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
              <Link href="/processos" className="flex items-start gap-3 rounded-lg px-2 py-2.5 transition hover:bg-muted/60">
                <Landmark className="mt-0.5 h-4 w-4 shrink-0 text-senatepi-800 dark:text-senatepi-400" />
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
          <TrendingUp className="h-4 w-4 text-senatepi-800 dark:text-senatepi-400" />
          <h3 className="text-sm font-semibold">Tendência</h3>
        </div>
        {abas.length > 1 && (
          <div className="flex rounded-lg border p-0.5">
            {abas.map((a) => (
              <button key={a.key} onClick={() => setAba(a.key)}
                className={cn('rounded-md px-2.5 py-1 text-xs font-medium transition',
                  aba === a.key ? 'bg-senatepi-800 text-white' : 'text-muted-foreground hover:text-foreground')}>
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
            ['entradas', 'Entradas', '#1B7F0A'],
            ['saidas', 'Saídas', '#DC2626'],
            ['saldo', 'Saldo', '#7C3AED'],
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
              <linearGradient id="grad-verde" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#4FA11B" stopOpacity={0.55} />
                <stop offset="95%" stopColor="#4FA11B" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="grad-vermelho" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#DC2626" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#DC2626" stopOpacity={0} />
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
                  <Area type="monotone" dataKey="entradas" name="Entradas" stroke="#1B7F0A"
                    strokeWidth={2} fill="url(#grad-verde)" />
                )}
                {series.saidas && (
                  <Area type="monotone" dataKey="saidas" name="Saídas" stroke="#DC2626"
                    strokeWidth={2} fill="url(#grad-vermelho)" />
                )}
                {series.saldo && (
                  <Area type="monotone" dataKey="saldo" name="Saldo" stroke="#7C3AED"
                    strokeWidth={2} strokeDasharray="4 3" fill="none" />
                )}
              </>
            ) : (
              <Area type="monotone" dataKey="total" name="Total" stroke="#1B7F0A" strokeWidth={2} fill="url(#grad-verde)" />
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
        <Inbox className="h-4 w-4 text-senatepi-800 dark:text-senatepi-400" />
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
                      <Cell key={i} fill={PALETA_CANAL[i % PALETA_CANAL.length]} />
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
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: PALETA_CANAL[i % PALETA_CANAL.length] }} />
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
