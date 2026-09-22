'use client';

import { ReactNode, useEffect, useId, useRef } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Portal } from '@/components/ui/portal';

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
 * ONDE O FOCO CAI AO ABRIR — e por que não é sempre no mesmo botão.
 *
 * "As teclas de atalho funcionam bem, mas no modal ela não interage. Obrigando
 * a utilizar o mouse para concluir a ação." (18/09/2026). O diálogo ouvia o Esc
 * e o Enter, mas NUNCA movia o foco para dentro de si: o Tab continuava andando
 * pela página atrás, e não havia caminho de teclado até os botões. Quem decide
 * cinquenta duplicatas seguidas tinha de largar o teclado em cada uma.
 *
 * DESTRUTIVO FOCA O CANCELAR. Numa fila, a mão vem de apertar Enter para abrir
 * o diálogo; se o foco caísse no botão que apaga, o segundo Enter — o reflexo de
 * quem repete a mesma ação — apagaria um cadastro sem ninguém ter lido a
 * pergunta. Com o foco no Cancelar, o caminho é Tab e Enter: duas teclas, sem
 * mouse, e o engano custa um clique a mais em vez de um cadastro.
 */
export function focoInicial(destructive: boolean, confirmarComEnter = false): 'cancelar' | 'confirmar' {
  /*
    COM O ENTER LIGADO, O FOCO É O CONFIRMAR — decisão do dono (18/09/2026).

    "Quero que precise só apertar enter de novo para confirmar a consolidação.
    Não quero tab e nem botão de cancelar; para cancelar é só apertar esc."

    Eu havia travado o Enter em ação destrutiva pelo risco do segundo Enter
    reflexo. O dono viu a implementação e escolheu a fila rápida: quem decide
    centenas de duplicatas paga o preço de largar o teclado em cada uma. A
    escolha é dele; o que fica registrado é que o preço do engano aqui é um
    cadastro apagado, e que o desfazer não existe para consolidação.

    Por isso o atalho é OPT-IN: só liga onde alguém pediu. Excluir filiado,
    cancelar atividade e apagar cobrança continuam exigindo o clique.
  */
  if (confirmarComEnter) return 'confirmar';
  return destructive ? 'cancelar' : 'confirmar';
}

/**
 * O Tab circula DENTRO do diálogo. Sem isto, tabular sai para a página de trás
 * e o foco some atrás do overlay — a pessoa tecla e nada acontece na tela.
 */
export function proximoNoCiclo(atual: number, total: number, voltando: boolean): number {
  if (total <= 0) return 0;
  return voltando ? (atual - 1 + total) % total : (atual + 1) % total;
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
  const caixa = useRef<HTMLDivElement>(null);
  const cancelar = useRef<HTMLButtonElement>(null);
  const confirmar = useRef<HTMLButtonElement>(null);

  /*
    O FOCO ENTRA NO DIÁLOGO, e volta de onde veio ao fechar (18/09/2026).

    Sem isto o Tab continuava andando pela página de trás e não havia caminho de
    teclado até os botões — o atalho abria o diálogo e a mão tinha de ir ao
    mouse. E devolver o foco importa tanto quanto: numa fila, quem cancela
    precisa cair de volta no cartão que estava decidindo, não no começo da
    página.
  */
  useEffect(() => {
    if (!open) return;
    const veioDe = document.activeElement as HTMLElement | null;
    const alvo =
      focoInicial(variant === 'destructive', confirmarComEnter) === 'cancelar' ? cancelar : confirmar;
    // Depois da pintura: o botão só existe no DOM quando o diálogo renderiza.
    const t = window.setTimeout(() => (alvo.current ?? caixa.current)?.focus(), 0);
    return () => {
      window.clearTimeout(t);
      veioDe?.focus?.();
    };
  }, [open, variant]);

  /*
    O TAB CIRCULA DENTRO. Sair para a página atrás esconde o foco atrás do
    overlay: a pessoa tecla e nada acontece na tela.
  */
  useEffect(() => {
    if (!open) return;
    function aoTabular(ev: KeyboardEvent) {
      if (ev.key !== 'Tab' || !caixa.current) return;
      const focaveis = [...caixa.current.querySelectorAll<HTMLElement>('button:not([disabled])')];
      if (!focaveis.length) return;
      const atual = focaveis.indexOf(document.activeElement as HTMLElement);
      ev.preventDefault();
      focaveis[proximoNoCiclo(atual < 0 ? -1 : atual, focaveis.length, ev.shiftKey)]?.focus();
    }
    window.addEventListener('keydown', aoTabular, true);
    return () => window.removeEventListener('keydown', aoTabular, true);
  }, [open]);

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
    <Portal>
      <div
        className="fixed inset-0 z-50 flex animate-overlay-entrar items-end justify-center bg-black/50 sm:items-center sm:p-4"
        onClick={loading ? undefined : onClose}
      >
        <div
          ref={caixa}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={tituloId}
          tabIndex={-1}
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
          <div className="flex flex-wrap items-center justify-end gap-2 border-t bg-muted/30 p-4">
            {/*
              O CAMINHO DE TECLADO, DITO NA TELA. Quem chegou aqui por atalho não
              adivinha que o Tab agora circula dentro do diálogo. Só no desktop:
              no celular não há Tab nem Esc, e a linha seria ruído.
            */}
            <p className="mr-auto hidden text-[11px] text-muted-foreground sm:block">
              {!confirmarComEnter && (
                <>
                  <kbd className="rounded border px-1 font-sans">Tab</kbd> escolhe ·{' '}
                </>
              )}
              <kbd className="rounded border px-1 font-sans">Enter</kbd>{' '}
              {confirmarComEnter ? 'confirma' : 'aciona'} ·{' '}
              <kbd className="rounded border px-1 font-sans">Esc</kbd> fecha
            </p>
            {/*
              SEM BOTÃO DE CANCELAR quando o Enter confirma: duas teclas, uma
              decisão. O X do canto FICA — no telefone não existe Esc, e sem ele a
              única saída seria tocar fora, que ninguém descobre sozinho.
            */}
            {!confirmarComEnter && (
              <Button ref={cancelar} variant="outline" onClick={onClose} disabled={travas.cancelar}>
                {cancelLabel}
              </Button>
            )}
            <Button
              ref={confirmar}
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
    </Portal>
  );
}
