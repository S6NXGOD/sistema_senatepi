'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, X, Plus, Landmark } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { baixarParcela, formatBRL, Dinheiro } from '@/lib/cobrancas';
import { listarContas, criarConta } from '@/lib/financeiro';

interface ParcelaBaixa {
  id: string;
  numero: number;
  valor: Dinheiro;
  filiado: { nomeCompleto: string };
}

/** Modal de baixa realista: valor esperado × valor real pago + conta de destino. */
export function RegistrarPagamentoModal({
  parcela, onClose, onConcluido,
}: { parcela: ParcelaBaixa; onClose: () => void; onConcluido?: () => void }) {
  const qc = useQueryClient();
  const [valorPago, setValorPago] = useState(Number(parcela.valor).toFixed(2));
  const [contaId, setContaId] = useState('');
  const [novaConta, setNovaConta] = useState(false);
  const [nomeConta, setNomeConta] = useState('');

  const contasQuery = useQuery({ queryKey: ['financeiro-contas'], queryFn: listarContas });
  const contas = contasQuery.data ?? [];

  // Seleciona a primeira conta assim que a lista chega.
  useEffect(() => {
    if (!contaId && contas.length > 0) setContaId(contas[0].id);
  }, [contas, contaId]);

  const criar = useMutation({
    mutationFn: () => criarConta({ nome: nomeConta.trim() }),
    onSuccess: async (conta) => {
      toast.success('Conta bancária criada.');
      await qc.invalidateQueries({ queryKey: ['financeiro-contas'] });
      setContaId(conta.id);
      setNovaConta(false);
      setNomeConta('');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível criar a conta.'),
  });

  const baixar = useMutation({
    mutationFn: () => baixarParcela(parcela.id, { valorPago: Number(valorPago), contaBancariaId: contaId }),
    onSuccess: () => {
      toast.success(`Pagamento registrado (parcela ${parcela.numero}).`);
      onConcluido?.();
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível registrar o pagamento.'),
  });

  function confirmar() {
    if (!(Number(valorPago) > 0)) return toast.error('Informe um valor pago válido.');
    if (!contaId) return toast.error('Selecione a conta bancária de destino.');
    baixar.mutate();
  }

  const esperado = Number(parcela.valor);
  const pago = Number(valorPago) || 0;
  const diff = pago - esperado;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={baixar.isPending ? undefined : onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-t-2xl bg-card shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-senatepi-50 p-2 dark:bg-senatepi-900/30"><CheckCircle2 className="h-6 w-6 text-senatepi-700 dark:text-senatepi-400" /></div>
            <div>
              <h3 className="font-semibold leading-tight">Registrar pagamento</h3>
              <p className="text-xs text-muted-foreground">Parcela {parcela.numero} · {parcela.filiado.nomeCompleto}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={baixar.isPending} className="text-muted-foreground hover:text-foreground disabled:opacity-50"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-4 p-5">
          {/* Valor esperado × valor pago */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="text-[11px] uppercase text-muted-foreground">Valor esperado</p>
              <p className="text-lg font-bold tabular-nums">{formatBRL(esperado)}</p>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] uppercase text-muted-foreground">Valor real pago *</label>
              <Input type="number" inputMode="decimal" step="0.01" min="0" value={valorPago} onChange={(e) => setValorPago(e.target.value)} />
            </div>
          </div>
          {Math.abs(diff) >= 0.01 && (
            <p className={`text-xs ${diff > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-sky-600 dark:text-sky-400'}`}>
              {diff > 0 ? `Acréscimo de ${formatBRL(diff)} (juros/multa).` : `Desconto de ${formatBRL(-diff)}.`}
            </p>
          )}

          {/* Conta de destino */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-sm font-medium"><Landmark className="h-4 w-4 text-muted-foreground" /> Conta bancária de destino *</label>
            {contasQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando contas…</div>
            ) : novaConta ? (
              <div className="flex gap-2">
                <Input placeholder="Nome da conta (ex.: Caixa do Sindicato)" value={nomeConta} onChange={(e) => setNomeConta(e.target.value)} />
                <Button size="sm" disabled={!nomeConta.trim() || criar.isPending} onClick={() => criar.mutate()}>
                  {criar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Criar'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setNovaConta(false)}>Cancelar</Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <select
                  className="h-12 w-full rounded-md border border-input bg-background px-3 text-base sm:h-10 sm:text-sm"
                  value={contaId}
                  onChange={(e) => setContaId(e.target.value)}
                >
                  {contas.length === 0 && <option value="">Nenhuma conta cadastrada</option>}
                  {contas.map((c) => (
                    <option key={c.id} value={c.id}>{c.nome}{c.instituicao ? ` — ${c.instituicao}` : ''}</option>
                  ))}
                </select>
                <Button size="icon" variant="outline" title="Nova conta" onClick={() => setNovaConta(true)}><Plus className="h-4 w-4" /></Button>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t bg-muted/30 p-4">
          <Button variant="outline" onClick={onClose} disabled={baixar.isPending}>Cancelar</Button>
          <Button onClick={confirmar} disabled={baixar.isPending || !contaId}>
            {baixar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Confirmar recebimento
          </Button>
        </div>
      </div>
    </div>
  );
}
