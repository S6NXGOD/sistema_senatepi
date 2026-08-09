'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { X, Loader2, UserX, Upload, FileDown, CalendarDays, Info, FileCheck2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { abrirPdf } from '@/lib/pdf';
import {
  desfiliarFiliado, anexarDocumentoFiliado,
  MOTIVOS_DESFILIACAO, type MotivoDesfiliacao,
} from '@/lib/filiados';

const inputCls =
  'h-11 w-full rounded-md border border-input bg-background px-3 text-base md:h-10 md:text-sm';

/** 'AAAA-MM' → 'agosto/2026'. */
function rotuloMes(valor: string): string {
  const [ano, mes] = valor.split('-');
  const nomes = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
  ];
  return `${nomes[Number(mes) - 1]}/${ano}`;
}

/**
 * Desfiliação do associado.
 *
 * Reestruturado a partir de três lacunas do fluxo antigo:
 *  • o motivo era texto livre, então não dava para responder "quantos saíram
 *    por inadimplência?" — virou lista fechada, com observação livre ao lado;
 *  • não havia MÊS DE CORTE, e o financeiro não sabia até quando descontar;
 *  • o termo em PDF vivia solto no menu da tabela, longe do momento em que
 *    ele é de fato necessário. Agora a emissão e o anexo do assinado estão
 *    aqui, na ordem em que a coisa acontece: gera → assina → anexa → confirma.
 */
export function DesfiliarModal({
  filiado,
  onClose,
  onConfirmed,
}: {
  filiado: { id: string; nomeCompleto: string };
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const [motivo, setMotivo] = useState<MotivoDesfiliacao | ''>('');
  const [observacoes, setObservacoes] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [salvando, setSalvando] = useState(false);

  /** Data do pedido: hoje. Editável — pedidos chegam com atraso ao balcão. */
  const hoje = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [dataPedido, setDataPedido] = useState(hoje);

  /**
   * Mês de corte. Padrão = mês corrente, que é o caso comum (o pedido de hoje
   * encerra na competência de hoje). O `<input type="month">` já entrega
   * 'AAAA-MM', exatamente o formato que a API espera.
   */
  const [mesCorte, setMesCorte] = useState(() => new Date().toISOString().slice(0, 7));

  const valido = !!motivo;

  async function confirmar() {
    if (!motivo) return;
    setSalvando(true);
    try {
      await desfiliarFiliado(filiado.id, {
        motivo,
        observacoes: observacoes.trim() || undefined,
        dataPedido,
        mesCorte,
      });
      // O termo assinado entra na aba Documentos JÁ CATEGORIZADO — é a prova
      // documental da saída, não pode virar "OUTRO" no meio dos RGs.
      if (arquivo) {
        await anexarDocumentoFiliado(
          filiado.id,
          arquivo,
          'Termo de Desfiliação (assinado)',
          'TERMO_DESFILIACAO',
        );
      }
      toast.success(`${filiado.nomeCompleto} foi desfiliado(a).`);
      onConfirmed();
    } catch (e: any) {
      const m = e?.response?.data?.message;
      toast.error(Array.isArray(m) ? m[0] : m ?? 'Não foi possível desfiliar.');
    } finally {
      setSalvando(false);
    }
  }

  /** Gera o termo com o que está na tela — antes de confirmar, para assinatura. */
  function baixarTermo() {
    const q = new URLSearchParams();
    if (motivo) q.set('motivo', motivo);
    if (observacoes.trim()) q.set('observacoes', observacoes.trim());
    if (mesCorte) q.set('mesCorte', mesCorte);
    const qs = q.toString();
    abrirPdf(`/filiados/${filiado.id}/desfiliacao/pdf${qs ? `?${qs}` : ''}`);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={salvando ? undefined : onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-card shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-amber-100 p-2 dark:bg-amber-950/40">
              <UserX className="h-6 w-6 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold leading-tight">Desfiliar associado</h3>
              <p className="truncate text-xs text-muted-foreground">{filiado.nomeCompleto}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} disabled={salvando}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {/* Aviso de preservação — tira o medo de que desfiliar apague o cadastro */}
          <p className="flex items-start gap-2 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:border-sky-900/50 dark:bg-sky-950/20 dark:text-sky-300">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              O cadastro será <strong>preservado no histórico</strong>, podendo ser reativado
              futuramente. O associado perde acesso a eventos e à Colônia de Férias.
            </span>
          </p>

          {/* ---- Motivo ---- */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Motivo da desfiliação *</label>
            <select
              className={inputCls}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value as MotivoDesfiliacao)}
            >
              <option value="">Selecione o motivo…</option>
              {MOTIVOS_DESFILIACAO.map((m) => (
                <option key={m.valor} value={m.valor}>{m.label}</option>
              ))}
            </select>
            {!motivo && (
              <p className="text-[11px] text-muted-foreground">
                É o que permite medir por que a categoria sai — obrigatório.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Observações adicionais <span className="font-normal text-muted-foreground">(opcional)</span>
            </label>
            <textarea
              className="min-h-20 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm"
              placeholder="Algo a acrescentar sobre a saída…"
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
            />
          </div>

          {/* ---- Corte financeiro ---- */}
          <div className="space-y-3 rounded-lg border border-brand-300/60 bg-brand-50/40 p-3 dark:border-brand-900/40 dark:bg-brand-900/10">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <CalendarDays className="h-4 w-4 text-brand-700 dark:text-brand-400" />
              Corte financeiro
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Data do pedido</label>
                <input
                  type="date"
                  className={inputCls}
                  value={dataPedido}
                  onChange={(e) => setDataPedido(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Última mensalidade
                </label>
                <input
                  type="month"
                  className={inputCls}
                  value={mesCorte}
                  onChange={(e) => setMesCorte(e.target.value)}
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {mesCorte
                ? <>A folha descontará até <strong>{rotuloMes(mesCorte)}</strong>, inclusive.</>
                : 'Sem mês de corte, o financeiro decide manualmente.'}
            </p>
          </div>

          {/* ---- Termo: gerar → assinar → anexar ---- */}
          <div className="space-y-2 rounded-lg border p-3">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <FileCheck2 className="h-4 w-4 text-muted-foreground" /> Termo de Desfiliação
            </p>

            <Button type="button" variant="outline" className="w-full" onClick={baixarTermo}>
              <FileDown className="h-4 w-4" /> Gerar e Baixar Termo Preenchido
            </Button>
            <p className="text-[11px] text-muted-foreground">
              O termo sai com o motivo e o mês de corte já preenchidos, pronto para assinatura.
            </p>

            <div className="pt-1">
              <input
                type="file"
                id="termo-desfiliacao"
                accept="application/pdf,image/*"
                className="hidden"
                onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
              />
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => document.getElementById('termo-desfiliacao')?.click()}
              >
                <Upload className="h-4 w-4" />
                {arquivo ? 'Trocar termo assinado' : 'Anexar Termo Assinado (PDF ou imagem)'}
              </Button>
              {arquivo && (
                <p className="mt-1.5 truncate text-[11px] text-muted-foreground">
                  <strong>{arquivo.name}</strong> — vai para a aba Documentos do filiado.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t bg-muted/30 p-4">
          <Button variant="outline" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button onClick={confirmar} disabled={salvando || !valido}>
            {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserX className="h-4 w-4" />}
            Confirmar desfiliação
          </Button>
        </div>
      </div>
    </div>
  );
}
