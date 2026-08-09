'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { X, Plus, Loader2, Save, CalendarClock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  listarAdvogadosEscala, criarEscalas, EscalaItemInput,
} from '@/lib/escalas';

const inputCls = 'h-12 w-full rounded-md border border-input bg-background px-3 text-base md:h-10 md:text-sm';

interface Linha { data: string; horaInicio: string; horaFim: string; observacao: string }

function hoje() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const novaLinha = (data?: string): Linha => ({ data: data ?? hoje(), horaInicio: '08:00', horaFim: '17:00', observacao: '' });

export function NovaEscalaModal({
  open, onClose, onSalvo, dataPre,
}: {
  open: boolean;
  onClose: () => void;
  onSalvo: () => void;
  dataPre?: string | null;
}) {
  const [advogadoId, setAdvogadoId] = useState('');
  const [linhas, setLinhas] = useState<Linha[]>([novaLinha()]);

  const advogados = useQuery({ queryKey: ['escalas-advogados'], queryFn: listarAdvogadosEscala, enabled: open });

  useEffect(() => {
    if (open) {
      setAdvogadoId('');
      setLinhas([novaLinha(dataPre ?? undefined)]);
    }
  }, [open, dataPre]);

  const set = (i: number, campo: keyof Linha, valor: string) =>
    setLinhas((ls) => ls.map((l, k) => (k === i ? { ...l, [campo]: valor } : l)));
  const addLinha = () => setLinhas((ls) => [...ls, novaLinha(ls[ls.length - 1]?.data)]);
  const remLinha = (i: number) => setLinhas((ls) => (ls.length > 1 ? ls.filter((_, k) => k !== i) : ls));

  const salvar = useMutation({
    mutationFn: () => {
      const itens: EscalaItemInput[] = linhas
        .filter((l) => l.data)
        .map((l) => ({ data: l.data, horaInicio: l.horaInicio, horaFim: l.horaFim, observacao: l.observacao.trim() || undefined }));
      return criarEscalas(advogadoId, itens);
    },
    onSuccess: (r) => {
      toast.success(`${r.criadas} escala(s) cadastrada(s).`);
      onSalvo();
      onClose();
    },
    onError: (e: any) => {
      const m = e?.response?.data?.message;
      toast.error(Array.isArray(m) ? m[0] : m ?? 'Não foi possível salvar as escalas.');
    },
  });

  function submeter() {
    if (!advogadoId) return toast.error('Selecione o advogado responsável.');
    const validas = linhas.filter((l) => l.data);
    if (validas.length === 0) return toast.error('Adicione ao menos uma data.');
    for (const l of validas) {
      if (l.horaFim <= l.horaInicio) return toast.error(`Em ${l.data}, o fim deve ser após o início.`);
    }
    salvar.mutate();
  }

  if (!open) return null;
  const qtd = linhas.filter((l) => l.data).length;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={salvar.isPending ? undefined : onClose}>
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-card shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-900/30">
              <CalendarClock className="h-5 w-5 text-brand-800 dark:text-brand-400" />
            </div>
            <div>
              <h3 className="text-lg font-bold">Cadastrar Escalas</h3>
              <p className="text-sm text-muted-foreground">Selecione o responsável e adicione as datas e horários.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {/* Responsável */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Responsável *</label>
            <select className={inputCls} value={advogadoId} onChange={(e) => setAdvogadoId(e.target.value)}>
              <option value="">Selecionar advogado…</option>
              {(advogados.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>{a.nomeExibicao || a.nome}</option>
              ))}
            </select>
          </div>

          {/* Datas e horários */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold">Datas e Horários</label>
              <Button variant="outline" size="sm" onClick={addLinha}><Plus className="h-4 w-4" /> Adicionar data</Button>
            </div>

            {/* Cabeçalho das colunas (desktop) */}
            <div className="hidden grid-cols-[1fr_auto_auto_1fr_auto] items-center gap-2 px-1 text-xs font-medium text-muted-foreground sm:grid">
              <span>Data *</span><span>Início *</span><span>Fim *</span><span>Obs.</span><span />
            </div>

            {linhas.map((l, i) => (
              <div key={i} className="grid grid-cols-2 items-center gap-2 rounded-lg border p-2 sm:grid-cols-[1fr_auto_auto_1fr_auto] sm:border-0 sm:p-0">
                <Input type="date" value={l.data} onChange={(e) => set(i, 'data', e.target.value)} className="col-span-2 sm:col-span-1" />
                <Input type="time" value={l.horaInicio} onChange={(e) => set(i, 'horaInicio', e.target.value)} className="w-full sm:w-24" />
                <Input type="time" value={l.horaFim} onChange={(e) => set(i, 'horaFim', e.target.value)} className="w-full sm:w-24" />
                <Input placeholder="Opcional" value={l.observacao} onChange={(e) => set(i, 'observacao', e.target.value)} className="col-span-2 sm:col-span-1" />
                <button
                  type="button"
                  onClick={() => remLinha(i)}
                  disabled={linhas.length === 1}
                  className="col-span-2 flex h-9 items-center justify-center rounded-md text-muted-foreground hover:bg-red-50 hover:text-red-600 disabled:opacity-40 sm:col-span-1 sm:w-9"
                  title="Remover data"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t bg-muted/30 p-4">
          <Button variant="outline" onClick={onClose} disabled={salvar.isPending}>Cancelar</Button>
          <Button onClick={submeter} disabled={salvar.isPending}>
            {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar {qtd} escala(s)
          </Button>
        </div>
      </div>
    </div>
  );
}
