'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { X, Loader2, UserX, Upload, FileDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { abrirPdf } from '@/lib/pdf';
import { desfiliarFiliado, anexarDocumentoFiliado } from '@/lib/filiados';

/**
 * Desfiliação com motivo (opcional) e anexo do termo (opcional). Também permite
 * baixar o Termo de Desfiliação em PDF (com o motivo informado). Bottom sheet no mobile.
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
  const [motivo, setMotivo] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function confirmar() {
    setSalvando(true);
    try {
      await desfiliarFiliado(filiado.id, motivo.trim() || undefined);
      if (arquivo) await anexarDocumentoFiliado(filiado.id, arquivo, 'Termo de Desfiliação');
      toast.success(`${filiado.nomeCompleto} foi desfiliado(a).`);
      onConfirmed();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Não foi possível desfiliar.');
    } finally {
      setSalvando(false);
    }
  }

  function baixarTermo() {
    const q = motivo.trim() ? `?motivo=${encodeURIComponent(motivo.trim())}` : '';
    abrirPdf(`/filiados/${filiado.id}/desfiliacao/pdf${q}`);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={salvando ? undefined : onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-t-2xl bg-card shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-amber-100 p-2 dark:bg-amber-950/40"><UserX className="h-6 w-6 text-amber-600 dark:text-amber-400" /></div>
            <div>
              <h3 className="font-semibold leading-tight">Desfiliar associado?</h3>
              <p className="text-xs text-muted-foreground">{filiado.nomeCompleto}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} disabled={salvando}><X className="h-4 w-4" /></Button>
        </div>

        <div className="space-y-4 p-5">
          <p className="text-sm text-muted-foreground">
            Será marcado como <strong>DESFILIADO</strong> e perderá acesso a eventos e à Colônia. O cadastro é
            preservado e a situação pode ser revertida depois.
          </p>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Motivo (opcional)</label>
            <textarea
              className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm"
              placeholder="Descreva o motivo da desfiliação…"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Anexar termo assinado (opcional)</label>
            <input type="file" id="termo-desfiliacao" className="hidden" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => document.getElementById('termo-desfiliacao')?.click()}>
                <Upload className="h-4 w-4" /> {arquivo ? 'Trocar arquivo' : 'Selecionar arquivo'}
              </Button>
              {arquivo && <span className="truncate text-xs text-muted-foreground">{arquivo.name}</span>}
            </div>
          </div>

          <Button type="button" variant="ghost" size="sm" className="text-senatepi-800 dark:text-senatepi-400" onClick={baixarTermo}>
            <FileDown className="h-4 w-4" /> Baixar Termo de Desfiliação (PDF)
          </Button>
        </div>

        <div className="flex justify-end gap-2 border-t bg-muted/30 p-4">
          <Button variant="outline" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button onClick={confirmar} disabled={salvando}>
            {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserX className="h-4 w-4" />} Desfiliar
          </Button>
        </div>
      </div>
    </div>
  );
}
