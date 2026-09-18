'use client';

import { ReactNode, useEffect, useId } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * O Esc do diálogo: para o evento aqui (a gaveta embaixo não fecha junto) e só
 * fecha quando não está gravando. Separado para o teste chamar sem navegador.
 */
export function aoTeclarNoDialogo(
  ev: Pick<KeyboardEvent, 'key' | 'stopPropagation' | 'preventDefault'>,
  p: {
    loading: boolean;
    onClose: () => void;
    /**
     * ENTER CONFIRMA — só onde a ação TEM VOLTA (18/09/2026).
     *
     * A fila de duplicados é trabalho repetitivo: dezenas de grupos, a mesma
     * decisão em cada um. Obrigar a mão a sair do teclado para clicar em
     * "Confirmar" a cada item é o que faz alguém parar no meio.
     *
     * Mas não vale para tudo, e a diferença é o preço do engano: "não é a mesma
     * pessoa" volta pela lista do fim da página e pelo Desfazer do aviso;
     * consolidar APAGA cadastros. Quem chama liga isto — e quem apaga não liga.
     */
    confirmarComEnter?: boolean;
    onConfirm?: () => void;
    confirmDisabled?: boolean;
  },
): void {
  if (ev.key === 'Escape') {
    ev.stopPropagation();
    if (!p.loading) p.onClose();
    return;
  }
  if (ev.key === 'Enter' && p.confirmarComEnter && !p.loading && !p.confirmDisabled) {
    ev.preventDefault();
    ev.stopPropagation();
    p.onConfirm?.();
  }
}

/**
 * O que cada botão aceita. `loading` é GRAVANDO: trava tudo, porque fechar no
 * meio deixaria a gravação sem ninguém olhando. `confirmDisabled` é "ainda não
 * dá para confirmar" (conferindo algo antes): trava só o botão de confirmar —
 * desistir continua sempre à mão. Separado para o teste chamar sem navegador.
 */
export function travasDoDialogo(p: { loading: boolean; confirmDisabled: boolean }): {
  confirmar: boolean;
  cancelar: boolean;
} {
  return { confirmar: p.loading || p.confirmDisabled, cancelar: p.loading };
}

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
  confirmDisabled = false,
  confirmarComEnter = false,
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
  /** Trava só o confirmar (ex.: conferindo algo antes); Cancelar, X, Esc e o toque fora continuam. */
  confirmDisabled?: boolean;
  /**
   * Enter confirma. Só para ação que TEM VOLTA — ver `aoTeclarNoDialogo`.
   * Em fila repetitiva é a diferença entre decidir com o teclado e ter de mirar
   * um botão a cada item.
   */
  confirmarComEnter?: boolean;
  icon?: ReactNode;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const tituloId = useId();

  /*
    ESC FECHA O DIÁLOGO, E SÓ ELE (15/09/2026). O diálogo não ouvia o Esc, e a
    gaveta embaixo ouve no `document`: o "Reabrir" aberto pela gaveta do
    atendimento fechava a gaveta inteira e deixava o diálogo na tela. A escuta é
    na captura da `window`, que corre antes do `document`, e o evento para aqui.
    Gravando, o Esc não fecha, como o toque fora.
  */
  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) =>
      aoTeclarNoDialogo(ev, { loading, onClose, confirmarComEnter, onConfirm, confirmDisabled });
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, loading, onClose, confirmarComEnter, onConfirm, confirmDisabled]);

  if (!open) return null;
  const destructive = variant === 'destructive';
  const travas = travasDoDialogo({ loading, confirmDisabled });

  /*
    SÓ ENTRADA, NUNCA SAÍDA. O diálogo continua saindo do DOM ao fechar (é o
    `return null` acima que zera o que foi digitado); animar a saída exigiria
    mantê-lo montado, e ele reabriria com o estado antigo.
  */
  return (
    <div
      className="fixed inset-0 z-50 flex animate-overlay-entrar items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={loading ? undefined : onClose}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        className="w-full max-w-md animate-dialogo-entrar overflow-hidden rounded-t-2xl bg-card shadow-xl sm:rounded-2xl"
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
            <h3 id={tituloId} className="font-semibold leading-tight">{title}</h3>
            <div className="text-sm text-muted-foreground">{description}</div>
          </div>
          {/* 44 px de alvo no telefone; a margem negativa mantém o X no lugar. */}
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            aria-label="Fechar"
            className="-m-2.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex justify-end gap-2 border-t bg-muted/30 p-4">
          <Button variant="outline" onClick={onClose} disabled={travas.cancelar}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={travas.confirmar}
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
