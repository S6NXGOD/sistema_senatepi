'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  X, Loader2, Copy, Check, QrCode, ShieldCheck, CheckCircle2, AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AvisoLgpd, Arquivo } from './nova-declaracao-wizard';
import {
  buscarPixDaGuia, anexarDocumentos, formatarReais,
  type Contribuicao, type ErroPortal,
} from '@/lib/portal-empresa';
import { tenant } from '@/tenant.config';

/**
 * Retomada de uma guia já criada: mostra o PIX de novo e recebe os documentos.
 *
 * Serve para os dois casos em que a empresa volta: quem escolheu "pagar depois"
 * (AGUARDANDO) e quem teve a declaração recusada (REJEITADA).
 */
export function RetomarGuiaModal({
  contribuicao, onClose,
}: {
  contribuicao: Contribuicao | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [comprovante, setComprovante] = useState<File | null>(null);
  const [relacao, setRelacao] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [concluido, setConcluido] = useState(false);

  const { data: pix, isLoading } = useQuery({
    queryKey: ['portal-empresa', 'pix', contribuicao?.id],
    queryFn: () => buscarPixDaGuia(contribuicao!.id),
    enabled: !!contribuicao,
  });

  function fechar() {
    setComprovante(null); setRelacao(null); setCopiado(false); setConcluido(false);
    onClose();
  }

  async function copiar() {
    if (!pix) return;
    try {
      await navigator.clipboard.writeText(pix.copiaECola);
      setCopiado(true);
      toast.success('Código PIX copiado.');
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      toast.error('Não foi possível copiar — selecione o texto manualmente.');
    }
  }

  async function enviar() {
    if (!contribuicao) return;
    // Um documento já basta — a empresa pode completar o outro depois.
    if (!comprovante && !relacao) {
      return toast.error('Anexe ao menos um dos dois documentos.');
    }
    if (relacao && relacao.type !== 'application/pdf') {
      return toast.error('A relação de trabalhadores precisa ser um arquivo PDF.');
    }

    setEnviando(true);
    try {
      await anexarDocumentos(contribuicao.id, comprovante, relacao);
      void qc.invalidateQueries({ queryKey: ['portal-empresa', 'contribuicoes'] });
      setConcluido(true);
    } catch (e) {
      toast.error((e as ErroPortal).message);
    } finally {
      setEnviando(false);
    }
  }

  if (!contribuicao) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div className="my-8 w-full max-w-lg rounded-2xl bg-card shadow-xl">
        <div className="flex items-start justify-between border-b p-5">
          <div>
            <h3 className="font-semibold capitalize">{contribuicao.competencia}</h3>
            <p className="text-xs text-muted-foreground">
              {contribuicao.status === 'REJEITADA'
                ? 'Reenvio dos documentos'
                : 'Conclua o envio dos documentos'}
            </p>
          </div>
          <button type="button" onClick={fechar} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        {concluido ? (
          <div className="flex flex-col items-center gap-3 p-8 text-center">
            <CheckCircle2 className="h-12 w-12 text-brand-600" />
            <h4 className="text-lg font-bold">Documentos enviados!</h4>
            <p className="max-w-xs text-sm text-muted-foreground">
              A declaração está <strong>em análise</strong> pelo {tenant.sigla}.
            </p>
            <Button className="mt-2 w-full" onClick={fechar}>Voltar ao portal</Button>
          </div>
        ) : (
          <div className="space-y-4 p-5">
            {contribuicao.status === 'REJEITADA' && contribuicao.motivoRejeicao && (
              <p className="flex items-start gap-1.5 rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  <strong>O que precisa ser corrigido:</strong> {contribuicao.motivoRejeicao}
                </span>
              </p>
            )}

            {isLoading && (
              <p className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando o PIX…
              </p>
            )}

            {pix && (
              <div className="rounded-xl border bg-muted/30 p-4 text-center">
                <p className="text-xs text-muted-foreground">Valor a pagar</p>
                <p className="text-xl font-bold">{formatarReais(pix.valor)}</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={pix.qrDataUrl}
                  alt="QR Code do PIX"
                  className="mx-auto mt-3 h-40 w-40 rounded-lg bg-white p-2"
                />
                <div className="mt-3 flex items-center gap-2 rounded-lg border bg-card p-2">
                  <input
                    readOnly
                    value={pix.copiaECola}
                    onFocus={(e) => e.currentTarget.select()}
                    className="min-w-0 flex-1 bg-transparent px-1 font-mono text-[10px] outline-none"
                  />
                  <Button size="sm" variant={copiado ? 'outline' : 'default'} onClick={copiar}>
                    {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
                  <QrCode className="h-3 w-3" /> Se já pagou, siga para os documentos.
                </p>
              </div>
            )}

            <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              {contribuicao.temComprovante || contribuicao.temRelacao ? (
                <>
                  Já recebemos{' '}
                  <strong>
                    {contribuicao.temComprovante && contribuicao.temRelacao
                      ? 'os dois documentos'
                      : contribuicao.temComprovante
                        ? 'o comprovante do PIX'
                        : 'a relação de trabalhadores'}
                  </strong>
                  . Envie o que faltar — ou substitua um arquivo enviado por engano.
                </>
              ) : (
                <>Anexe o que já tiver. O que faltar pode ser enviado depois.</>
              )}
            </p>

            <Arquivo
              rotulo="Comprovante do PIX"
              dica="PDF ou imagem do comprovante."
              accept="application/pdf,image/*"
              arquivo={comprovante}
              onEscolher={setComprovante}
            />
            <Arquivo
              rotulo="Relação de trabalhadores"
              dica="Somente PDF (folha de pagamento / relação nominal)."
              accept="application/pdf"
              arquivo={relacao}
              onEscolher={setRelacao}
            />

            <AvisoLgpd />

            <Button className="w-full" onClick={enviar} disabled={enviando}>
              {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Enviar para análise
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
