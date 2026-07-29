'use client';

import { useEffect, useState } from 'react';
import {
  Clock, MapPin, AlertTriangle, Pencil, Trash2, History, Timer,
  Play, CalendarClock, Gavel, RotateCcw, X, FileSearch,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Compromisso, StatusCompromisso, TIPO_LABEL, TIPO_COR,
  formatData, formatHora, estaAtrasado, duracaoDesde,
} from '@/lib/agenda';

/** Cronômetro ao vivo (atualiza a cada segundo) desde `iniciadoEm`. */
function Cronometro({ desde }: { desde: string }) {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
      <Timer className="h-3.5 w-3.5" /> {duracaoDesde(desde, agora)}
    </span>
  );
}

function AcaoBtn({
  onClick, children, tom = 'neutro',
}: {
  onClick: () => void;
  children: React.ReactNode;
  tom?: 'neutro' | 'primario' | 'perigo' | 'aviso';
}) {
  const cor = {
    neutro: 'border-input text-muted-foreground hover:bg-muted hover:text-foreground',
    primario: 'border-senatepi-300 text-senatepi-700 hover:bg-senatepi-50 dark:text-senatepi-400 dark:hover:bg-senatepi-900/20',
    perigo: 'border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900/40 dark:hover:bg-red-950/30',
    aviso: 'border-amber-300 text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/20',
  }[tom];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('inline-flex flex-1 items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors', cor)}
    >
      {children}
    </button>
  );
}

export function CompromissoCard({
  c, onEditar, onVerTriagem, onAcao, onExcluir, podeExcluir, draggable, onDragStart,
}: {
  c: Compromisso;
  onEditar: (c: Compromisso) => void;
  onVerTriagem: (atendimentoId: string) => void;
  onAcao: (id: string, status: StatusCompromisso) => void;
  onExcluir?: (c: Compromisso) => void;
  podeExcluir?: boolean;
  draggable?: boolean;
  onDragStart?: () => void;
}) {
  const cor = TIPO_COR[c.tipo];
  const atrasado = estaAtrasado(c);

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      className={cn('rounded-lg border border-l-4 bg-card p-3 shadow-sm', cor.borda, draggable && 'cursor-grab active:cursor-grabbing')}
    >
      {/* Cabeçalho: tipo + ações de edição */}
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', cor.badge)}>
            <Gavel className="h-3 w-3" /> {TIPO_LABEL[c.tipo]}
          </span>
          {c.urgente && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-300">
              <AlertTriangle className="h-3 w-3" /> Urgente
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button type="button" onClick={() => onEditar(c)} title="Editar" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          {podeExcluir && onExcluir && (
            <button type="button" onClick={() => onExcluir(c)} title="Excluir" className="rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <p className="line-clamp-2 text-sm font-semibold leading-tight">{c.titulo}</p>

      {c.status === 'EM_ANDAMENTO' && c.iniciadoEm && (
        <div className="mt-1"><Cronometro desde={c.iniciadoEm} /></div>
      )}

      <div className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
        <p className={cn('flex items-center gap-1', atrasado && 'font-medium text-red-600 dark:text-red-400')}>
          <Clock className="h-3 w-3 shrink-0" /> {formatData(c.inicio)}, {formatHora(c.inicio)}
        </p>
        {c.local && <p className="flex items-center gap-1 truncate"><MapPin className="h-3 w-3 shrink-0" /> {c.local}</p>}
        {c.filiado && <p className="truncate">Filiado: <span className="text-foreground">{c.filiado.nomeCompleto}</span></p>}
      </div>

      {/* Responsável (avatar) */}
      <div className="mt-2 flex items-center gap-1.5">
        {c.responsavel.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.responsavel.avatarUrl} alt="" className="h-5 w-5 rounded-full border object-cover" />
        ) : (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-senatepi-400 text-[10px] font-bold text-senatepi-900">
            {c.responsavel.nome.charAt(0)}
          </span>
        )}
        <span className="truncate text-xs text-muted-foreground">{c.responsavel.nome}</span>
      </div>

      {c.dataOriginal && (
        <p className="mt-2 flex items-center gap-1 rounded bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
          <History className="h-3 w-3 shrink-0" /> Remarcado. Original: {formatData(c.dataOriginal)}
        </p>
      )}

      {c.atendimentoId && (
        <button type="button" onClick={() => onVerTriagem(c.atendimentoId!)} className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-senatepi-700 hover:underline dark:text-senatepi-400">
          <FileSearch className="h-3 w-3" /> Ver triagem de origem
        </button>
      )}

      {/* Ações por etapa */}
      <div className="mt-2.5 grid grid-cols-2 gap-1.5 border-t pt-2.5">
        {c.status === 'PENDENTE' && (
          <>
            <AcaoBtn onClick={() => onEditar(c)} tom="aviso"><CalendarClock className="h-3.5 w-3.5" /> Remarcar</AcaoBtn>
            <AcaoBtn onClick={() => onAcao(c.id, 'EM_ANDAMENTO')} tom="primario"><Play className="h-3.5 w-3.5" /> Iniciar</AcaoBtn>
            <AcaoBtn onClick={() => onAcao(c.id, 'CONCLUIDO')} tom="primario"><Gavel className="h-3.5 w-3.5" /> Desfecho</AcaoBtn>
            <AcaoBtn onClick={() => onAcao(c.id, 'CANCELADO')} tom="perigo"><X className="h-3.5 w-3.5" /> Cancelar</AcaoBtn>
          </>
        )}
        {c.status === 'EM_ANDAMENTO' && (
          <>
            <AcaoBtn onClick={() => onEditar(c)} tom="aviso"><CalendarClock className="h-3.5 w-3.5" /> Remarcar</AcaoBtn>
            <AcaoBtn onClick={() => onAcao(c.id, 'CONCLUIDO')} tom="primario"><Gavel className="h-3.5 w-3.5" /> Desfecho</AcaoBtn>
            <AcaoBtn onClick={() => onAcao(c.id, 'PENDENTE')}><RotateCcw className="h-3.5 w-3.5" /> Pendente</AcaoBtn>
            <AcaoBtn onClick={() => onAcao(c.id, 'CANCELADO')} tom="perigo"><X className="h-3.5 w-3.5" /> Cancelar</AcaoBtn>
          </>
        )}
        {c.status === 'CONCLUIDO' && (
          <AcaoBtn onClick={() => onAcao(c.id, 'PENDENTE')}><RotateCcw className="h-3.5 w-3.5" /> Reabrir</AcaoBtn>
        )}
        {c.status === 'CANCELADO' && (
          <AcaoBtn onClick={() => onAcao(c.id, 'PENDENTE')} tom="aviso"><RotateCcw className="h-3.5 w-3.5" /> Reabrir</AcaoBtn>
        )}
      </div>
    </div>
  );
}
