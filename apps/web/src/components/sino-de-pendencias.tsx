'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Bell, CheckCircle2, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { podeVer } from '@/lib/permissoes';
import { minhasPendencias, PENDENCIA, rotulo, type Pendencia } from '@/lib/pendencias';

/**
 * O SINO — e o que ele deliberadamente NÃO faz.
 *
 * Não tem "marcar como lida", não guarda histórico e não avisa duas vezes da
 * mesma coisa. Ele mostra o ESTADO: o que está aberto e é seu. Concluiu, some.
 * É o que impede o número de inflar até virar decoração — todo sistema que a
 * equipe já usou ensinou a ignorar o sininho justamente por acumular evento.
 *
 * SER INCISIVO SEM SER CHATO. O ponto vermelho aparece só quando existe prazo
 * VENCIDO ou publicação sem dono; audiência da semana e tarefa de hoje ficam em
 * cinza. Pintar tudo de vermelho ensina a ignorar o vermelho, e aí o dia do
 * prazo perdido de verdade passa igual aos outros.
 */

/**
 * Um minuto. Curto o bastante para o número não mentir depois de concluir uma
 * tarefa em outra aba; longo o bastante para não virar polling agressivo.
 */
const REVALIDAR_MS = 60_000;

export function SinoDePendencias() {
  const { user } = useAuth();
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  const caminho = usePathname();

  const permitido = podeVer(user?.role, user?.permissoes, 'agenda');

  const { data } = useQuery({
    queryKey: ['minhas-pendencias'],
    queryFn: minhasPendencias,
    enabled: permitido,
    refetchInterval: REVALIDAR_MS,
    refetchOnWindowFocus: true,
    retry: false,
  });

  // Navegou: a gaveta fecha. Sem isto ela ficaria aberta sobre a tela nova.
  useEffect(() => setAberto(false), [caminho]);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAberto(false);
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', esc);
    };
  }, [aberto]);

  if (!permitido) return null;

  const pendencias = data?.pendencias ?? [];
  const total = data?.total ?? 0;
  const temUrgente = pendencias.some((p) => PENDENCIA[p.tipo].urgente);

  return (
    <div className="relative" ref={caixa}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-label={total ? `${total} pendências suas` : 'Nada pendente para você'}
        aria-expanded={aberto}
        className="relative flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
      >
        <Bell className="h-5 w-5" />
        {total > 0 && (
          <span
            className={cn(
              'absolute right-1 top-1 min-w-[18px] rounded-full px-1 text-[10px] font-bold leading-[18px] text-white',
              temUrgente ? 'bg-red-600' : 'bg-brand-700',
            )}
          >
            {total > 99 ? '99+' : total}
          </span>
        )}
      </button>

      {aberto && (
        <div
          role="dialog"
          aria-label="Suas pendências"
          className={cn(
            // No celular ocupa quase a largura toda; no desktop, uma coluna fixa.
            'absolute right-0 z-50 mt-1 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border bg-card shadow-lg',
          )}
        >
          <div className="border-b px-4 py-2.5">
            <p className="text-sm font-semibold">O que precisa de você</p>
            <p className="text-[11px] text-muted-foreground">
              Some sozinho quando você resolve — não há o que marcar como lido.
            </p>
          </div>

          {pendencias.length === 0 ? (
            <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              Nada em aberto no seu nome.
            </div>
          ) : (
            <ul className="max-h-[60vh] divide-y overflow-y-auto">
              {pendencias.map((p) => (
                <Grupo key={p.tipo} p={p} />
              ))}
            </ul>
          )}

          <Link
            href="/agenda"
            className="flex items-center justify-between border-t px-4 py-2.5 text-sm font-medium text-brand-800 transition hover:bg-muted/60 dark:text-brand-300"
          >
            Abrir minha agenda <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      )}
    </div>
  );
}

function Grupo({ p }: { p: Pendencia }) {
  const urgente = PENDENCIA[p.tipo].urgente;
  return (
    <li className="px-4 py-2.5">
      <p
        className={cn(
          'text-sm font-medium',
          urgente ? 'text-red-700 dark:text-red-400' : 'text-foreground',
        )}
      >
        {rotulo(p)}
      </p>
      <ul className="mt-1 space-y-0.5">
        {p.exemplos.map((e) => (
          <li key={e.id}>
            <Link
              href={e.href}
              className="-mx-1 flex items-baseline gap-2 truncate rounded px-1 py-0.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <span className="truncate">{e.titulo}</span>
              {e.quando && (
                <span className="shrink-0 tabular-nums">
                  {new Date(e.quando).toLocaleDateString('pt-BR', {
                    day: '2-digit',
                    month: '2-digit',
                  })}
                </span>
              )}
            </Link>
          </li>
        ))}
        {/* Três exemplos bastam para reconhecer; o resto está na agenda. */}
        {p.total > p.exemplos.length && (
          <li className="text-[11px] text-muted-foreground/80">
            e mais {p.total - p.exemplos.length}
          </li>
        )}
      </ul>
    </li>
  );
}
