'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { Printer, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  getCarne, CarneData, TIPO_LABEL, formatBRL, formatData, formatCpf,
} from '@/lib/cobrancas';

const LGPD =
  'Documento em conformidade com a LGPD (Lei nº 13.709/2018): dados pessoais tratados exclusivamente para fins de gestão financeira associativa.';

/**
 * Modal de impressão do carnê (A4). Renderiza um bloco por parcela — canhoto
 * (esquerda, controle do sindicato) + recibo (direita, filiado) — com QR do PIX.
 * O CSS global de `@media print` esconde a navegação e mostra só o carnê.
 */
export function CarnePrintModal({ cobrancaId, onClose }: { cobrancaId: string; onClose: () => void }) {
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['carne', cobrancaId],
    queryFn: () => getCarne(cobrancaId),
  });

  if (!montado) return null;

  const conteudo = (
    <div id="carne-print-root">
      <div className="carne-overlay fixed inset-0 z-[60] overflow-auto bg-black/60 p-4">
        {/* Barra de ações — não sai na impressão */}
        <div className="no-print mx-auto mb-4 flex w-full max-w-[210mm] items-center justify-between gap-2">
          <p className="text-sm font-medium text-white">Pré-visualização do carnê</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}><X className="h-4 w-4" /> Fechar</Button>
            <Button onClick={() => window.print()} disabled={isLoading || isError || !data}>
              <Printer className="h-4 w-4" /> Imprimir
            </Button>
          </div>
        </div>

        {/* Papel A4 */}
        <div className="carne-paper mx-auto w-full max-w-[210mm] bg-white p-[10mm] text-[#111] shadow-xl">
          {isLoading ? (
            <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-800" /></div>
          ) : isError || !data ? (
            <p className="py-20 text-center text-sm text-red-600">Não foi possível carregar o carnê.</p>
          ) : (
            <div className="space-y-3">
              {data.parcelas.map((p) => (
                <CarneBloco key={p.id} data={data} parcela={p} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(conteudo, document.body);
}

// ---------------------------------------------------------------------------

function CarneBloco({ data, parcela }: { data: CarneData; parcela: CarneData['parcelas'][number] }) {
  const { config, filiado, cobranca } = data;
  const recebedor = config?.pixNomeRecebedor ?? 'SENATEPI';
  const posicao = `${parcela.numero}/${cobranca.totalParcelas}`;
  const rodape = [config?.textoRodapeCarne, LGPD].filter(Boolean).join(' ');

  return (
    <div className="flex break-inside-avoid overflow-hidden rounded-md border border-gray-400 text-[10px] leading-tight">
      {/* CANHOTO — controle do sindicato (esquerda, menor) */}
      <div className="w-[30%] border-r border-dashed border-gray-500 p-3">
        <p className="mb-1 text-[8px] font-semibold uppercase tracking-wide text-gray-500">Controle · Sindicato</p>
        {config?.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={config.logoUrl} alt="" className="mb-1 h-6 object-contain" />
        ) : (
          <p className="text-xs font-bold text-brand-800">SENATEPI</p>
        )}
        <MiniLinha rotulo="Filiado" valor={filiado.nomeCompleto} />
        <MiniLinha rotulo="Matrícula" valor={filiado.matricula} />
        <MiniLinha rotulo="Parcela" valor={posicao} />
        <MiniLinha rotulo="Vencimento" valor={formatData(parcela.dataVencimento)} />
        <div className="mt-1 border-t pt-1">
          <p className="text-[8px] uppercase text-gray-500">Valor</p>
          <p className="text-sm font-bold">{formatBRL(parcela.valor)}</p>
        </div>
      </div>

      {/* RECIBO — via do filiado (direita, maior) */}
      <div className="flex-1 p-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            {config?.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={config.logoUrl} alt="" className="h-8 object-contain" />
            )}
            <div>
              <p className="text-sm font-bold text-brand-800">{recebedor}</p>
              <p className="text-[9px] uppercase tracking-wide text-gray-500">
                Carnê de Pagamento · {TIPO_LABEL[cobranca.tipo]}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[8px] uppercase text-gray-500">Parcela</p>
            <p className="text-base font-bold">{posicao}</p>
          </div>
        </div>

        <div className="mt-2 grid grid-cols-4 gap-x-3 gap-y-1 border-y py-2">
          <Campo rotulo="Filiado" valor={filiado.nomeCompleto} className="col-span-2" />
          <Campo rotulo="CPF" valor={formatCpf(filiado.cpf)} />
          <Campo rotulo="Vencimento" valor={formatData(parcela.dataVencimento)} />
          <Campo rotulo="Competência" valor={formatData(parcela.dataCompetencia)} />
          <Campo rotulo="Valor" valor={formatBRL(parcela.valor)} destaque className="col-span-3" />
        </div>

        <div className="mt-2 flex items-start gap-3">
          {/* QR do PIX (gerado no front a partir do payload do backend) */}
          <div className="shrink-0 text-center">
            {parcela.copiaECola ? (
              <>
                <QRCodeSVG value={parcela.copiaECola} size={92} level="M" />
                <p className="mt-1 w-[92px] text-[7.5px] font-semibold uppercase text-gray-500">
                  Pague com o app do banco
                </p>
              </>
            ) : (
              <div className="flex h-[92px] w-[92px] items-center justify-center rounded border border-dashed p-1 text-center text-[8px] text-gray-400">
                Configure a chave PIX do sindicato
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            {parcela.copiaECola && (
              <>
                <p className="text-[8px] font-semibold uppercase text-gray-500">PIX Copia e Cola</p>
                <p className="break-all font-mono text-[8px] leading-snug text-gray-700">{parcela.copiaECola}</p>
              </>
            )}
            {/* Assinatura do presidente */}
            <div className="mt-3 flex justify-end">
              <div className="text-center">
                {config?.assinaturaPresidenteUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={config.assinaturaPresidenteUrl} alt="" className="mx-auto h-8 object-contain" />
                ) : (
                  <div className="h-8" />
                )}
                <div className="w-40 border-t border-gray-500" />
                <p className="text-[8px] text-gray-500">Presidência — {recebedor}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Rodapé: texto de responsabilidade + menção à LGPD */}
        <p className="mt-2 border-t pt-1 text-[7.5px] leading-snug text-gray-500">{rodape}</p>
      </div>
    </div>
  );
}

function MiniLinha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <p className="truncate">
      <span className="text-gray-500">{rotulo}: </span>
      <span className="font-medium text-gray-800">{valor}</span>
    </p>
  );
}

function Campo({ rotulo, valor, destaque, className }: { rotulo: string; valor: string; destaque?: boolean; className?: string }) {
  return (
    <div className={`min-w-0 ${className ?? ''}`}>
      <p className="text-[8px] uppercase tracking-wide text-gray-500">{rotulo}</p>
      <p className={`truncate ${destaque ? 'text-sm font-bold text-brand-800' : 'font-medium text-gray-800'}`}>{valor}</p>
    </div>
  );
}
