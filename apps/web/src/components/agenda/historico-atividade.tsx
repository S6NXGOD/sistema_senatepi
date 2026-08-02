'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Ban, CalendarClock, CheckCircle2, History, Loader2, Pencil, PlayCircle,
  Plus, RotateCcw,
} from 'lucide-react';
import { listarHistoricoCompromisso, type MovimentacaoCompromisso } from '@/lib/agenda';

/** Ícone e cor por tipo de movimentação. */
const ESTILO: Record<string, { Icon: React.ElementType; classe: string }> = {
  CRIADO: { Icon: Plus, classe: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
  EDITADO: { Icon: Pencil, classe: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
  INICIADO: { Icon: PlayCircle, classe: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300' },
  CONCLUIDO: { Icon: CheckCircle2, classe: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  CANCELADO: { Icon: Ban, classe: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  REMARCADO: { Icon: CalendarClock, classe: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  REABERTO: { Icon: RotateCcw, classe: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' },
};

const PADRAO = ESTILO.EDITADO;

/**
 * Linha do tempo da atividade: quem mexeu, o que fez e quando.
 *
 * Vem de uma tabela própria (e não da Auditoria global) porque aqui o texto é
 * escrito para ser lido pela equipe, não para perícia técnica.
 */
export function HistoricoAtividade({ compromissoId }: { compromissoId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['compromisso-historico', compromissoId],
    queryFn: () => listarHistoricoCompromisso(compromissoId),
    enabled: !!compromissoId,
  });

  const itens = data ?? [];

  return (
    <section className="space-y-2">
      <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        <History className="h-3.5 w-3.5" /> Histórico da atividade
      </h4>

      {isLoading && (
        <p className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </p>
      )}

      {!isLoading && itens.length === 0 && (
        <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
          Nenhuma movimentação registrada.
        </p>
      )}

      <ol className="space-y-0">
        {itens.map((m, i) => (
          <Linha key={m.id} mov={m} ultimo={i === itens.length - 1} />
        ))}
      </ol>
    </section>
  );
}

function Linha({ mov, ultimo }: { mov: MovimentacaoCompromisso; ultimo: boolean }) {
  const { Icon, classe } = ESTILO[mov.acao] ?? PADRAO;
  const autor = mov.autor?.nomeExibicao || mov.autor?.nome || mov.autorNome;

  return (
    <li className="flex gap-3">
      {/* Trilho: ícone + linha vertical ligando os eventos */}
      <div className="flex flex-col items-center">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${classe}`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        {!ultimo && <span className="w-px flex-1 bg-border" />}
      </div>

      <div className={`min-w-0 flex-1 ${ultimo ? 'pb-0' : 'pb-4'}`}>
        <p className="text-sm leading-snug">{mov.descricao}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {new Date(mov.createdAt).toLocaleString('pt-BR')}
          {autor ? ` · ${autor}` : ' · sistema'}
        </p>
      </div>
    </li>
  );
}
