'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2, X, Download, QrCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getQrCodeColaborador, urlCrachaColaborador } from '@/lib/colaboradores';
import { baixarPdf } from '@/lib/pdf';

/**
 * Crachá e QR de entrada do colaborador.
 *
 * Estas ações só existiam no cadastro de Funcionários — que saiu do menu quando
 * Funcionário e Colaborador foram unificados, deixando a emissão de crachá
 * acessível apenas por URL escondida. Agora moram onde a pessoa é gerenciada.
 *
 * O QR não é um documento: é a credencial de entrada em evento, lida na
 * portaria. Por isso a tela mostra também o status — um colaborador afastado
 * tem QR, mas ele é recusado no check-in.
 */
export function CrachaDialog({
  colaboradorId, nome, open, onClose,
}: {
  colaboradorId: string;
  nome: string;
  open: boolean;
  onClose: () => void;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['colaborador-qrcode', colaboradorId],
    queryFn: () => getQrCodeColaborador(colaboradorId),
    enabled: open,
  });

  /**
   * BAIXA com o nome do colaborador, em vez de abrir numa aba.
   *
   * O botão se chama "Baixar", e abrir numa aba entregava um `blob:` sem nome:
   * ao salvar, o navegador usava o UUID do blob. `baixarPdf` lê o nome do
   * `Content-Disposition` — "Crachá - Fulano de Tal.pdf".
   */
  async function baixarCracha() {
    await baixarPdf(urlCrachaColaborador(colaboradorId), 'Crachá.pdf');
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="flex w-full max-w-sm flex-col rounded-2xl bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b p-5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-900/30">
              <QrCode className="h-4.5 w-4.5 text-brand-800 dark:text-brand-400" />
            </span>
            <div className="min-w-0">
              <h3 className="text-base font-bold">Crachá e QR de entrada</h3>
              <p className="truncate text-xs text-muted-foreground">{nome}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-col items-center gap-3 p-6">
          {isLoading ? (
            <div className="flex h-56 items-center justify-center">
              <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
            </div>
          ) : isError || !data ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Não foi possível gerar o QR Code.
            </p>
          ) : (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={data.imagem}
                alt={`QR Code de ${nome}`}
                className="h-56 w-56 rounded-lg border bg-white p-2"
              />
              <p className="text-center text-xs leading-snug text-muted-foreground">
                Apresente na entrada do evento. A portaria confere a foto e o status
                antes de liberar.
              </p>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t bg-muted/30 p-4">
          <Button variant="outline" onClick={onClose}>Fechar</Button>
          <Button onClick={baixarCracha} disabled={isLoading || isError}>
            <Download className="h-4 w-4" /> Crachá em PDF
          </Button>
        </div>
      </div>
    </div>
  );
}
