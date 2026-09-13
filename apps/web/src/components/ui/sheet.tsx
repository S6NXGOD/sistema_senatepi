'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Sheet (painel deslizante) — hand-rolled no estilo dos demais componentes do
 * projeto (sem Radix). Desliza de um lado (nav mobile) ou do rodapé (bottom sheet).
 */
export function Sheet({
  open,
  onClose,
  side = 'left',
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  side?: 'left' | 'right' | 'bottom';
  className?: string;
  children: React.ReactNode;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  const painelPos =
    side === 'bottom'
      ? 'inset-x-0 bottom-0 max-h-[85vh] w-full rounded-t-2xl'
      : side === 'right'
        ? 'inset-y-0 right-0 h-full w-72 max-w-[85%]'
        : 'inset-y-0 left-0 h-full w-72 max-w-[85%]';

  const fechado =
    side === 'bottom' ? 'translate-y-full' : side === 'right' ? 'translate-x-full' : '-translate-x-full';

  /*
    Os tokens de `lib/movimento.ts`. O Sheet fica MONTADO fechado (é o único
    overlay que sai animado sem perder nada: nunca dependeu de desmontar para
    zerar estado). Abre na duração de painel com curva que desacelera; fecha
    mais rápido, com curva que acelera — quem fecha já decidiu.
  */
  return (
    <div className={cn('fixed inset-0 z-50', !open && 'pointer-events-none')} aria-hidden={!open}>
      <div
        className={cn(
          'absolute inset-0 bg-black/50 transition-opacity',
          open ? 'opacity-100 duration-base ease-entrada' : 'opacity-0 duration-rapido ease-saida',
        )}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'absolute flex flex-col bg-card shadow-xl transition-transform',
          painelPos,
          open ? 'translate-x-0 translate-y-0 duration-painel ease-entrada' : cn(fechado, 'duration-rapido ease-saida'),
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
