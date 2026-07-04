'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { X, Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  StatusColaborador,
  STATUS_COLAB,
  STATUS_COLAB_LABEL,
  alterarStatusColaborador,
} from '@/lib/colaboradores';

const sel = 'h-12 w-full rounded-md border border-input bg-background px-3 text-base md:h-10 md:text-sm';

/**
 * Alteração de status dinâmica:
 *  - INATIVO/AFASTADO → motivo obrigatório
 *  - DESLIGADO → data do desligamento (+ motivo opcional)
 *  - FERIAS → dias até o retorno automático a ATIVO
 */
export function StatusModal({
  colaborador,
  onClose,
  onConcluido,
}: {
  colaborador: { id: string; nome: string; status: StatusColaborador };
  onClose: () => void;
  onConcluido: () => void;
}) {
  const [status, setStatus] = useState<StatusColaborador>(colaborador.status);
  const [motivo, setMotivo] = useState('');
  const [dataDesligamento, setDataDesligamento] = useState('');
  const [diasFerias, setDiasFerias] = useState('');
  const [salvando, setSalvando] = useState(false);

  const precisaMotivo = status === 'INATIVO' || status === 'AFASTADO';
  const precisaData = status === 'DESLIGADO';
  const precisaDias = status === 'FERIAS';
  const valido =
    (status === 'ATIVO') ||
    (precisaMotivo && motivo.trim().length > 0) ||
    (precisaData && !!dataDesligamento) ||
    (precisaDias && Number(diasFerias) >= 1);

  async function salvar() {
    setSalvando(true);
    try {
      await alterarStatusColaborador(colaborador.id, {
        status,
        motivo: precisaMotivo || precisaData ? motivo.trim() || undefined : undefined,
        dataDesligamento: precisaData ? dataDesligamento : undefined,
        diasFerias: precisaDias ? Number(diasFerias) : undefined,
      });
      toast.success('Status atualizado.');
      onConcluido();
      onClose();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Não foi possível alterar o status.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={salvando ? undefined : onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-t-2xl bg-card shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-muted p-2"><ShieldCheck className="h-6 w-6 text-senatepi-800 dark:text-senatepi-400" /></div>
            <div>
              <h3 className="font-semibold leading-tight">Alterar status</h3>
              <p className="text-xs text-muted-foreground">{colaborador.nome}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} disabled={salvando}><X className="h-4 w-4" /></Button>
        </div>

        <div className="space-y-4 p-5">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Novo status</label>
            <select className={sel} value={status} onChange={(e) => setStatus(e.target.value as StatusColaborador)}>
              {STATUS_COLAB.map((s) => <option key={s} value={s}>{STATUS_COLAB_LABEL[s]}</option>)}
            </select>
          </div>

          {precisaMotivo && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Motivo *</label>
              <Input placeholder="Descreva o motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            </div>
          )}
          {precisaData && (
            <>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Data do desligamento *</label>
                <Input type="date" value={dataDesligamento} onChange={(e) => setDataDesligamento(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Motivo (opcional)</label>
                <Input placeholder="Motivo do desligamento" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
              </div>
            </>
          )}
          {precisaDias && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Dias de férias *</label>
              <Input type="number" min={1} inputMode="numeric" placeholder="Ex.: 30" value={diasFerias} onChange={(e) => setDiasFerias(e.target.value)} />
              <p className="text-xs text-muted-foreground">O colaborador volta automaticamente para <strong>Ativo</strong> após esse prazo.</p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t bg-muted/30 p-4">
          <Button variant="outline" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando || !valido}>
            {salvando && <Loader2 className="h-4 w-4 animate-spin" />} Aplicar
          </Button>
        </div>
      </div>
    </div>
  );
}
