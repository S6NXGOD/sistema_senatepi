'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Briefcase, Clock, AlarmClock, Users, Gavel, CalendarDays,
  Flame, AlertTriangle, Landmark, Inbox, UserCheck, Activity,
  CheckCircle2, ChevronRight, FolderKanban, TrendingUp,
} from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell,
} from 'recharts';
import { useAuth } from '@/lib/auth';
import { podeVer, PERFIL_LABEL, type PerfilUsuario } from '@/lib/permissoes';
import { CANAL_LABEL } from '@/lib/atendimentos';
import {
  getResumoDashboard, saudacao, dataPorExtenso, tempoRelativo, horaCurta,
  primeiroNome, PALETA_CANAL, type ResumoDashboard,
} from '@/lib/dashboard';
import { Card, CardContent } from '@/components/ui/card';
import {
  KpiCard, SectionCard, EmptyState, CompromissoRow, AvatarMini,
} from '@/components/dashboard/widgets';
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

  const { data, isLoading } = useQuery({
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
    }),
    [role, perms],
  );

  if (!user) return null;

  return (
    <div className="space-y-5">
      <HeroHeader nome={user.nomeExibicao || user.nome} role={role} escopo={data?.escopo} />

      {isLoading || !data ? (
        <SkeletonHome />
      ) : (
        <Conteudo data={data} pode={pode} role={role} />
      )}
    </div>
  );
}

// ===========================================================================
// Cabeçalho (saudação + data + badge de perfil)
// ===========================================================================

function HeroHeader({ nome, role, escopo }: { nome: string; role: PerfilUsuario; escopo?: string }) {
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
          <span className="flex items-center gap-1.5 text-[11px] text-white/70">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
            </span>
            {escopo === 'PESSOAL' ? 'Sua carteira · tempo real' : 'Tempo real'}
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
  pode: Record<'processos' | 'atendimentos' | 'agenda' | 'filiados' | 'escalas', boolean>;
  role: PerfilUsuario;
}) {
  const { kpis, minhaCarteira, alertas } = data;

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
      sub: `${kpis.filiadosTotal} no total · +${kpis.novosFiliadosMes} no mês`,
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

      {/* Barras de alerta (agenda) */}
      {pode.agenda && (alertas.atrasadas > 0 || alertas.semMovimentacao > 0) && (
        <div className="space-y-2">
          {alertas.atrasadas > 0 && (
            <AlertBar tom="amber" href="/agenda">
              <strong>{alertas.atrasadas}</strong>{' '}
              {alertas.atrasadas === 1 ? 'atividade atrasada' : 'atividades atrasadas'} — horário já passou e ainda está pendente
            </AlertBar>
          )}
          {alertas.semMovimentacao > 0 && (
            <AlertBar tom="rose" href="/agenda" forte>
              <strong>Atenção!</strong> Há atividades sem movimentação há mais de 7 dias. Mantê-las atualizadas é essencial para a qualidade do atendimento.
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

      {/* Pendências ativas + atendimentos pendentes */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {pode.agenda && <PendenciasAtivas data={data} pessoal={data.escopo === 'PESSOAL'} />}
        {pode.atendimentos && <AtendimentosPendentes data={data} />}
      </div>

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

function AlertBar({
  children, tom, href, forte,
}: {
  children: React.ReactNode; tom: 'amber' | 'rose'; href: string; forte?: boolean;
}) {
  const base =
    tom === 'amber'
      ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200'
      : forte
        ? 'border-transparent bg-rose-600 text-white'
        : 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-900/50 dark:bg-rose-900/20 dark:text-rose-200';
  return (
    <Link href={href} className={cn('flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm transition hover:brightness-[0.98]', base)}>
      <span className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>{children}</span>
      </span>
      <span className={cn('flex shrink-0 items-center gap-0.5 text-xs font-semibold', forte && 'underline')}>
        Ver <ChevronRight className="h-3.5 w-3.5" />
      </span>
    </Link>
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

function AtendimentosPendentes({ data }: { data: ResumoDashboard }) {
  const itens = data.atendimentosPendentes;
  return (
    <SectionCard title="Atendimentos pendentes" icon={Inbox} count={data.kpis.atendimentosPendentes} actionHref="/atendimentos" actionLabel="Triagem">
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
    podeFil && { key: 'filiados' as const, label: 'Filiados (6 meses)' },
  ].filter(Boolean) as { key: 'atendimentos' | 'filiados'; label: string }[];
  const [aba, setAba] = useState<'atendimentos' | 'filiados'>(abas[0]?.key ?? 'atendimentos');

  const chartData = aba === 'atendimentos' ? data.graficos.atendimentos14dias : data.graficos.crescimentoFiliados;
  const xKey = aba === 'atendimentos' ? 'dia' : 'mes';

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
      <CardContent className="h-64 p-4">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id="grad-verde" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#4FA11B" stopOpacity={0.55} />
                <stop offset="95%" stopColor="#4FA11B" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
            <XAxis dataKey={xKey} fontSize={11} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis fontSize={11} allowDecimals={false} tickLine={false} axisLine={false} width={28} />
            <Tooltip
              contentStyle={{ borderRadius: 12, border: '1px solid hsl(var(--border))', fontSize: 12 }}
              labelStyle={{ fontWeight: 600 }}
            />
            <Area type="monotone" dataKey="total" name="Total" stroke="#1B7F0A" strokeWidth={2} fill="url(#grad-verde)" />
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
