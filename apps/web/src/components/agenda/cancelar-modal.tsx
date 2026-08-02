'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Ban, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  cancelarCompromisso, listarCategoriasCancelamento,
  type Compromisso, type CategoriaCancelamento,
} from '@/lib/agenda';
import { useQuery } from '@tanstack/react-query';

/**
 * Cancelar — escolher a CATEGORIA basta.
 *
 * O cancelamento já foi um clique e pronto: o evento virava "Cancelado" no
 * quadro sem dizer por quê. A correção foi a categoria — padronizada, responde
 * a pergunta e vira estatística. O texto obrigatório que veio junto acabou
 * sobrando: quem escolhia "Filiado não compareceu" era obrigado a escrever
 * "o filiado não compareceu". Agora é opcional, para o caso que a categoria
 * não cobre.
 */
export function CancelarModal({
  compromisso, open, onClose, onCancelado, categoriaInicial,
}: {
  compromisso: Compromisso | null;
  open: boolean;
  onClose: () => void;
  onCancelado: () => void;
  /** Pré-seleciona a categoria (ex.: veio do atalho de não comparecimento). */
  categoriaInicial?: string;
}) {
  const [motivo, setMotivo] = useState('');
  const [categoria, setCategoria] = useState('');

  // A categoria é o que torna o cancelamento mensurável; o texto explica o caso.
  const cats = useQuery({
    queryKey: ['categorias-cancelamento'],
    queryFn: listarCategoriasCancelamento,
    enabled: open,
    staleTime: 5 * 60_000,
  });
  const categorias: CategoriaCancelamento[] = cats.data ?? [];
  const escolhida = categorias.find((c) => c.slug === categoria);

  useEffect(() => {
    if (!open) return;
    setCategoria(categoriaInicial ?? '');
    // Nada de texto pré-escrito: a categoria já diz o que ele diria.
    setMotivo('');
  }, [open, categoriaInicial]);

  const salvar = useMutation({
    mutationFn: () => cancelarCompromisso(compromisso!.id, categoria, motivo.trim() || undefined),
    onSuccess: () => { toast.success('Atividade cancelada.'); onCancelado(); onClose(); },
    onError: (e: any) => {
      const m = e?.response?.data?.message;
      toast.error(Array.isArray(m) ? m[0] : m ?? 'Não foi possível cancelar.');
    },
  });

  if (!open || !compromisso) return null;

  // Só a categoria: é ela que explica e que vira estatística.
  const valido = !!categoria;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={salvar.isPending ? undefined : onClose}
    >
      <div
        className="flex w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-card shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b p-5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-100 dark:bg-red-900/30">
              <Ban className="h-4.5 w-4.5 text-red-600 dark:text-red-400" />
            </span>
            <div className="min-w-0">
              <h3 className="text-base font-bold">Cancelar atividade</h3>
              <p className="truncate text-xs text-muted-foreground">{compromisso.titulo}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              A atividade sai do fluxo de trabalho, mas <strong>não é apagada</strong>. Ela pode ser
              reaberta depois — e o cancelamento fica registrado.
            </span>
          </p>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Por que não aconteceu? *</label>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {categorias.map((c) => (
                <button
                  key={c.slug}
                  type="button"
                  onClick={() => setCategoria(c.slug)}
                  className={cn(
                    'rounded-lg border p-2.5 text-left transition',
                    categoria === c.slug
                      ? 'border-red-400 bg-red-50 dark:bg-red-950/20'
                      : 'hover:bg-muted/50',
                  )}
                >
                  <span className="block text-sm font-medium">{c.label}</span>
                  <span className="block text-[11px] leading-snug text-muted-foreground">{c.ajuda}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Quer detalhar? <span className="font-normal text-muted-foreground">(opcional)</span>
            </label>
            <textarea
              className="min-h-20 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder={
                escolhida
                  ? `"${escolhida.label}" já fica registrado. Escreva só se houver algo a acrescentar.`
                  : 'Algo a acrescentar…'
              }
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t bg-muted/30 p-4">
          <Button variant="outline" onClick={onClose} disabled={salvar.isPending}>Voltar</Button>
          <Button
            variant="destructive"
            onClick={() => salvar.mutate()}
            disabled={salvar.isPending || !valido}
          >
            {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
            Cancelar atividade
          </Button>
        </div>
      </div>
    </div>
  );
}
