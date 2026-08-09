'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle, CalendarClock, CalendarPlus, CopyCheck, Eye, Gavel, Loader2, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatNPU } from '@/lib/processos';
import {
  dispensarAudiencia, listarAudienciasAAgendar, restaurarAudiencia,
  prazoAudiencia, rotuloDataAudiencia, tomAudiencia,
  type AudienciaAAgendar,
} from '@/lib/audiencias';
import { AgendarAudienciaModal } from './agendar-audiencia-modal';
import { V } from '@/lib/vocabulario';

/**
 * Painel "Audiências a Agendar".
 *
 * Cada cartão é uma movimentação do DataJud que DESIGNOU pauta e ainda não tem
 * evento na Agenda. As três ações resolvem o alerta de vez: agendar (cria o
 * evento), ver o processo, ou dispensar (gravado no banco — não volta na
 * varredura noturna).
 *
 * Pode receber os dados prontos (a home já os traz no /dashboard/resumo) ou
 * buscá-los sozinho (tela de Processos).
 */
export function AudienciasAgendarPanel({
  dados,
  onVerProcesso,
  className,
}: {
  dados?: { items: AudienciaAAgendar[]; total: number };
  onVerProcesso?: (processoId: string) => void;
  className?: string;
}) {
  const qc = useQueryClient();
  const autoBusca = !dados;

  const consulta = useQuery({
    queryKey: ['audiencias-a-agendar'],
    queryFn: () => listarAudienciasAAgendar({ limite: 20 }),
    enabled: autoBusca,
  });

  const items = dados?.items ?? consulta.data?.items ?? [];
  const total = dados?.total ?? consulta.data?.total ?? 0;

  const [agendando, setAgendando] = useState<AudienciaAAgendar | null>(null);
  const [dispensando, setDispensando] = useState<AudienciaAAgendar | null>(null);
  const [motivo, setMotivo] = useState('');

  const atualizar = () => {
    qc.invalidateQueries({ queryKey: ['audiencias-a-agendar'] });
    qc.invalidateQueries({ queryKey: ['dashboard-resumo'] });
    qc.invalidateQueries({ queryKey: ['compromissos'] });
  };

  const dispensar = useMutation({
    mutationFn: (a: AudienciaAAgendar) => dispensarAudiencia(a.id, motivo.trim() || undefined),
    onSuccess: (_r, a) => {
      setDispensando(null);
      setMotivo('');
      atualizar();
      // Dispensa é definitiva no banco — o desfazer imediato evita o clique errado.
      toast.success('Alerta dispensado.', {
        action: {
          label: 'Desfazer',
          onClick: async () => {
            try {
              await restaurarAudiencia(a.id);
              atualizar();
              toast.success('Alerta restaurado.');
            } catch {
              toast.error('Não foi possível restaurar o alerta.');
            }
          },
        },
      });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível dispensar o alerta.'),
  });

  if (autoBusca && consulta.isLoading) return null;
  if (!items.length) return null;

  const ocultos = total - items.length;

  return (
    <>
      <section
        className={cn(
          'overflow-hidden rounded-xl border border-amber-300 bg-amber-50/60 dark:border-amber-900/50 dark:bg-amber-950/20',
          className,
        )}
      >
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 px-4 py-3 dark:border-amber-900/50">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <h3 className="text-sm font-bold text-amber-900 dark:text-amber-200">
                {total} audiência{total === 1 ? '' : 's'} aguarda{total === 1 ? '' : 'm'} agendamento
              </h3>
              <p className="text-xs text-amber-800/80 dark:text-amber-300/70">
                Designadas nas movimentações do DataJud e ainda sem evento na Agenda.
              </p>
            </div>
          </div>
          <Link
            href="/agenda"
            className="flex items-center gap-1 text-xs font-semibold text-amber-900 underline-offset-2 hover:underline dark:text-amber-200"
          >
            <CalendarClock className="h-3.5 w-3.5" /> Ver Agenda
          </Link>
        </header>

        <ul className="divide-y divide-amber-200/70 dark:divide-amber-900/40">
          {items.map((a) => (
            <li key={a.id}>
              <CartaoAudiencia
                a={a}
                onAgendar={() => setAgendando(a)}
                onDispensar={() => { setMotivo(''); setDispensando(a); }}
                onVerProcesso={onVerProcesso}
              />
            </li>
          ))}
        </ul>

        {ocultos > 0 && (
          <p className="border-t border-amber-200 px-4 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:text-amber-300">
            + {ocultos} audiência{ocultos === 1 ? '' : 's'} não exibida{ocultos === 1 ? '' : 's'} —{' '}
            <Link href="/processos" className="font-semibold underline underline-offset-2">
              ver em Processos
            </Link>
          </p>
        )}
      </section>

      <AgendarAudienciaModal
        alerta={agendando}
        onClose={() => setAgendando(null)}
        onAgendado={atualizar}
      />

      {/* Dispensa — grava no banco, então pede confirmação e um motivo opcional. */}
      {dispensando && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
          onClick={dispensar.isPending ? undefined : () => setDispensando(null)}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-t-2xl bg-card shadow-xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 p-5">
              <div className="shrink-0 rounded-xl bg-amber-100 p-2 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400">
                <X className="h-6 w-6" />
              </div>
              <div className="flex-1 space-y-1">
                <h3 className="font-semibold leading-tight">Dispensar este alerta</h3>
                <p className="text-sm text-muted-foreground">
                  O alerta some do painel e <strong>não volta</strong> na sincronização noturna do
                  DataJud. Use quando a movimentação não for audiência a agendar ou quando o
                  compromisso já estiver controlado fora do sistema.
                </p>
              </div>
            </div>
            <div className="space-y-1.5 px-5 pb-4">
              <label className="text-sm font-medium">Motivo <span className="font-normal text-muted-foreground">(opcional, fica na auditoria)</span></label>
              <textarea
                className="min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm"
                placeholder="Ex.: audiência já pautada na agenda física da coordenação."
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2 border-t bg-muted/30 p-4">
              <Button variant="outline" onClick={() => setDispensando(null)} disabled={dispensar.isPending}>
                Cancelar
              </Button>
              <Button onClick={() => dispensar.mutate(dispensando)} disabled={dispensar.isPending}>
                {dispensar.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Dispensar alerta
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function CartaoAudiencia({
  a,
  onAgendar,
  onDispensar,
  onVerProcesso,
}: {
  a: AudienciaAAgendar;
  onAgendar: () => void;
  onDispensar: () => void;
  onVerProcesso?: (processoId: string) => void;
}) {
  const vermelho = tomAudiencia(a) === 'vermelho';
  const prazo = prazoAudiencia(a);

  return (
    <article className="bg-card/70 px-4 py-3">
      <div className={cn('border-l-4 pl-3', vermelho ? 'border-l-red-500' : 'border-l-amber-500')}>
        {/* Selos: tipo, data designada, urgência e código TPU */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
            <Gavel className="h-3 w-3" /> Audiência
          </span>
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[11px] font-semibold',
              vermelho
                ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
            )}
          >
            {rotuloDataAudiencia(a)}
          </span>
          {prazo && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {prazo}
            </span>
          )}
          {a.dataNoPassado && (
            <span className="rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white">
              Data já passou
            </span>
          )}
          {a.eventoExistente && (
            <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
              <CopyCheck className="h-3 w-3" /> Possível duplicidade
            </span>
          )}
          {a.codigoMovimento != null && (
            <span className="ml-auto rounded bg-muted px-1.5 py-px font-mono text-[10px] text-muted-foreground">
              TPU {a.codigoMovimento}
            </span>
          )}
        </div>

        {/* Quem e onde */}
        <p className="mt-1.5 text-sm">
          <span className="text-muted-foreground">{V.Filiado}: </span>
          <strong>{a.processo.filiado?.nomeCompleto ?? 'não vinculado'}</strong>
          <span className="text-muted-foreground"> · Responsável: </span>
          {a.processo.advogado?.nome ?? <span className="text-amber-700 dark:text-amber-400">sem advogado</span>}
        </p>
        <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
          {formatNPU(a.processo.numeroCNJ)}
          {a.processo.orgaoJulgador ? ` · ${a.processo.orgaoJulgador}` : ''}
        </p>

        {/* Texto original do tribunal — é a prova do alerta */}
        <p className="mt-1.5 line-clamp-2 text-xs italic text-muted-foreground" title={a.descricao}>
          {a.descricao}
        </p>

        {/* Ações */}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={onAgendar}>
            <CalendarPlus className="h-4 w-4" /> Agendar
          </Button>
          {onVerProcesso ? (
            <Button size="sm" variant="outline" onClick={() => onVerProcesso(a.processo.id)}>
              <Eye className="h-4 w-4" /> Ver detalhes
            </Button>
          ) : (
            <Link href="/processos">
              <Button size="sm" variant="outline">
                <Eye className="h-4 w-4" /> Ver detalhes
              </Button>
            </Link>
          )}
          <button
            type="button"
            onClick={onDispensar}
            className="flex items-center gap-1 px-1 text-xs font-medium text-muted-foreground transition-colors hover:text-red-600"
          >
            <X className="h-3.5 w-3.5" /> Dispensar
          </button>
        </div>
      </div>
    </article>
  );
}
