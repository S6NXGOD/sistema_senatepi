'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, X, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface PassoDoGuia {
  icone: LucideIcon;
  titulo: string;
  texto: ReactNode;
}

/**
 * UM GUIA CURTO, UM PASSO POR VEZ.
 *
 * PASSOS, E NÃO UM TEXTÃO. Quem abre a tela pela primeira vez quer usar a tela;
 * uma parede de explicação é fechada sem ser lida. Cinco cartões de duas ou
 * três frases cabem na atenção de quem está com pressa, e o contador "2 de 5"
 * diz quanto falta — que é o que faz alguém ir até o fim.
 *
 * NO CELULAR VEM DE BAIXO, como gaveta, com os botões no alcance do polegar e
 * respeitando a área segura do iPhone. No computador, centralizado.
 *
 * Fecha por Esc, pelo X, clicando fora ou em "Entendi" — todos contam como
 * "já vi". Setas do teclado andam entre os passos.
 */
export function GuiaRapido({
  titulo,
  passos,
  aberto,
  onFechar,
}: {
  titulo: string;
  passos: PassoDoGuia[];
  aberto: boolean;
  onFechar: () => void;
}) {
  const [i, setI] = useState(0);
  const painel = useRef<HTMLDivElement>(null);

  /* Reabrir começa do primeiro passo, e o foco vai para o guia (leitor de tela e teclado). */
  useEffect(() => {
    if (!aberto) return;
    setI(0);
    painel.current?.focus();
  }, [aberto]);

  useEffect(() => {
    if (!aberto) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFechar();
      if (e.key === 'ArrowRight') setI((v) => Math.min(passos.length - 1, v + 1));
      if (e.key === 'ArrowLeft') setI((v) => Math.max(0, v - 1));
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [aberto, passos.length, onFechar]);

  if (!aberto || !passos.length) return null;
  const passo = passos[Math.min(i, passos.length - 1)];
  const ultimo = i >= passos.length - 1;
  const Icone = passo.icone;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={onFechar}
      role="presentation"
    >
      <div
        ref={painel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="guia-rapido-titulo"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-2xl bg-card pb-[env(safe-area-inset-bottom)] shadow-2xl outline-none sm:rounded-2xl sm:pb-0"
      >
        <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {titulo} · {i + 1} de {passos.length}
          </p>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar o guia"
            className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted sm:h-9 sm:w-9"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 pb-2 pt-5" aria-live="polite">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-800 dark:bg-brand-900/30 dark:text-brand-300">
            <Icone className="h-6 w-6" />
          </span>
          <h2 id="guia-rapido-titulo" className="mt-3 text-lg font-semibold leading-snug">
            {passo.titulo}
          </h2>
          <div className="mt-2 space-y-2 text-sm leading-relaxed text-muted-foreground">{passo.texto}</div>
        </div>

        <div className="flex items-center justify-between gap-3 px-5 pb-5 pt-4">
          <div className="flex gap-1.5" aria-hidden>
            {passos.map((_, k) => (
              <span
                key={k}
                className={cn(
                  'h-1.5 rounded-full transition-all',
                  k === i ? 'w-5 bg-brand-800 dark:bg-brand-400' : 'w-1.5 bg-muted-foreground/30',
                )}
              />
            ))}
          </div>
          <div className="flex gap-2">
            {i > 0 && (
              <Button variant="outline" onClick={() => setI((v) => v - 1)}>
                <ChevronLeft className="h-4 w-4" /> Voltar
              </Button>
            )}
            {ultimo ? (
              <Button onClick={onFechar}>Entendi</Button>
            ) : (
              <Button onClick={() => setI((v) => v + 1)}>
                Próximo <ChevronRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
