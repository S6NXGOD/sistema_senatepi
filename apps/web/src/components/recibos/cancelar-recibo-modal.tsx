'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cancelarRecibo, formatBRL, type ReciboResumo } from '@/lib/recibos';

/** Abaixo disto não é motivo, é um caractere para escapar do campo. */
const MINIMO = 5;

/**
 * CANCELAR UM RECIBO — e por que o motivo é obrigatório.
 *
 * O número não volta para a fila: ele fica queimado. Daqui a um ano, quem
 * conferir a numeração vai encontrar o 007/2026 cancelado e a única pergunta
 * vai ser "por quê?". Se o campo aceitasse vazio, a resposta seria "ninguém
 * sabe" — e foi exatamente o que aconteceu com os cancelamentos da agenda, em
 * que os 2 motivos vivos estavam ESCRITOS errado
 * (`senatepi-motivo-do-cancelamento-mente`).
 *
 * O NOME DE QUEM CANCELA FICA GRAVADO, e o diálogo diz isso antes
 * (`senatepi-concluir-de-outro`: o que faltava não era a permissão, era o
 * aviso).
 */
export function CancelarReciboModal({
  recibo,
  onClose,
}: {
  recibo: ReciboResumo;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [motivo, setMotivo] = useState('');

  const cancelar = useMutation({
    mutationFn: () => cancelarRecibo(recibo.id, motivo.trim()),
    onSuccess: async () => {
      toast.success(`Recibo ${recibo.codigo} cancelado.`);
      await qc.invalidateQueries({ queryKey: ['recibos'] });
      onClose();
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message ?? 'Não foi possível cancelar o recibo.'),
  });

  return (
    <ConfirmDialog
      open
      variant="destructive"
      icon={<Ban className="h-6 w-6" />}
      title={`Cancelar o recibo ${recibo.codigo}?`}
      confirmLabel="Cancelar o recibo"
      cancelLabel="Voltar"
      loading={cancelar.isPending}
      confirmDisabled={motivo.trim().length < MINIMO}
      onConfirm={() => cancelar.mutate()}
      onClose={cancelar.isPending ? () => {} : onClose}
      description={
        <div className="space-y-3">
          <p>
            {recibo.pagadorNome} · <strong>{formatBRL(recibo.valor)}</strong>
            <br />
            <span className="text-muted-foreground">{recibo.referente}</span>
          </p>
          <p className="text-sm">
            O recibo <strong>não é apagado</strong>: ele continua no acervo com a
            tarja de cancelado, e o número <strong>{recibo.codigo}</strong> não é
            reaproveitado. O lançamento no caixa também fica — o dinheiro entrou.
          </p>
          <label className="block space-y-1.5 text-left">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Por que está cancelando? *
            </span>
            <textarea
              value={motivo}
              onChange={(ev) => setMotivo(ev.target.value)}
              rows={3}
              maxLength={300}
              autoFocus
              placeholder="Ex.: valor digitado errado; reemitido no nº 8."
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
            />
            <span className="block text-xs text-muted-foreground">
              Fica gravado no recibo e no histórico, com o seu nome.
            </span>
          </label>
        </div>
      }
    />
  );
}
