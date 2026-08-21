'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ClipboardList, Plus, Download, ChevronLeft, ChevronRight, CalendarDays, List, Loader2, Trash2, Clock, User,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { nivelEfetivo } from '@/lib/permissoes';
import { podeExcluir } from '@/lib/permissoes';
import { NovaEscalaModal } from '@/components/escalas/nova-escala-modal';
import { exportarEscalasPdf } from '@/lib/escalas-pdf';
import {
  listarEscalas, listarAdvogadosEscala, excluirEscala,
  montarCores, primeiroNome, chaveMes, rotuloMes, Escala, AdvogadoEscala,
} from '@/lib/escalas';

type Visao = 'calendario' | 'lista';
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const inputCls = 'h-9 rounded-md border border-input bg-background px-3 text-sm';

function mesmaData(a: Date, b: Date) {
  return a.getUTCFullYear() === b.getFullYear() && a.getUTCMonth() === b.getMonth() && a.getUTCDate() === b.getDate();
}

export default function EscalasPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  /**
   * A API agora barra de verdade (`@Modulo` em todo controller). Mostrar o
   * botão a quem só tem leitura faria a pessoa preencher o formulário
   * inteiro para levar 403 no fim — o gate da tela existe para isso, não
   * para segurança.
   */
  const podeEditar = nivelEfetivo(user?.role, user?.permissoes, 'escalas') === 'EDITAR';
  const ehAdmin = podeExcluir(user?.role);

  const [mes, setMes] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [visao, setVisao] = useState<Visao>('calendario');
  const [advogadoFiltro, setAdvogadoFiltro] = useState('');
  const [novaOpen, setNovaOpen] = useState(false);
  const [dataPre, setDataPre] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<{ escala: Escala; top: number; left: number } | null>(null);
  const [gerandoPdf, setGerandoPdf] = useState(false);

  const mesKey = chaveMes(mes);
  const advogadosQ = useQuery({ queryKey: ['escalas-advogados'], queryFn: listarAdvogadosEscala });
  const { data: escalas = [], isLoading } = useQuery({
    queryKey: ['escalas', mesKey, advogadoFiltro],
    queryFn: () => listarEscalas(mesKey, advogadoFiltro || undefined),
  });

  const invalidar = () => qc.invalidateQueries({ queryKey: ['escalas'] });

  const remover = useMutation({
    mutationFn: (id: string) => excluirEscala(id),
    onSuccess: () => { toast.success('Escala removida.'); setDetalhe(null); invalidar(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível remover.'),
  });

  // Advogados distintos escalados no mês (para a legenda + cores estáveis).
  const escalados = useMemo(() => {
    const mapa = new Map<string, AdvogadoEscala>();
    for (const e of escalas) if (!mapa.has(e.advogado.id)) mapa.set(e.advogado.id, e.advogado);
    return [...mapa.values()].sort((a, b) => (a.nomeExibicao || a.nome).localeCompare(b.nomeExibicao || b.nome));
  }, [escalas]);
  const cores = useMemo(() => montarCores(escalados), [escalados]);

  // Grade do mês (42 células).
  const celulas = useMemo(() => {
    const primeiro = new Date(mes.getFullYear(), mes.getMonth(), 1);
    const ini = new Date(primeiro);
    ini.setDate(1 - primeiro.getDay());
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(ini); d.setDate(ini.getDate() + i); return d; });
  }, [mes]);

  const doDia = (dia: Date) => escalas.filter((e) => mesmaData(new Date(e.data), dia));
  const hoje = new Date();

  function mudarMes(delta: number) { setMes((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1)); }
  function novaEm(dia?: Date) {
    if (dia) { const p = (n: number) => String(n).padStart(2, '0'); setDataPre(`${dia.getFullYear()}-${p(dia.getMonth() + 1)}-${p(dia.getDate())}`); }
    else setDataPre(null);
    setNovaOpen(true);
  }
  function abrirDetalhe(e: React.MouseEvent, escala: Escala) {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDetalhe({ escala, top: r.bottom + 4, left: Math.min(r.left, window.innerWidth - 230) });
  }
  async function exportar() {
    if (escalas.length === 0) return toast.error('Não há escalas para exportar neste mês.');
    setGerandoPdf(true);
    try { await exportarEscalasPdf(rotuloMes(mes), escalas); } catch { toast.error('Falha ao gerar o PDF.'); } finally { setGerandoPdf(false); }
  }

  return (
    <div className="space-y-5">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-900/30">
            <ClipboardList className="h-5 w-5 text-brand-800 dark:text-brand-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">Escalas dos Advogados</h2>
            <p className="text-sm text-muted-foreground">Gerencie as escalas de plantão e expediente da equipe jurídica</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={exportar} disabled={gerandoPdf}>
            {gerandoPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Exportar PDF
          </Button>
          {podeEditar && (
          <Button onClick={() => novaEm()}><Plus className="h-4 w-4" /> Nova Escala</Button>
        )}
        </div>
      </div>

      {/* Toolbar: mês + filtro + visão */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-lg border border-input bg-card">
            <button onClick={() => mudarMes(-1)} className="flex h-9 w-9 items-center justify-center text-muted-foreground hover:text-foreground" aria-label="Mês anterior"><ChevronLeft className="h-4 w-4" /></button>
            <span className="min-w-[120px] px-2 text-center text-sm font-semibold">{rotuloMes(mes)}</span>
            <button onClick={() => mudarMes(1)} className="flex h-9 w-9 items-center justify-center text-muted-foreground hover:text-foreground" aria-label="Próximo mês"><ChevronRight className="h-4 w-4" /></button>
          </div>
          <select className={inputCls} value={advogadoFiltro} onChange={(e) => setAdvogadoFiltro(e.target.value)}>
            <option value="">Todos os advogados</option>
            {(advogadosQ.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.nomeExibicao || a.nome}</option>)}
          </select>
        </div>
        <div className="flex rounded-lg border border-input bg-card p-1">
          <button onClick={() => { setVisao('calendario'); setDetalhe(null); }} className={cn('flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors', visao === 'calendario' ? 'bg-brand-800 text-white shadow-sm' : 'text-muted-foreground hover:bg-muted')}>
            <CalendarDays className="h-4 w-4" /> Calendário
          </button>
          <button onClick={() => { setVisao('lista'); setDetalhe(null); }} className={cn('flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors', visao === 'lista' ? 'bg-brand-800 text-white shadow-sm' : 'text-muted-foreground hover:bg-muted')}>
            <List className="h-4 w-4" /> Lista
          </button>
        </div>
      </div>

      {/* Legenda + stats */}
      {escalados.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {escalados.map((a) => (
            <span key={a.id} className="inline-flex items-center gap-1.5 text-sm">
              <span className={cn('h-3 w-3 rounded-full', cores[a.id]?.dot)} /> {a.nomeExibicao || a.nome}
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <span className="rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">{escalas.length} escala(s) em {rotuloMes(mes).split(' ')[0]}</span>
        <span className="rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">{escalados.length} advogado(s) escalado(s)</span>
      </div>

      {/* Conteúdo */}
      {isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-800 dark:text-brand-400" /></div>
      ) : visao === 'calendario' ? (
        <Card className="overflow-hidden p-0">
          <div className="grid grid-cols-7 border-b text-center text-xs font-medium text-muted-foreground">
            {DIAS.map((d) => <div key={d} className="py-2">{d}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {celulas.map((dia, i) => {
              const foraDoMes = dia.getMonth() !== mes.getMonth();
              const ehHoje = mesmaData(new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())), dia);
              const itens = doDia(dia);
              return (
                <div
                  key={i}
                  onClick={() => !foraDoMes && ehAdmin && novaEm(dia)}
                  className={cn('min-h-[104px] border-b border-r p-1 last:border-r-0 [&:nth-child(7n)]:border-r-0', foraDoMes ? 'bg-muted/20' : ehAdmin && 'cursor-pointer hover:bg-muted/30')}
                >
                  <div className={cn('mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs', ehHoje ? 'bg-brand-800 font-bold text-white' : foraDoMes ? 'text-muted-foreground/40' : 'text-muted-foreground')}>
                    {dia.getDate()}
                  </div>
                  <div className="space-y-0.5">
                    {itens.slice(0, 4).map((e) => (
                      <button
                        key={e.id}
                        type="button"
                        onClick={(ev) => abrirDetalhe(ev, e)}
                        title={`${e.advogado.nomeExibicao || e.advogado.nome} · ${e.horaInicio}–${e.horaFim}${e.observacao ? ` · ${e.observacao}` : ''}`}
                        className={cn('block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium text-white', cores[e.advogado.id]?.bg ?? 'bg-slate-500')}
                      >
                        {primeiroNome(e.advogado)} -{e.horaInicio}
                      </button>
                    ))}
                    {itens.length > 4 && <p className="px-1 text-[10px] text-muted-foreground">+{itens.length - 4}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          {escalas.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">Nenhuma escala neste mês.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Data</th>
                    <th className="px-4 py-3 font-medium">Advogado</th>
                    <th className="px-4 py-3 font-medium">Horário</th>
                    <th className="px-4 py-3 font-medium">Observação</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {escalas.map((e) => (
                    <tr key={e.id} className="hover:bg-muted/30">
                      <td className="whitespace-nowrap px-4 py-2.5">{new Date(e.data).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' })}</td>
                      <td className="px-4 py-2.5">
                        <span className="inline-flex items-center gap-2">
                          <span className={cn('h-2.5 w-2.5 rounded-full', cores[e.advogado.id]?.dot ?? 'bg-slate-500')} />
                          {e.advogado.nomeExibicao || e.advogado.nome}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">{e.horaInicio} – {e.horaFim}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{e.observacao || '—'}</td>
                      <td className="px-4 py-2.5 text-right">
                        {ehAdmin && (
                          <button type="button" onClick={() => remover.mutate(e.id)} className="rounded p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30" title="Excluir">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Popover de detalhe (clique numa barra) */}
      {detalhe && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setDetalhe(null)} />
          <div className="fixed z-50 w-56 rounded-lg bg-slate-900 p-3 text-white shadow-xl" style={{ top: detalhe.top, left: detalhe.left }}>
            <p className="flex items-center gap-1.5 text-sm font-semibold"><User className="h-3.5 w-3.5" /> {detalhe.escala.advogado.nomeExibicao || detalhe.escala.advogado.nome}</p>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-300"><Clock className="h-3.5 w-3.5" /> {detalhe.escala.horaInicio} – {detalhe.escala.horaFim}</p>
            {detalhe.escala.observacao && <p className="mt-1 text-xs text-slate-400">{detalhe.escala.observacao}</p>}
            {ehAdmin && (
              <button
                type="button"
                onClick={() => remover.mutate(detalhe.escala.id)}
                disabled={remover.isPending}
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md bg-red-600 px-2 py-1.5 text-xs font-medium hover:bg-red-700 disabled:opacity-60"
              >
                {remover.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Excluir
              </button>
            )}
          </div>
        </>
      )}

      <NovaEscalaModal open={novaOpen} onClose={() => setNovaOpen(false)} onSalvo={invalidar} dataPre={dataPre} />
    </div>
  );
}
