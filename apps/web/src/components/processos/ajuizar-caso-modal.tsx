'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileCheck2, Landmark, Loader2, PencilLine, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { formalizarProcesso, mascararNPU } from '@/lib/processos';

const inputCls = 'h-11 w-full rounded-md border border-input bg-background px-3 text-sm md:h-10';

type Caminho = 'DATAJUD' | 'MANUAL';

/**
 * AJUIZAR O CASO — o outro lado do desfecho "Virou processo novo".
 *
 * VOCABULÁRIO: na tela o verbo é AJUIZAR, que é o que de fato acontece (o caso
 * é distribuído e ganha número). Na API a rota continua `PATCH /:id/formalizar`
 * — trocar o nome de um endpoint que já está no ar não entrega nada a quem usa
 * o sistema e custa uma janela de incompatibilidade no deploy. A diferença é
 * proposital; não "corrija" um dos lados sem o outro.
 *
 * Dois caminhos, os dois legítimos:
 *  - DataJud: informa o NPU e o sistema puxa classe, vara, assunto e todas as
 *    movimentações;
 *  - Manual: informa o NPU e preenche à mão. É o que salva quando o tribunal
 *    ainda não indexou o processo no CNJ — comum nos primeiros dias após a
 *    distribuição, quando a busca simplesmente não acha nada.
 */
export function AjuizarCasoModal({
  processo, open, onClose, onFormalizado,
}: {
  processo: { id: string; titulo?: string | null; assuntoPrincipal?: string | null } | null;
  open: boolean;
  onClose: () => void;
  onFormalizado: () => void;
}) {
  const [caminho, setCaminho] = useState<Caminho>('DATAJUD');
  const [numeroCNJ, setNumeroCNJ] = useState('');
  const [tribunal, setTribunal] = useState('');
  const [classeProcessual, setClasse] = useState('');
  const [assuntoPrincipal, setAssunto] = useState('');
  const [orgaoJulgador, setOrgao] = useState('');
  const [dataDistribuicao, setDistribuicao] = useState('');

  useEffect(() => {
    if (!open) return;
    setCaminho('DATAJUD');
    setNumeroCNJ('');
    setTribunal('');
    setClasse('');
    setAssunto(processo?.assuntoPrincipal ?? '');
    setOrgao('');
    setDistribuicao('');
  }, [open, processo]);

  const salvar = useMutation({
    mutationFn: () =>
      formalizarProcesso(processo!.id, {
        numeroCNJ: numeroCNJ.replace(/\D/g, ''),
        tribunal: tribunal.trim() || undefined,
        sincronizar: caminho === 'DATAJUD',
        ...(caminho === 'MANUAL'
          ? {
              classeProcessual: classeProcessual.trim() || undefined,
              assuntoPrincipal: assuntoPrincipal.trim() || undefined,
              orgaoJulgador: orgaoJulgador.trim() || undefined,
              dataDistribuicao: dataDistribuicao
                ? new Date(`${dataDistribuicao}T12:00:00`).toISOString()
                : undefined,
            }
          : {}),
      }),
    onSuccess: (resp) => {
      if (resp.avisoSincronizacao) {
        // Formalizou, mas o CNJ não respondeu. Não é falha: o processo já está
        // salvo e o botão "Sincronizar" do detalhe resolve depois.
        toast.warning('Processo formalizado, mas o DataJud não respondeu agora. Use "Sincronizar" no detalhe.');
      } else {
        toast.success('Processo formalizado.');
      }
      onFormalizado();
      onClose();
    },
    onError: (e: any) => {
      const m = e?.response?.data?.message;
      toast.error(Array.isArray(m) ? m[0] : m ?? 'Não foi possível formalizar o processo.');
    },
  });

  if (!open || !processo) return null;

  const npuValido = numeroCNJ.replace(/\D/g, '').length === 20;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={salvar.isPending ? undefined : onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-card shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b p-5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 dark:bg-violet-900/30">
              <FileCheck2 className="h-4.5 w-4.5 text-violet-700 dark:text-violet-400" />
            </span>
            <div className="min-w-0">
              <h3 className="text-base font-bold">Ajuizar o caso</h3>
              <p className="truncate text-xs text-muted-foreground">{processo.titulo || 'Caso sem título'}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Número do processo (NPU) *</label>
            <Input
              inputMode="numeric"
              autoFocus
              placeholder="0000000-00.0000.0.00.0000"
              value={numeroCNJ}
              onChange={(e) => setNumeroCNJ(mascararNPU(e.target.value))}
              className="font-mono tracking-tight"
            />
            <p className="text-[11px] text-muted-foreground">
              É o número que tira o caso da fase pré-processual. O tribunal é identificado por ele.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Como preencher o resto?</label>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {([
                { k: 'DATAJUD' as const, icon: Landmark, titulo: 'Buscar no DataJud', ajuda: 'Puxa classe, vara, assunto e as movimentações do CNJ.' },
                { k: 'MANUAL' as const, icon: PencilLine, titulo: 'Preencher à mão', ajuda: 'Para quando o CNJ ainda não indexou o processo.' },
              ]).map((o) => {
                const Icon = o.icon;
                const ativo = caminho === o.k;
                return (
                  <button
                    key={o.k}
                    type="button"
                    onClick={() => setCaminho(o.k)}
                    className={cn(
                      'flex items-start gap-2 rounded-lg border p-2.5 text-left transition',
                      ativo ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20' : 'hover:bg-muted/50',
                    )}
                  >
                    <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', ativo ? 'text-brand-700 dark:text-brand-400' : 'text-muted-foreground')} />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{o.titulo}</span>
                      <span className="block text-[11px] leading-snug text-muted-foreground">{o.ajuda}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {caminho === 'MANUAL' ? (
            <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Classe processual</label>
                <Input value={classeProcessual} onChange={(e) => setClasse(e.target.value)} placeholder="Ex.: Ação Trabalhista — Rito Ordinário" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Assunto</label>
                <Input value={assuntoPrincipal} onChange={(e) => setAssunto(e.target.value)} placeholder="Ex.: Adicional de Insalubridade" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Vara / órgão julgador</label>
                <Input value={orgaoJulgador} onChange={(e) => setOrgao(e.target.value)} placeholder="Ex.: 1ª Vara do Trabalho de Teresina" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Data de distribuição</label>
                <input type="date" className={inputCls} value={dataDistribuicao} onChange={(e) => setDistribuicao(e.target.value)} />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Depois é só usar <strong>Sincronizar</strong> no detalhe para completar com os dados do CNJ.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Tribunal <span className="font-normal text-muted-foreground">(opcional)</span>
              </label>
              <Input className="uppercase" placeholder="Ex.: TJPI, TRT22" value={tribunal} onChange={(e) => setTribunal(e.target.value)} />
              <p className="text-[11px] text-muted-foreground">
                Só é necessário quando o tribunal não pode ser derivado do número.
                A consulta pode levar até 30 segundos.
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t bg-muted/30 p-4">
          <Button variant="outline" onClick={onClose} disabled={salvar.isPending}>Cancelar</Button>
          <Button onClick={() => salvar.mutate()} disabled={salvar.isPending || !npuValido}>
            {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck2 className="h-4 w-4" />}
            {caminho === 'DATAJUD' ? 'Formalizar e buscar' : 'Formalizar'}
          </Button>
        </div>
      </div>
    </div>
  );
}
