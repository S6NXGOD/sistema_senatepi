'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, Bell, ChevronDown, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  listarAlertas, Compromisso, TIPO_LABEL, TIPO_COR,
  formatData, formatHora, tempoRelativo,
} from '@/lib/agenda';

function ItemAlerta({ c, onAbrir }: { c: Compromisso; onAbrir: (c: Compromisso) => void }) {
  const cor = TIPO_COR[c.tipo];
  return (
    <button
      type="button"
      onClick={() => onAbrir(c)}
      className="flex w-full items-center justify-between gap-3 border-t px-4 py-2.5 text-left transition-colors hover:bg-muted/50 first:border-t-0"
    >
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 truncate text-sm font-medium">
          <span className="truncate">{c.titulo}</span>
          {c.urgente && (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-300">
              <AlertTriangle className="h-2.5 w-2.5" /> Urgente
            </span>
          )}
          <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium', cor.badge)}>{TIPO_LABEL[c.tipo]}</span>
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {formatData(c.inicio)}, {formatHora(c.inicio)}
          {c.filiado ? ` · ${c.filiado.nomeCompleto}` : ''}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        {c.responsavel.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.responsavel.avatarUrl} alt="" className="h-5 w-5 rounded-full border object-cover" />
        ) : (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-senatepi-400 text-[10px] font-bold text-senatepi-900">
            {c.responsavel.nome.charAt(0)}
          </span>
        )}
        <span className="whitespace-nowrap font-medium">{tempoRelativo(c.inicio)}</span>
      </div>
    </button>
  );
}

/** Barra de alertas: "Aguardando interação" (+3h) e "Próximas 24 horas". */
export function AlertasBar({ onAbrir }: { onAbrir: (c: Compromisso) => void }) {
  const { data } = useQuery({
    queryKey: ['agenda-alertas'],
    queryFn: listarAlertas,
    refetchInterval: 60_000,
  });
  const [aberto, setAberto] = useState<'aguardando' | '24h' | null>(null);

  const aguardando = data?.aguardando ?? [];
  const proximas = data?.proximas24h ?? [];
  if (aguardando.length === 0 && proximas.length === 0) return null;

  const toggle = (k: 'aguardando' | '24h') => setAberto((cur) => (cur === k ? null : k));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground">Alertas:</span>
        {aguardando.length > 0 && (
          <button
            type="button"
            onClick={() => toggle('aguardando')}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors',
              'border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300',
            )}
          >
            <Clock className="h-4 w-4" /> Aguardando
            <span className="rounded-full bg-red-600 px-1.5 text-xs font-bold text-white">{aguardando.length}</span>
            <ChevronDown className={cn('h-4 w-4 transition-transform', aberto === 'aguardando' && 'rotate-180')} />
          </button>
        )}
        {proximas.length > 0 && (
          <button
            type="button"
            onClick={() => toggle('24h')}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors',
              'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 dark:border-sky-900/40 dark:bg-sky-950/30 dark:text-sky-300',
            )}
          >
            <Bell className="h-4 w-4" /> 24h
            <span className="rounded-full bg-sky-600 px-1.5 text-xs font-bold text-white">{proximas.length}</span>
            <ChevronDown className={cn('h-4 w-4 transition-transform', aberto === '24h' && 'rotate-180')} />
          </button>
        )}
      </div>

      {aberto === 'aguardando' && aguardando.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-red-200 bg-card dark:border-red-900/40">
          <div className="bg-red-50 px-4 py-2 dark:bg-red-950/20">
            <p className="text-sm font-semibold text-red-800 dark:text-red-300">Aguardando interação</p>
            <p className="text-xs text-red-600/80 dark:text-red-400/80">Passaram do horário há mais de 3h sem conclusão.</p>
          </div>
          {aguardando.map((c) => <ItemAlerta key={c.id} c={c} onAbrir={onAbrir} />)}
        </div>
      )}

      {aberto === '24h' && proximas.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-sky-200 bg-card dark:border-sky-900/40">
          <div className="bg-sky-50 px-4 py-2 dark:bg-sky-950/20">
            <p className="text-sm font-semibold text-sky-800 dark:text-sky-300">Próximas 24 horas</p>
            <p className="text-xs text-sky-600/80 dark:text-sky-400/80">Atividades agendadas para as próximas 24h.</p>
          </div>
          {proximas.map((c) => <ItemAlerta key={c.id} c={c} onAbrir={onAbrir} />)}
        </div>
      )}
    </div>
  );
}
