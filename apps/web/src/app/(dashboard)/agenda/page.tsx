'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Loader2, Plus, Search, CalendarClock, Columns3, CalendarDays, SlidersHorizontal, Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { nivelEfetivo } from '@/lib/permissoes';
import { KanbanView } from '@/components/agenda/kanban-view';
import { CalendarioView } from '@/components/agenda/calendario-view';
import { CompromissoFormModal } from '@/components/agenda/compromisso-form-modal';
import { CompromissoDrawer } from '@/components/agenda/compromisso-drawer';
import { TiposEventoModal } from '@/components/agenda/tipos-evento-modal';
import { AlertasBar } from '@/components/agenda/alertas-bar';
import { AtendimentoDrawer } from '@/components/atendimentos/atendimento-drawer';
import { useTiposEvento } from '@/lib/use-tipos-evento';
import {
  listarCompromissos, mudarStatusCompromisso, excluirCompromisso, listarResponsaveis,
  Compromisso, StatusCompromisso, TipoCompromisso,
} from '@/lib/agenda';

type Visao = 'kanban' | 'calendario';
type Aba = 'todos' | 'aberto' | 'hoje' | '7dias' | 'urgentes';
const inputCls = 'h-12 rounded-md border border-input bg-background px-3 text-base sm:h-10 sm:text-sm';

const ABAS: { key: Aba; label: string }[] = [
  { key: 'todos', label: 'Todos' },
  { key: 'aberto', label: 'Em aberto' },
  { key: 'hoje', label: 'Hoje' },
  { key: '7dias', label: '7 dias' },
  { key: 'urgentes', label: 'Urgentes' },
];

function gradeDoMes(mes: Date) {
  const primeiro = new Date(mes.getFullYear(), mes.getMonth(), 1);
  const ini = new Date(primeiro);
  ini.setDate(1 - primeiro.getDay());
  const fim = new Date(ini);
  fim.setDate(ini.getDate() + 42);
  return { dataInicio: ini.toISOString(), dataFim: fim.toISOString() };
}

/** Filtro por aba (client-side, sobre os compromissos carregados). */
function aplicarAba(cs: Compromisso[], aba: Aba): Compromisso[] {
  if (aba === 'todos') return cs;
  const agora = new Date();
  if (aba === 'aberto') return cs.filter((c) => c.status === 'PENDENTE' || c.status === 'EM_ANDAMENTO');
  if (aba === 'urgentes') return cs.filter((c) => c.urgente);
  if (aba === 'hoje') {
    return cs.filter((c) => {
      const d = new Date(c.inicio);
      return d.getFullYear() === agora.getFullYear() && d.getMonth() === agora.getMonth() && d.getDate() === agora.getDate();
    });
  }
  if (aba === '7dias') {
    const lim = new Date(agora.getTime() + 7 * 86400_000);
    return cs.filter((c) => { const d = new Date(c.inicio); return d >= new Date(agora.toDateString()) && d <= lim; });
  }
  return cs;
}

export default function AgendaPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const ehAdmin = user?.role === 'ADMINISTRADOR';
  const podeEditar = nivelEfetivo(user?.role, user?.permissoes, 'agenda') === 'EDITAR';
  const { tipos } = useTiposEvento();

  const [visao, setVisao] = useState<Visao>('kanban');
  const [aba, setAba] = useState<Aba>('hoje');
  const [busca, setBusca] = useState('');
  const [buscaDeb, setBuscaDeb] = useState('');
  const [tipo, setTipo] = useState<'' | TipoCompromisso>('');
  const [responsavelId, setResponsavelId] = useState('');
  const [mes, setMes] = useState(() => new Date());
  const [tiposOpen, setTiposOpen] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editar, setEditar] = useState<Compromisso | null>(null);
  const [detalheId, setDetalheId] = useState<string | null>(null);
  const [triagemId, setTriagemId] = useState<string | null>(null);
  const [excluir, setExcluir] = useState<Compromisso | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setBuscaDeb(busca.trim()), 350);
    return () => clearTimeout(t);
  }, [busca]);

  const responsaveis = useQuery({ queryKey: ['compromissos-responsaveis'], queryFn: listarResponsaveis });

  const rangeCal = useMemo(() => gradeDoMes(mes), [mes]);
  const filtroBase = { busca: buscaDeb || undefined, tipo: tipo || undefined, responsavelId: responsavelId || undefined };
  const filtro = visao === 'calendario' ? { ...filtroBase, ...rangeCal } : filtroBase;

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['compromissos', visao, buscaDeb, tipo, responsavelId, visao === 'calendario' ? rangeCal.dataInicio : ''],
    queryFn: () => listarCompromissos(filtro),
  });
  const compromissos = data ?? [];
  const filtrados = visao === 'kanban' ? aplicarAba(compromissos, aba) : compromissos;

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['compromissos'] });
    qc.invalidateQueries({ queryKey: ['compromisso'] });
    qc.invalidateQueries({ queryKey: ['agenda-alertas'] });
  };

  const status = useMutation({
    mutationFn: ({ id, status }: { id: string; status: StatusCompromisso }) => mudarStatusCompromisso(id, status),
    onSuccess: () => invalidar(),
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível mudar o status.'),
  });
  const remover = useMutation({
    mutationFn: (id: string) => excluirCompromisso(id),
    onSuccess: () => { toast.success('Evento excluído.'); setExcluir(null); invalidar(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível excluir.'),
  });

  const onEditar = (c: Compromisso) => { setDetalheId(null); setEditar(c); setFormOpen(true); };
  const onAbrir = (c: Compromisso) => setDetalheId(c.id);
  const onNovo = () => { setEditar(null); setFormOpen(true); };
  const onAcao = (id: string, s: StatusCompromisso) => status.mutate({ id, status: s });

  function mudarMes(delta: number) {
    setMes((m) => (delta === 0 ? new Date() : new Date(m.getFullYear(), m.getMonth() + delta, 1)));
  }

  return (
    <div className="space-y-5">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-senatepi-50 dark:bg-senatepi-900/30">
            <CalendarClock className="h-5 w-5 text-senatepi-800 dark:text-senatepi-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">Agenda e Prazos</h2>
            <p className="text-sm text-muted-foreground">Audiências, prazos e compromissos jurídicos</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setTiposOpen(true)}><SlidersHorizontal className="h-4 w-4" /> Tipos</Button>
          <Button onClick={onNovo}><Plus className="h-4 w-4" /> Novo Evento</Button>
        </div>
      </div>

      {/* Alertas */}
      <AlertasBar onAbrir={onAbrir} />

      {/* Abas + toggle de visão */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {ABAS.map((a) => (
            <button
              key={a.key}
              onClick={() => setAba(a.key)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                aba === a.key ? 'bg-senatepi-800 text-white shadow-sm' : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {a.label}
            </button>
          ))}
        </div>
        <div className="flex rounded-lg border border-input bg-card p-1">
          <button onClick={() => setVisao('kanban')} className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${visao === 'kanban' ? 'bg-senatepi-800 text-white shadow-sm' : 'text-muted-foreground hover:bg-muted'}`}>
            <Columns3 className="h-4 w-4" /> Kanban
          </button>
          <button onClick={() => setVisao('calendario')} className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${visao === 'calendario' ? 'bg-senatepi-800 text-white shadow-sm' : 'text-muted-foreground hover:bg-muted'}`}>
            <CalendarDays className="h-4 w-4" /> Calendário
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar por nome…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          {isFetching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
        </div>
        <select className={inputCls} value={tipo} onChange={(e) => setTipo(e.target.value as any)} aria-label="Tipo">
          <option value="">Todos os tipos</option>
          {tipos.map((t) => <option key={t.id} value={t.slug}>{t.nome}</option>)}
        </select>
        <select className={inputCls} value={responsavelId} onChange={(e) => setResponsavelId(e.target.value)} aria-label="Responsável">
          <option value="">Todos os responsáveis</option>
          {(responsaveis.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
        </select>
      </div>

      {/* Conteúdo */}
      {isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-senatepi-800 dark:text-senatepi-400" /></div>
      ) : visao === 'kanban' ? (
        <KanbanView
          compromissos={filtrados}
          onAbrir={onAbrir}
          onEditar={onEditar}
          onVerTriagem={setTriagemId}
          onAcao={onAcao}
          onExcluir={setExcluir}
          podeExcluir={ehAdmin}
        />
      ) : (
        <CalendarioView compromissos={compromissos} mes={mes} onMudarMes={mudarMes} onSelecionar={onAbrir} />
      )}

      {/* Modal criar/editar */}
      <CompromissoFormModal open={formOpen} onClose={() => setFormOpen(false)} onSalvo={invalidar} editar={editar} />

      {/* Drawer de DETALHE (clique no card) — lápis edita, lixeira exclui */}
      <CompromissoDrawer
        compromissoId={detalheId}
        open={!!detalheId}
        onClose={() => setDetalheId(null)}
        onEditar={onEditar}
        onExcluir={(c) => { setDetalheId(null); setExcluir(c); }}
        onVerTriagem={(id) => { setDetalheId(null); setTriagemId(id); }}
        podeExcluir={ehAdmin}
      />

      {/* Gerenciador de tipos de evento (CRUD) */}
      <TiposEventoModal
        open={tiposOpen}
        onClose={() => setTiposOpen(false)}
        podeEditar={podeEditar}
        podeExcluir={ehAdmin}
        onChanged={() => qc.invalidateQueries({ queryKey: ['compromissos'] })}
      />

      {/* Ponte com a triagem */}
      <AtendimentoDrawer atendimentoId={triagemId} open={!!triagemId} onClose={() => setTriagemId(null)} />

      {/* Excluir */}
      <ConfirmDialog
        open={!!excluir}
        variant="destructive"
        title="Excluir evento"
        icon={<Trash2 className="h-6 w-6" />}
        description={<>Excluir o evento <strong>{excluir?.titulo}</strong> da agenda? Esta ação é irreversível.</>}
        confirmLabel="Excluir evento"
        loading={remover.isPending}
        onConfirm={() => excluir && remover.mutate(excluir.id)}
        onClose={() => setExcluir(null)}
      />
    </div>
  );
}
