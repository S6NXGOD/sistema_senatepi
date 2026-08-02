'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle, CalendarCheck, Gavel, Landmark, Loader2, MapPin, Users, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { listarResponsaveis } from '@/lib/agenda';
import { formatNPU } from '@/lib/processos';
import {
  agendarAudiencia, rotuloDataAudiencia, type AudienciaAAgendar,
} from '@/lib/audiencias';

const inputCls = 'h-12 w-full rounded-md border border-input bg-background px-3 text-base md:h-10 md:text-sm';

/** Data/hora locais de um ISO — para preencher os campos do formulário. */
function partesLocais(iso: string | null) {
  if (!iso) return { data: '', hora: '' };
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return {
    data: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    hora: `${p(d.getHours())}:${p(d.getMinutes())}`,
  };
}

/**
 * Confirmação do agendamento de uma audiência detectada no DataJud.
 *
 * O formulário já vem preenchido com o que o tribunal publicou — o usuário só
 * confirma (ou corrige) a data/hora e escolhe o responsável. Uma única chamada
 * cria o evento na Agenda e resolve o alerta.
 */
export function AgendarAudienciaModal({
  alerta,
  onClose,
  onAgendado,
}: {
  alerta: AudienciaAAgendar | null;
  onClose: () => void;
  onAgendado: () => void;
}) {
  const { user } = useAuth();
  const [data, setData] = useState('');
  const [hora, setHora] = useState('');
  const [duracao, setDuracao] = useState(60);
  const [responsavelId, setResponsavelId] = useState('');
  const [titulo, setTitulo] = useState('');
  const [local, setLocal] = useState('');
  const [urgente, setUrgente] = useState(false);

  const responsaveis = useQuery({
    queryKey: ['compromissos-responsaveis'],
    queryFn: listarResponsaveis,
    enabled: !!alerta,
  });

  useEffect(() => {
    if (!alerta) return;
    const p = partesLocais(alerta.audienciaData);
    setData(p.data);
    // Sem horário no texto do tribunal: sugere 09:00 em vez de meia-noite.
    setHora(alerta.horaDefinida ? p.hora : '09:00');
    setDuracao(60);
    // Responsável: o advogado do processo; senão, quem está agendando.
    setResponsavelId(alerta.processo.advogado?.id ?? user?.id ?? '');
    setTitulo(`Audiência — ${alerta.processo.classeProcessual || formatNPU(alerta.processo.numeroCNJ)}`);
    setLocal(alerta.processo.orgaoJulgador ?? '');
    setUrgente(alerta.dataNoPassado);
  }, [alerta, user]);

  const salvar = useMutation({
    mutationFn: () => {
      const inicio = new Date(`${data}T${hora || '09:00'}`);
      return agendarAudiencia(alerta!.id, {
        inicio: inicio.toISOString(),
        fim: new Date(inicio.getTime() + duracao * 60_000).toISOString(),
        responsavelId,
        titulo: titulo.trim() || undefined,
        local: local.trim() || undefined,
        urgente,
      });
    },
    onSuccess: () => {
      toast.success('Audiência agendada e alerta resolvido.');
      onAgendado();
      onClose();
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message ?? 'Não foi possível agendar a audiência.'),
  });

  function submeter() {
    if (!data) return toast.error('Informe a data da audiência.');
    if (!responsavelId) return toast.error('Selecione o responsável.');
    if (isNaN(new Date(`${data}T${hora || '09:00'}`).getTime())) {
      return toast.error('Data ou hora inválida.');
    }
    salvar.mutate();
  }

  if (!alerta) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={salvar.isPending ? undefined : onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl bg-card shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 dark:bg-violet-900/30">
              <Gavel className="h-5 w-5 text-violet-700 dark:text-violet-300" />
            </div>
            <div>
              <h3 className="text-lg font-bold leading-tight">Agendar audiência</h3>
              <p className="text-xs text-muted-foreground">Detectada no DataJud · vai para a Agenda</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {/* O que o tribunal publicou — a fonte da sugestão */}
          <section className="rounded-xl border border-violet-200 bg-violet-50/60 p-3 dark:border-violet-900/50 dark:bg-violet-950/20">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-violet-800 dark:text-violet-300">
              <Landmark className="h-3.5 w-3.5" /> Movimentação do DataJud
              {alerta.codigoMovimento != null && (
                <span className="rounded bg-violet-200/70 px-1.5 py-px font-mono text-[10px] dark:bg-violet-900/50">
                  TPU {alerta.codigoMovimento}
                </span>
              )}
            </p>
            <p className="mt-1 text-sm leading-snug">{alerta.descricao}</p>
            <p className="mt-1.5 font-mono text-xs text-muted-foreground">
              {formatNPU(alerta.processo.numeroCNJ)}
              {alerta.processo.filiado ? ` · ${alerta.processo.filiado.nomeCompleto}` : ''}
            </p>
            <p className="mt-1 text-xs text-violet-800 dark:text-violet-300">
              Data lida do texto: <strong>{rotuloDataAudiencia(alerta)}</strong>
              {!alerta.horaDefinida && alerta.audienciaData && ' — sem horário publicado, confirme abaixo'}
            </p>
          </section>

          {alerta.eventoExistente && (
            <p className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Já existe o evento <strong>{alerta.eventoExistente.titulo}</strong> neste processo no mesmo
              dia. Confirme se não é a mesma audiência antes de criar outra.
            </p>
          )}

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Título</label>
            <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-1">
              <label className="text-sm font-medium">Data *</label>
              <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Hora *</label>
              <Input type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Duração</label>
              <select className={inputCls} value={duracao} onChange={(e) => setDuracao(Number(e.target.value))}>
                <option value={30}>30 min</option>
                <option value={60}>1 hora</option>
                <option value={120}>2 horas</option>
                <option value={240}>4 horas</option>
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-sm font-medium">
              <Users className="h-4 w-4 text-muted-foreground" /> Responsável *
            </label>
            <select className={inputCls} value={responsavelId} onChange={(e) => setResponsavelId(e.target.value)}>
              <option value="">Selecione…</option>
              {(responsaveis.data ?? []).map((r) => (
                <option key={r.id} value={r.id}>{r.nome}</option>
              ))}
            </select>
            {!alerta.processo.advogado && (
              <p className="text-xs text-muted-foreground">
                Este processo não tem advogado vinculado — escolha quem responderá pela audiência.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-sm font-medium">
              <MapPin className="h-4 w-4 text-muted-foreground" /> Local
            </label>
            <Input value={local} onChange={(e) => setLocal(e.target.value)} placeholder="Órgão julgador" />
          </div>

          <button
            type="button"
            onClick={() => setUrgente((v) => !v)}
            className="flex w-full items-center justify-between rounded-lg border p-3 text-left transition-colors hover:bg-muted/40"
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <AlertTriangle className={cn('h-4 w-4', urgente ? 'text-red-600' : 'text-muted-foreground')} />
              Marcar como urgente
            </span>
            <span className={cn('relative h-6 w-11 rounded-full transition-colors', urgente ? 'bg-red-600' : 'bg-muted')}>
              <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', urgente ? 'left-[22px]' : 'left-0.5')} />
            </span>
          </button>
        </div>

        <div className="flex justify-end gap-2 border-t bg-muted/30 p-4">
          <Button variant="outline" onClick={onClose} disabled={salvar.isPending}>Cancelar</Button>
          <Button onClick={submeter} disabled={salvar.isPending}>
            {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarCheck className="h-4 w-4" />}
            Agendar na Agenda
          </Button>
        </div>
      </div>
    </div>
  );
}
