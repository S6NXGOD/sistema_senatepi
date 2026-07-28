'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  MoreVertical, CheckCircle2, Printer, Trash2, Loader2,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { WhatsAppIcon } from '@/components/whatsapp-icon';
import {
  StatusParcela, TipoCobranca, Dinheiro,
  excluirParcela, pixParcela,
  linkWhatsApp, mensagemCobranca, formatBRL, statusExibicao,
} from '@/lib/cobrancas';
import { CarnePrintModal } from '@/components/cobrancas/carne-print-modal';
import { RegistrarPagamentoModal } from '@/components/cobrancas/registrar-pagamento-modal';

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
  const [pagarAberto, setPagarAberto] = useState(false);
  const [confirmExcluir, setConfirmExcluir] = useState(false);
  const [carneAberto, setCarneAberto] = useState(false);
  const [ocupado, setOcupado] = useState<null | 'whatsapp'>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [montado, setMontado] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMontado(true), []);

  // Abre o menu calculando a posição a partir do botão (portal fixo → não é
  // cortado pelo overflow da tabela/card). Abre para cima se faltar espaço.
  function toggleMenu() {
    if (aberto) { setAberto(false); return; }
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const LARGURA = 224; // w-56
    const ALTURA = 210; // estimativa p/ decidir abrir acima
    const left = Math.max(8, Math.min(r.right - LARGURA, window.innerWidth - LARGURA - 8));
    const abrirAcima = r.bottom + ALTURA > window.innerHeight;
    const top = abrirAcima ? Math.max(8, r.top - ALTURA) : r.bottom + 4;
    setPos({ top, left });
    setAberto(true);
  }

  // Fecha ao clicar fora, rolar ou redimensionar (posição ficaria defasada).
  useEffect(() => {
    if (!aberto) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setAberto(false);
    }
    function fechar() { setAberto(false); }
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('scroll', fechar, true);
    window.addEventListener('resize', fechar);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('scroll', fechar, true);
      window.removeEventListener('resize', fechar);
    };
  }, [aberto]);

  const st = statusExibicao(parcela);
  const podePagar = st !== 'PAGO' && st !== 'CANCELADO';
  const podeCobrar = st !== 'PAGO' && st !== 'CANCELADO';
  const podeImprimir = st !== 'CANCELADO';
  const podeExcluir = st !== 'PAGO' && st !== 'CANCELADO';

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
    <div className="inline-flex">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggleMenu}
        disabled={!!ocupado}
        aria-label="Ações da parcela"
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreVertical className="h-4 w-4" />}
      </button>

      {aberto && pos && montado && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: 224 }}
          className="z-[70] overflow-hidden rounded-lg border bg-card py-1 shadow-lg"
        >
          {podePagar && (
            <button className={item} onClick={() => { setAberto(false); setPagarAberto(true); }}>
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
        </div>,
        document.body,
      )}

      {pagarAberto && (
        <RegistrarPagamentoModal
          parcela={{ id: parcela.id, numero: parcela.numero, valor: parcela.valor, filiado: { nomeCompleto: parcela.filiado.nomeCompleto } }}
          onClose={() => setPagarAberto(false)}
          onConcluido={onMudou}
        />
      )}

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
