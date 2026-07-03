'use client';

import { ReactNode } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Modal de confirmação reutilizável — segue o padrão de modais do projeto
 * (overlay fixo + card). Use `variant="destructive"` para ações irreversíveis
 * (vermelho) e o padrão (âmbar) para avisos.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  variant = 'default',
  loading = false,
  icon,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'destructive';
  loading?: boolean;
  icon?: ReactNode;
  onConfirm: () => void;
  onClose: () => void;
}) {
  if (!open) return null;
  const destructive = variant === 'destructive';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={loading ? undefined : onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-t-2xl bg-card shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 p-5">
          <div
            className={cn(
              'shrink-0 rounded-xl p-2',
              destructive
                ? 'bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-400'
                : 'bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400',
            )}
          >
            {icon ?? <AlertTriangle className="h-6 w-6" />}
          </div>
          <div className="flex-1 space-y-1">
            <h3 className="font-semibold leading-tight">{title}</h3>
            <div className="text-sm text-muted-foreground">{description}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex justify-end gap-2 border-t bg-muted/30 p-4">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
