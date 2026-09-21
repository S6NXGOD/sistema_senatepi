'use client';

import { Send, X } from 'lucide-react';
import { EnviarLinkRecadastro } from '@/components/filiados/enviar-link-recadastro';

/**
 * O LINK DE RECADASTRO SEM SAIR DE ONDE SE ESTÁ — 21/09/2026.
 *
 * "Quando clico em mandar link de recadastro, não gera link nenhum, na verdade
 * vai pra tela do filiado detalhado. (...) No lugar de mandar para a tela de
 * filiados, não era melhor abrir um modal? Isso serve tanto para quando vai
 * cadastrar quanto quando detalha na listagem."
 *
 * Ele está certo, e o defeito era meu: o botão era um `Link` para
 * `/filiados/<id>?recadastro=1`, e quem clicava saía do atendimento no meio do
 * registro, chegava numa ficha inteira e tinha de achar o bloco sozinho. Pior
 * na Triagem, que atende com a pessoa na linha: sair da tela é perder o fio.
 *
 * O CONTEÚDO É O MESMO BLOCO DA FICHA (`EnviarLinkRecadastro`) — a mensagem
 * pronta para copiar, o botão de WhatsApp, o de e-mail e o aviso de quando o
 * link vence. Um segundo componente para a mesma coisa divergiria no dia em que
 * alguém mexesse num só; aqui ele só ganhou uma moldura.
 */
export function EnviarLinkModal({
  filiadoId,
  nome,
  open,
  onClose,
}: {
  filiadoId: string;
  /** Aparece no cabeçalho: no meio de um atendimento, confirma de quem é o link. */
  nome?: string | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex animate-overlay-entrar items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="enviar-link-titulo"
        className="flex max-h-[92vh] w-full max-w-lg animate-dialogo-entrar flex-col overflow-hidden rounded-t-2xl bg-card shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b p-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-900/30">
              <Send className="h-4.5 w-4.5 text-brand-800 dark:text-brand-300" />
            </span>
            <div className="min-w-0">
              <h3 id="enviar-link-titulo" className="text-base font-bold leading-tight">
                Link de recadastramento
              </h3>
              {nome && <p className="truncate text-xs text-muted-foreground">{nome}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="shrink-0 text-muted-foreground transition hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/*
          `p-0` no corpo: o bloco já traz o próprio cartão com borda. Duas
          molduras encaixadas é o desenho que faz o modal parecer apertado.
        */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <EnviarLinkRecadastro filiadoId={filiadoId} />
        </div>
      </div>
    </div>
  );
}
