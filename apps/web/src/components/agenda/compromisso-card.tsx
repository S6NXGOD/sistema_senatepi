'use client';

import { Clock, User, AlertTriangle, Pencil, FileSearch, History } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Compromisso, StatusCompromisso,
  TIPO_LABEL, TIPO_COR, STATUS_ORDEM, STATUS_LABEL,
  formatDataHora, formatData, estaAtrasado,
} from '@/lib/agenda';

export function CompromissoCard({
  c, onEditar, onVerTriagem, onStatus, draggable, onDragStart,
}: {
  c: Compromisso;
  onEditar: (c: Compromisso) => void;
  onVerTriagem: (atendimentoId: string) => void;
  onStatus: (id: string, status: StatusCompromisso) => void;
  draggable?: boolean;
  onDragStart?: () => void;
}) {
  const atrasado = estaAtrasado(c);
  const cor = TIPO_COR[c.tipo];

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      className={`rounded-lg border border-l-4 ${cor.borda} bg-card p-3 shadow-sm ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      <p className="line-clamp-2 text-sm font-semibold leading-tight">{c.titulo}</p>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <Badge className={cor.badge}>{TIPO_LABEL[c.tipo]}</Badge>
        {atrasado && (
          <Badge className="bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300">
            <AlertTriangle className="h-3 w-3" /> Atrasado
          </Badge>
        )}
      </div>

      <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
        <p className="flex items-center gap-1"><Clock className="h-3 w-3" /> {formatDataHora(c.inicio)}</p>
        {c.filiado && <p className="flex items-center gap-1 truncate"><User className="h-3 w-3 shrink-0" /> {c.filiado.nomeCompleto}</p>}
        <p className="truncate">Resp.: {c.responsavel.nome}</p>
      </div>

      {/* Alerta de remarcação (trilha de auditoria) */}
      {c.dataOriginal && (
        <p className="mt-2 flex items-center gap-1 rounded bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
          <History className="h-3 w-3 shrink-0" /> Remarcado. Original: {formatData(c.dataOriginal)}
        </p>
      )}

      {/* Ações */}
      <div className="mt-2 flex flex-wrap items-center gap-1 border-t pt-2">
        <button type="button" onClick={() => onEditar(c)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
          <Pencil className="h-3.5 w-3.5" /> Editar
        </button>
        {c.atendimentoId && (
          <button type="button" onClick={() => onVerTriagem(c.atendimentoId!)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-senatepi-700 hover:bg-muted dark:text-senatepi-400">
            <FileSearch className="h-3.5 w-3.5" /> Ver triagem
          </button>
        )}
        <select
          value={c.status}
          onChange={(e) => onStatus(c.id, e.target.value as StatusCompromisso)}
          className="ml-auto h-7 rounded-md border border-input bg-background px-1.5 text-xs"
          title="Mudar status"
          onClick={(e) => e.stopPropagation()}
        >
          {STATUS_ORDEM.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </div>
    </div>
  );
}
