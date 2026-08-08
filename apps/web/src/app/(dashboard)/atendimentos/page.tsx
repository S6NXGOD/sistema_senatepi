'use client';

import { Suspense, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Loader2, Search, Plus, Headset, ChevronLeft, ChevronRight, Inbox, MoreVertical,
  Eye, Gavel, CheckCircle2, XCircle, RotateCcw, Trash2,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { useAbrirPorUrl } from '@/lib/use-abrir-por-url';
import { podeExcluir } from '@/lib/permissoes';
import { NovoAtendimentoDrawer } from '@/components/atendimentos/novo-atendimento-drawer';
import { AtendimentoDrawer } from '@/components/atendimentos/atendimento-drawer';
import { RegistrarDesfechoModal, AtendimentoParaDesfecho } from '@/components/atendimentos/registrar-desfecho-modal';
import {
  listarAtendimentos, mudarStatusAtendimento, excluirAtendimento,
  CanalAtendimento, DesfechoAtendimento, StatusAtendimento, AtendimentoLista,
  CANAIS, CANAL_LABEL, DESFECHO_LABEL, DESFECHO_COR, STATUS_LABEL, STATUS_COR, formatDataHora,
} from '@/lib/atendimentos';

const PAGE_SIZE = 20;
const inputCls = 'h-12 rounded-md border border-input bg-background px-3 text-base sm:h-10 sm:text-sm';

/** Suspense obrigatório por causa do `useSearchParams` (ver useAbrirPorUrl). */
export default function AtendimentosPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-brand-800 dark:text-brand-400" />
        </div>
      }
    >
      <ListaAtendimentos />
    </Suspense>
  );
}

function ListaAtendimentos() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const ehAdmin = podeExcluir(user?.role);
  const [busca, setBusca] = useState('');
  const [buscaDeb, setBuscaDeb] = useState('');
  const [status, setStatus] = useState<'' | StatusAtendimento>('');
  const [desfecho, setDesfecho] = useState<'' | DesfechoAtendimento>('');
  const [canal, setCanal] = useState<'' | CanalAtendimento>('');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [page, setPage] = useState(1);

  const [novo, setNovo] = useState(false);
  const [detalheId, setDetalheId] = useState<string | null>(null);
  const [desfechoAlvo, setDesfechoAlvo] = useState<AtendimentoParaDesfecho | null>(null);
  const [promptConcluir, setPromptConcluir] = useState<{ id: string; resultado: DesfechoAtendimento } | null>(null);
  const [menu, setMenu] = useState<{ a: AtendimentoLista; top: number; left: number } | null>(null);
  const [excluirAlvo, setExcluirAlvo] = useState<AtendimentoLista | null>(null);

  /** `?atendimento=<id>` abre a triagem direto — mesmo padrão da agenda. */
  useAbrirPorUrl('atendimento', setDetalheId, '/atendimentos');

  useEffect(() => {
    const t = setTimeout(() => { setBuscaDeb(busca.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [busca]);
  useEffect(() => { setPage(1); }, [status, desfecho, canal, dataInicio, dataFim]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['atendimentos', buscaDeb, status, desfecho, canal, dataInicio, dataFim, page],
    queryFn: () => listarAtendimentos({
      busca: buscaDeb || undefined, status: status || undefined, desfecho: desfecho || undefined,
      canal: canal || undefined, dataInicio: dataInicio || undefined, dataFim: dataFim || undefined,
      page, pageSize: PAGE_SIZE,
    }),
  });

  const invalidar = () => qc.invalidateQueries({ queryKey: ['atendimentos'] });
  const itens = data?.items ?? [];
  const totalPaginas = data?.totalPaginas ?? 1;

  const mudarStatus = useMutation({
    mutationFn: ({ id, s }: { id: string; s: StatusAtendimento }) => mudarStatusAtendimento(id, s),
    onSuccess: () => { invalidar(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível mudar o status.'),
  });
  const excluir = useMutation({
    mutationFn: (id: string) => excluirAtendimento(id),
    onSuccess: () => { toast.success('Atendimento excluído.'); setExcluirAlvo(null); invalidar(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível excluir.'),
  });

  function abrirDesfecho(a: AtendimentoLista) {
    setMenu(null);
    setDesfechoAlvo({ id: a.id, numero: a.numero, descricao: a.descricao, filiado: { id: a.filiado.id, nomeCompleto: a.filiado.nomeCompleto } });
  }
  function abrirMenu(e: React.MouseEvent, a: AtendimentoLista) {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ a, top: r.bottom + 4, left: Math.min(r.left - 150, window.innerWidth - 210) });
  }

  const ResultadoCel = ({ a }: { a: AtendimentoLista }) =>
    a.desfecho ? (
      <Badge className={DESFECHO_COR[a.desfecho]}>{DESFECHO_LABEL[a.desfecho]}</Badge>
    ) : (
      <span className="text-sm italic text-muted-foreground">Pendente</span>
    );

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-900/30">
            <Headset className="h-5 w-5 text-brand-800 dark:text-brand-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">Triagem / Atendimento</h2>
            <p className="text-sm text-muted-foreground">Registre e acompanhe os atendimentos realizados</p>
          </div>
        </div>
        <Button onClick={() => setNovo(true)}><Plus className="h-4 w-4" /> Novo Atendimento</Button>
      </div>

      {/* Filtros */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar por filiado ou descrição…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          {isFetching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as any)} aria-label="Status">
            <option value="">Todos os status</option>
            <option value="PENDENTE">Pendente</option>
            <option value="CONCLUIDO">Concluído</option>
            <option value="CANCELADO">Cancelado</option>
          </select>
          <select className={inputCls} value={canal} onChange={(e) => setCanal(e.target.value as any)} aria-label="Canal">
            <option value="">Todos os canais</option>
            {CANAIS.map((c) => <option key={c} value={c}>{CANAL_LABEL[c]}</option>)}
          </select>
          <select className={inputCls} value={desfecho} onChange={(e) => setDesfecho(e.target.value as any)} aria-label="Desfecho">
            <option value="">Todos os desfechos</option>
            <option value="RESOLVIDO_ATO">{DESFECHO_LABEL.RESOLVIDO_ATO}</option>
            <option value="ENCAMINHADO">{DESFECHO_LABEL.ENCAMINHADO}</option>
          </select>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">De
            <input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} className={inputCls} />
          </label>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">até
            <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} className={inputCls} />
          </label>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-800 dark:text-brand-400" /></div>
      ) : itens.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center gap-2 py-20 text-center text-muted-foreground"><Inbox className="h-8 w-8 opacity-40" /> Nenhum atendimento encontrado com esses filtros.</CardContent></Card>
      ) : (
        <>
          {/* Mobile: cards */}
          <div className="space-y-3 md:hidden">
            {itens.map((a) => (
              <div key={a.id} className="rounded-xl border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <button type="button" onClick={() => setDetalheId(a.id)} className="min-w-0 flex-1 text-left">
                    <p className="truncate font-semibold">{a.filiado.nomeCompleto}</p>
                    <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{a.descricao}</p>
                  </button>
                  <button type="button" onClick={(e) => abrirMenu(e, a)} className="rounded p-1 text-muted-foreground hover:bg-muted"><MoreVertical className="h-4 w-4" /></button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <Badge className="bg-muted text-muted-foreground">{CANAL_LABEL[a.canal]}</Badge>
                  <ResultadoCel a={a} />
                  <Badge className={STATUS_COR[a.status]}>{STATUS_LABEL[a.status]}</Badge>
                  <span className="text-muted-foreground">{formatDataHora(a.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop: tabela */}
          <Card className="hidden overflow-hidden p-0 md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Filiado</th>
                    <th className="px-4 py-3 font-medium">Canal</th>
                    <th className="px-4 py-3 font-medium">Resultado</th>
                    <th className="px-4 py-3 font-medium">Descrição</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Data</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {itens.map((a) => (
                    <tr key={a.id} onClick={() => setDetalheId(a.id)} className="cursor-pointer transition-colors hover:bg-muted/40">
                      <td className="px-4 py-3 font-medium">{a.filiado.nomeCompleto}</td>
                      <td className="px-4 py-3 text-muted-foreground">{CANAL_LABEL[a.canal]}</td>
                      <td className="px-4 py-3"><ResultadoCel a={a} /></td>
                      <td className="max-w-[280px] px-4 py-3"><span className="line-clamp-1 text-muted-foreground">{a.descricao}</span></td>
                      <td className="px-4 py-3"><Badge className={STATUS_COR[a.status]}>{STATUS_LABEL[a.status]}</Badge></td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-muted-foreground">{formatDataHora(a.createdAt)}</td>
                      <td className="px-4 py-3 text-right">
                        <button type="button" onClick={(e) => abrirMenu(e, a)} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><MoreVertical className="h-4 w-4" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="text-sm text-muted-foreground">{data?.total ?? 0} atendimento(s) · página {data?.page ?? 1} de {totalPaginas}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1 || isFetching} onClick={() => setPage((p) => Math.max(1, p - 1))}><ChevronLeft className="h-4 w-4" /> Anterior</Button>
              <Button variant="outline" size="sm" disabled={page >= totalPaginas || isFetching} onClick={() => setPage((p) => Math.min(totalPaginas, p + 1))}>Próxima <ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        </>
      )}

      {/* Menu de ações (…) */}
      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} />
          <div className="fixed z-50 w-52 overflow-hidden rounded-lg border bg-card py-1 shadow-xl" style={{ top: menu.top, left: menu.left }}>
            <button type="button" onClick={() => { setDetalheId(menu.a.id); setMenu(null); }} className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm hover:bg-muted"><Eye className="h-4 w-4 text-muted-foreground" /> Ver detalhes</button>
            {!menu.a.desfecho && (
              <button type="button" onClick={() => abrirDesfecho(menu.a)} className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm hover:bg-muted"><Gavel className="h-4 w-4 text-brand-700 dark:text-brand-400" /> Registrar desfecho</button>
            )}
            {menu.a.desfecho && menu.a.status === 'PENDENTE' && (
              <button type="button" onClick={() => { mudarStatus.mutate({ id: menu.a.id, s: 'CONCLUIDO' }); setMenu(null); }} className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm hover:bg-muted"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Marcar como Concluído</button>
            )}
            {menu.a.status !== 'PENDENTE' && (
              <button type="button" onClick={() => { mudarStatus.mutate({ id: menu.a.id, s: 'PENDENTE' }); setMenu(null); }} className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm hover:bg-muted"><RotateCcw className="h-4 w-4 text-muted-foreground" /> Reabrir</button>
            )}
            {menu.a.status !== 'CANCELADO' && (
              <button type="button" onClick={() => { mudarStatus.mutate({ id: menu.a.id, s: 'CANCELADO' }); setMenu(null); }} className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/20"><XCircle className="h-4 w-4" /> Cancelar atendimento</button>
            )}
            {ehAdmin && (
              <button type="button" onClick={() => { setExcluirAlvo(menu.a); setMenu(null); }} className="flex w-full items-center gap-2.5 border-t px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"><Trash2 className="h-4 w-4" /> Excluir atendimento</button>
            )}
          </div>
        </>
      )}

      {/* Modais / gavetas */}
      <NovoAtendimentoDrawer open={novo} onClose={() => setNovo(false)} onCriado={invalidar} />
      <AtendimentoDrawer
        atendimentoId={detalheId}
        open={!!detalheId}
        onClose={() => setDetalheId(null)}
        onMudou={invalidar}
        onRegistrarDesfecho={(a) => { setDetalheId(null); setDesfechoAlvo(a); }}
      />
      <RegistrarDesfechoModal
        open={!!desfechoAlvo}
        atendimento={desfechoAlvo}
        onClose={() => setDesfechoAlvo(null)}
        onRegistrado={(resultado) => {
          invalidar();
          if (desfechoAlvo) setPromptConcluir({ id: desfechoAlvo.id, resultado });
        }}
      />

      {/* Prompt: concluir agora? */}
      <ConfirmDialog
        open={!!promptConcluir}
        title="Desfecho registrado!"
        icon={<CheckCircle2 className="h-6 w-6" />}
        description={
          <>O atendimento foi {promptConcluir?.resultado === 'RESOLVIDO_ATO' ? 'resolvido no ato' : 'encaminhado'}. Deseja marcar como <strong>Concluído</strong> agora? A demanda pode continuar pendente para acompanhamento.</>
        }
        confirmLabel="Concluir agora"
        cancelLabel="Deixar pendente"
        loading={mudarStatus.isPending}
        onConfirm={() => { if (promptConcluir) mudarStatus.mutate({ id: promptConcluir.id, s: 'CONCLUIDO' }); setPromptConcluir(null); }}
        onClose={() => setPromptConcluir(null)}
      />

      {/* Excluir atendimento (Administrador) */}
      <ConfirmDialog
        open={!!excluirAlvo}
        variant="destructive"
        title="Excluir atendimento"
        icon={<Trash2 className="h-6 w-6" />}
        description={
          <>
            Excluir o atendimento <strong>#{excluirAlvo?.numero}</strong> de <strong>{excluirAlvo?.filiado.nomeCompleto}</strong>?
            Os <strong>anexos</strong> serão removidos; eventuais <strong>consultas já criadas na Agenda</strong> permanecem
            (apenas perdem o vínculo com esta triagem). Esta ação é <strong>irreversível</strong>.
          </>
        }
        confirmLabel="Excluir atendimento"
        loading={excluir.isPending}
        onConfirm={() => excluirAlvo && excluir.mutate(excluirAlvo.id)}
        onClose={() => setExcluirAlvo(null)}
      />
    </div>
  );
}
