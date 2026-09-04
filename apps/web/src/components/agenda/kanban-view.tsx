'use client';

import { useState } from 'react';
import { CompromissoCard } from '@/components/agenda/compromisso-card';
import { cn } from '@/lib/utils';
import {
  Compromisso, StatusCompromisso, STATUS_ORDEM, STATUS_LABEL, TRANSICOES,
} from '@/lib/agenda';

const COL_DOT: Record<StatusCompromisso, string> = {
  PENDENTE: 'bg-amber-400',
  EM_ANDAMENTO: 'bg-sky-500',
  CONCLUIDO: 'bg-emerald-500',
  CANCELADO: 'bg-muted-foreground',
};

/**
 * Quadro Kanban por status.
 *
 * O ARRASTE respeita a mesma máquina de estados da API: uma coluna só aceita o
 * card se a transição existir, e soltar em "Concluído"/"Cancelado" abre o
 * diálogo correspondente em vez de fechar o evento sem desfecho/motivo. Antes,
 * arrastar mudava o status direto — era por aí que os eventos terminavam sem
 * ninguém saber o que tinha acontecido.
 */
export function KanbanView({
  compromissos, onAbrir, onEditar, onVerTriagem, onAcao,
  onConcluir, onCancelar, onRemarcar, onExcluir, podeExcluir, apontado,
}: {
  compromissos: Compromisso[];
  onAbrir: (c: Compromisso) => void;
  onEditar: (c: Compromisso) => void;
  onVerTriagem: (atendimentoId: string) => void;
  onAcao: (id: string, status: StatusCompromisso) => void;
  onConcluir: (c: Compromisso) => void;
  onCancelar: (c: Compromisso) => void;
  onRemarcar: (c: Compromisso) => void;
  onExcluir?: (c: Compromisso) => void;
  podeExcluir?: boolean;
  /** Id do cartão para o qual a navegação apontou — ver `CompromissoCard`. */
  apontado?: string | null;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [sobre, setSobre] = useState<StatusCompromisso | null>(null);

  const porStatus = (s: StatusCompromisso) => compromissos.filter((c) => c.status === s);
  const arrastado = compromissos.find((c) => c.id === dragId) ?? null;

  /** A coluna aceita o card? (mesma regra da API — a tela não promete o que o servidor recusa.) */
  function aceita(destino: StatusCompromisso): boolean {
    if (!arrastado || arrastado.status === destino) return false;
    if (destino === 'CONCLUIDO' || destino === 'CANCELADO') {
      // Só a partir de um estado aberto; de CONCLUIDO para CANCELADO exige reabrir.
      return arrastado.status === 'PENDENTE' || arrastado.status === 'EM_ANDAMENTO';
    }
    return TRANSICOES[arrastado.status]?.includes(destino) ?? false;
  }

  function soltar(destino: StatusCompromisso) {
    const card = arrastado;
    setDragId(null);
    setSobre(null);
    if (!card || !aceita(destino)) return;
    // Concluir e cancelar precisam de informação — abrem o diálogo próprio.
    if (destino === 'CONCLUIDO') return onConcluir(card);
    if (destino === 'CANCELADO') return onCancelar(card);
    onAcao(card.id, destino);
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      {STATUS_ORDEM.map((s) => {
        const itens = porStatus(s);
        const podeSoltar = aceita(s);
        const bloqueada = !!arrastado && !podeSoltar && arrastado.status !== s;
        return (
          <div
            key={s}
            onDragOver={(e) => { if (podeSoltar) { e.preventDefault(); setSobre(s); } }}
            onDragLeave={() => setSobre((cur) => (cur === s ? null : cur))}
            onDrop={() => soltar(s)}
            className={cn(
              'flex flex-col rounded-xl border bg-muted/30 p-2 transition-colors',
              sobre === s && podeSoltar && 'border-brand-500 bg-brand-50/50 dark:bg-brand-900/20',
              bloqueada && 'opacity-50',
            )}
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
                  apontado={apontado === c.id}
                  draggable
                  onDragStart={() => setDragId(c.id)}
                  onAbrir={onAbrir}
                  onEditar={onEditar}
                  onVerTriagem={onVerTriagem}
                  onAcao={onAcao}
                  onConcluir={onConcluir}
                  onCancelar={onCancelar}
                  onRemarcar={onRemarcar}
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
