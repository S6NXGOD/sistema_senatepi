'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  MoreVertical, CheckCircle2, Printer, Trash2, Loader2,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { WhatsAppIcon } from '@/components/whatsapp-icon';
import {
  StatusParcela, TipoCobranca, Dinheiro,
  baixarParcela, excluirParcela, pixParcela,
  linkWhatsApp, mensagemCobranca, formatBRL, statusExibicao,
} from '@/lib/cobrancas';
import { CarnePrintModal } from '@/components/cobrancas/carne-print-modal';

export interface ParcelaAcao {
  id: string;
  numero: number;
  valor: Dinheiro;
  dataCompetencia: string;
  dataVencimento: string;
  status: StatusParcela;
  tipo: TipoCobranca;
  cobrancaId: string;
  filiado: { nomeCompleto: string; matricula: string; telefonePrincipal?: string | null };
}

/** Dropdown de ações de uma parcela: pagamento, carnê, WhatsApp e exclusão. */
export function ParcelaAcoes({ parcela, onMudou }: { parcela: ParcelaAcao; onMudou?: () => void }) {
  const [aberto, setAberto] = useState(false);
  const [confirmPagar, setConfirmPagar] = useState(false);
  const [confirmExcluir, setConfirmExcluir] = useState(false);
  const [carneAberto, setCarneAberto] = useState(false);
  const [ocupado, setOcupado] = useState<null | 'whatsapp'>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const st = statusExibicao(parcela);
  const podePagar = st !== 'PAGO' && st !== 'CANCELADO';
  const podeCobrar = st !== 'PAGO' && st !== 'CANCELADO';
  const podeImprimir = st !== 'CANCELADO';
  const podeExcluir = st !== 'PAGO' && st !== 'CANCELADO';

  const pagar = useMutation({
    mutationFn: () => baixarParcela(parcela.id),
    onSuccess: () => {
      toast.success(`Pagamento registrado (parcela ${parcela.numero}).`);
      setConfirmPagar(false);
      onMudou?.();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível registrar o pagamento.'),
  });

  const excluir = useMutation({
    mutationFn: () => excluirParcela(parcela.id),
    onSuccess: () => {
      toast.success(`Parcela ${parcela.numero} cancelada.`);
      setConfirmExcluir(false);
      onMudou?.();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível excluir a parcela.'),
  });

  async function cobrarWhatsApp() {
    setAberto(false);
    const tel = parcela.filiado.telefonePrincipal;
    if (!tel) {
      toast.error('Filiado sem telefone cadastrado para cobrança.');
      return;
    }
    // Abre a aba antes do await (evita bloqueio de popup).
    const win = window.open('', '_blank');
    setOcupado('whatsapp');
    try {
      const pix = await pixParcela(parcela.id).catch(() => null);
      const msg = mensagemCobranca({
        nome: parcela.filiado.nomeCompleto,
        vencimento: parcela.dataVencimento,
        valor: parcela.valor,
        copiaECola: pix?.copiaECola,
      });
      const url = linkWhatsApp(tel, msg);
      if (!url) {
        toast.error('Telefone inválido para WhatsApp.');
        win?.close();
        return;
      }
      if (win) win.location.href = url;
      else window.open(url, '_blank');
    } catch {
      toast.error('Não foi possível montar a cobrança.');
      win?.close();
    } finally {
      setOcupado(null);
    }
  }

  const item =
    'flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm hover:bg-muted disabled:opacity-50';

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        disabled={!!ocupado}
        aria-label="Ações da parcela"
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreVertical className="h-4 w-4" />}
      </button>

      {aberto && (
        <div className="absolute right-0 z-30 mt-1 w-56 overflow-hidden rounded-lg border bg-card py-1 shadow-lg">
          {podePagar && (
            <button className={item} onClick={() => { setAberto(false); setConfirmPagar(true); }}>
              <CheckCircle2 className="h-4 w-4 text-senatepi-700 dark:text-senatepi-400" /> Registrar pagamento
            </button>
          )}
          {podeImprimir && (
            <button className={item} onClick={() => { setAberto(false); setCarneAberto(true); }}>
              <Printer className="h-4 w-4 text-muted-foreground" /> Imprimir carnê
            </button>
          )}
          {podeCobrar && (
            <button className={item} onClick={cobrarWhatsApp}>
              <WhatsAppIcon className="h-4 w-4 text-[#25D366]" /> Cobrar via WhatsApp
            </button>
          )}
          {podeExcluir && (
            <button
              className={`${item} text-red-600 dark:text-red-400`}
              onClick={() => { setAberto(false); setConfirmExcluir(true); }}
            >
              <Trash2 className="h-4 w-4" /> Excluir
            </button>
          )}
          {!podePagar && !podeImprimir && !podeCobrar && !podeExcluir && (
            <p className="px-4 py-2.5 text-sm text-muted-foreground">Sem ações disponíveis.</p>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmPagar}
        title="Registrar pagamento"
        icon={<CheckCircle2 className="h-6 w-6" />}
        description={
          <>
            Confirmar o pagamento da <strong>parcela {parcela.numero}</strong> de{' '}
            <strong>{formatBRL(parcela.valor)}</strong>? A data de hoje será registrada como pagamento.
          </>
        }
        confirmLabel="Registrar pagamento"
        loading={pagar.isPending}
        onConfirm={() => pagar.mutate()}
        onClose={() => setConfirmPagar(false)}
      />

      <ConfirmDialog
        open={confirmExcluir}
        variant="destructive"
        title="Excluir parcela"
        icon={<Trash2 className="h-6 w-6" />}
        description={
          <>
            Excluir/cancelar a <strong>parcela {parcela.numero}</strong> ({formatBRL(parcela.valor)})? Esta
            ação não pode ser feita em parcelas já pagas.
          </>
        }
        confirmLabel="Excluir parcela"
        loading={excluir.isPending}
        onConfirm={() => excluir.mutate()}
        onClose={() => setConfirmExcluir(false)}
      />

      {carneAberto && (
        <CarnePrintModal cobrancaId={parcela.cobrancaId} onClose={() => setCarneAberto(false)} />
      )}
    </div>
  );
}
