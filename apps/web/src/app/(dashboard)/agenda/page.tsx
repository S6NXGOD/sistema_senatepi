'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Loader2, Plus, Search, CalendarClock, Columns3, CalendarDays,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { KanbanView } from '@/components/agenda/kanban-view';
import { CalendarioView } from '@/components/agenda/calendario-view';
import { CompromissoFormDrawer } from '@/components/agenda/compromisso-form-drawer';
import { AtendimentoDrawer } from '@/components/atendimentos/atendimento-drawer';
import {
  listarCompromissos, mudarStatusCompromisso, listarResponsaveis,
  Compromisso, StatusCompromisso, TipoCompromisso, TIPOS, TIPO_LABEL,
} from '@/lib/agenda';

type Visao = 'kanban' | 'calendario';
const inputCls = 'h-12 rounded-md border border-input bg-background px-3 text-base sm:h-10 sm:text-sm';

/** Intervalo (42 dias) da grade do mês, para buscar os eventos do calendário. */
function gradeDoMes(mes: Date) {
  const primeiro = new Date(mes.getFullYear(), mes.getMonth(), 1);
  const ini = new Date(primeiro);
  ini.setDate(1 - primeiro.getDay());
  const fim = new Date(ini);
  fim.setDate(ini.getDate() + 42);
  return { dataInicio: ini.toISOString(), dataFim: fim.toISOString() };
}

export default function AgendaPage() {
  const qc = useQueryClient();
  const [visao, setVisao] = useState<Visao>('kanban');
  const [busca, setBusca] = useState('');
  const [buscaDeb, setBuscaDeb] = useState('');
  const [tipo, setTipo] = useState<'' | TipoCompromisso>('');
  const [responsavelId, setResponsavelId] = useState('');
  const [mes, setMes] = useState(() => new Date());

  const [formOpen, setFormOpen] = useState(false);
  const [editar, setEditar] = useState<Compromisso | null>(null);
  const [triagemId, setTriagemId] = useState<string | null>(null);

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

  const invalidar = () => qc.invalidateQueries({ queryKey: ['compromissos'] });

  const status = useMutation({
    mutationFn: ({ id, status }: { id: string; status: StatusCompromisso }) => mudarStatusCompromisso(id, status),
    onSuccess: () => invalidar(),
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível mudar o status.'),
  });

  const onEditar = (c: Compromisso) => { setEditar(c); setFormOpen(true); };
  const onNovo = () => { setEditar(null); setFormOpen(true); };
  const onStatus = (id: string, s: StatusCompromisso) => status.mutate({ id, status: s });

  function mudarMes(delta: number) {
    setMes((m) => (delta === 0 ? new Date() : new Date(m.getFullYear(), m.getMonth() + delta, 1)));
  }

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-senatepi-50 dark:bg-senatepi-900/30">
            <CalendarClock className="h-5 w-5 text-senatepi-800 dark:text-senatepi-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">Agenda e Prazos</h2>
            <p className="text-sm text-muted-foreground">Audiências, prazos e compromissos</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Toggle de visão */}
          <div className="flex rounded-lg border border-input bg-card p-1">
            <button onClick={() => setVisao('kanban')} className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${visao === 'kanban' ? 'bg-senatepi-800 text-white shadow-sm' : 'text-muted-foreground hover:bg-muted'}`}>
              <Columns3 className="h-4 w-4" /> Kanban
            </button>
            <button onClick={() => setVisao('calendario')} className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${visao === 'calendario' ? 'bg-senatepi-800 text-white shadow-sm' : 'text-muted-foreground hover:bg-muted'}`}>
              <CalendarDays className="h-4 w-4" /> Calendário
            </button>
          </div>
          <Button onClick={onNovo}><Plus className="h-4 w-4" /> Novo</Button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar por título ou filiado…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          {isFetching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
        </div>
        <select className={inputCls} value={tipo} onChange={(e) => setTipo(e.target.value as any)} aria-label="Tipo">
          <option value="">Todos os tipos</option>
          {TIPOS.map((t) => <option key={t} value={t}>{TIPO_LABEL[t]}</option>)}
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
        compromissos.length === 0 ? (
          <Card><CardContent className="py-20 text-center text-muted-foreground">Nenhum compromisso encontrado.</CardContent></Card>
        ) : (
          <KanbanView compromissos={compromissos} onEditar={onEditar} onVerTriagem={setTriagemId} onStatus={onStatus} />
        )
      ) : (
        <CalendarioView compromissos={compromissos} mes={mes} onMudarMes={mudarMes} onSelecionar={onEditar} />
      )}

      {/* Gaveta de criar/editar */}
      <CompromissoFormDrawer open={formOpen} onClose={() => setFormOpen(false)} onSalvo={invalidar} editar={editar} />

      {/* Ponte com a triagem: mesma gaveta do módulo de atendimentos */}
      <AtendimentoDrawer atendimentoId={triagemId} open={!!triagemId} onClose={() => setTriagemId(null)} />
    </div>
  );
}
