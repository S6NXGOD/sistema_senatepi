'use client';

import { useState } from 'react';
import { CompromissoCard } from '@/components/agenda/compromisso-card';
import {
  Compromisso, StatusCompromisso, STATUS_ORDEM, STATUS_LABEL,
} from '@/lib/agenda';

const COL_DOT: Record<StatusCompromisso, string> = {
  PENDENTE: 'bg-amber-400',
  EM_ANDAMENTO: 'bg-sky-500',
  CONCLUIDO: 'bg-emerald-500',
  CANCELADO: 'bg-muted-foreground',
};

/** Quadro Kanban por status — arraste os cards ou use as ações contextuais. */
export function KanbanView({
  compromissos, onAbrir, onEditar, onVerTriagem, onAcao, onExcluir, podeExcluir,
}: {
  compromissos: Compromisso[];
  onAbrir: (c: Compromisso) => void;
  onEditar: (c: Compromisso) => void;
  onVerTriagem: (atendimentoId: string) => void;
  onAcao: (id: string, status: StatusCompromisso) => void;
  onExcluir?: (c: Compromisso) => void;
  podeExcluir?: boolean;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [sobre, setSobre] = useState<StatusCompromisso | null>(null);

  const porStatus = (s: StatusCompromisso) => compromissos.filter((c) => c.status === s);

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      {STATUS_ORDEM.map((s) => {
        const itens = porStatus(s);
        return (
          <div
            key={s}
            onDragOver={(e) => { e.preventDefault(); setSobre(s); }}
            onDragLeave={() => setSobre((cur) => (cur === s ? null : cur))}
            onDrop={() => { if (dragId) onAcao(dragId, s); setDragId(null); setSobre(null); }}
            className={`flex flex-col rounded-xl border bg-muted/30 p-2 transition-colors ${sobre === s ? 'border-senatepi-500 bg-senatepi-50/50 dark:bg-senatepi-900/20' : ''}`}
          >
            <div className="mb-2 flex items-center justify-between px-1">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <span className={`h-2.5 w-2.5 rounded-full ${COL_DOT[s]}`} /> {STATUS_LABEL[s]}
              </p>
              <span className="rounded-full bg-card px-2 py-0.5 text-xs font-medium text-muted-foreground">{itens.length}</span>
            </div>
            <div className="min-h-[80px] flex-1 space-y-2">
              {itens.map((c) => (
                <CompromissoCard
                  key={c.id}
                  c={c}
                  draggable
                  onDragStart={() => setDragId(c.id)}
                  onAbrir={onAbrir}
                  onEditar={onEditar}
                  onVerTriagem={onVerTriagem}
                  onAcao={onAcao}
                  onExcluir={onExcluir}
                  podeExcluir={podeExcluir}
                />
              ))}
              {itens.length === 0 && (
                <div className="rounded-lg border border-dashed py-8 text-center text-xs text-muted-foreground">
                  Sem atividades
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
