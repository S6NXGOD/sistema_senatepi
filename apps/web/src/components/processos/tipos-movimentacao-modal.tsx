'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { X, Plus, Loader2, Trash2, Check, Pencil, EyeOff, Eye, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { CORES_PALETA, PALETA } from '@/lib/paleta-cores';
import {
  listarTiposMovimentacao, criarTipoMovimentacao, atualizarTipoMovimentacao,
  excluirTipoMovimentacao, TipoAndamento,
} from '@/lib/movimentacoes';

function Swatches({ valor, onEscolher }: { valor: string; onEscolher: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {CORES_PALETA.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onEscolher(c)}
          title={c}
          className={cn(
            'h-6 w-6 rounded-full ring-offset-2 ring-offset-card transition',
            PALETA[c].ponto,
            valor === c ? 'ring-2 ring-foreground' : 'hover:ring-2 hover:ring-muted-foreground/40',
          )}
        />
      ))}
    </div>
  );
}

function Linha({ t, podeExcluir, onMudou }: { t: TipoAndamento; podeExcluir: boolean; onMudou: () => void }) {
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(t.nome);
  const [cor, setCor] = useState(t.cor);
  useEffect(() => { setNome(t.nome); setCor(t.cor); }, [t.nome, t.cor]);

  const salvar = useMutation({
    mutationFn: () => atualizarTipoMovimentacao(t.id, { nome: nome.trim(), cor }),
    onSuccess: () => { toast.success('Tipo atualizado.'); setEditando(false); onMudou(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível salvar.'),
  });
  const toggle = useMutation({
    mutationFn: () => atualizarTipoMovimentacao(t.id, { ativo: !t.ativo }),
    onSuccess: () => onMudou(),
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Falhou.'),
  });
  const excluir = useMutation({
    mutationFn: () => excluirTipoMovimentacao(t.id),
    onSuccess: () => { toast.success('Tipo excluído.'); onMudou(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível excluir.'),
  });

  if (editando) {
    return (
      <li className="space-y-2 rounded-lg border p-3">
        <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do tipo" />
        <Swatches valor={cor} onEscolher={setCor} />
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => { setEditando(false); setNome(t.nome); setCor(t.cor); }}>Cancelar</Button>
          <Button size="sm" onClick={() => salvar.mutate()} disabled={salvar.isPending || nome.trim().length < 2}>
            {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Salvar
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className={cn('flex items-center gap-3 rounded-lg border p-2.5', !t.ativo && 'opacity-60')}>
      <span className={cn('h-3.5 w-3.5 shrink-0 rounded-full', PALETA[t.cor]?.ponto ?? PALETA.slate.ponto)} />
      <p className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-sm font-medium">
        {t.nome}
        {t.sistema && <Lock className="h-3 w-3 text-muted-foreground" aria-label="Tipo do sistema" />}
        {!t.ativo && <span className="rounded bg-muted px-1.5 text-[10px] text-muted-foreground">oculto</span>}
      </p>
      <button type="button" onClick={() => setEditando(true)} title="Editar" className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
        <Pencil className="h-4 w-4" />
      </button>
      <button type="button" onClick={() => toggle.mutate()} title={t.ativo ? 'Ocultar' : 'Reativar'} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
        {t.ativo ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
      {podeExcluir && !t.sistema && (
        <button type="button" onClick={() => excluir.mutate()} disabled={excluir.isPending} title="Excluir" className="rounded p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30">
          {excluir.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </button>
      )}
    </li>
  );
}

/** Gerenciador dos tipos de movimentação (o ⚙ ao lado do seletor de tipo). */
export function TiposMovimentacaoModal({
  open, onClose, podeExcluir,
}: {
  open: boolean;
  onClose: () => void;
  podeExcluir: boolean;
}) {
  const qc = useQueryClient();
  const { data: tipos = [], isLoading } = useQuery({
    queryKey: ['tipos-movimentacao', true],
    queryFn: () => listarTiposMovimentacao(true),
    enabled: open,
  });

  const [novoNome, setNovoNome] = useState('');
  const [novaCor, setNovaCor] = useState('blue');
  const invalidar = () => qc.invalidateQueries({ queryKey: ['tipos-movimentacao'] });

  const criar = useMutation({
    mutationFn: () => criarTipoMovimentacao({ nome: novoNome.trim(), cor: novaCor }),
    onSuccess: () => { toast.success('Tipo criado.'); setNovoNome(''); setNovaCor('blue'); invalidar(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível criar.'),
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b p-5">
          <div>
            <h3 className="font-semibold">Tipos de movimentação</h3>
            <p className="text-xs text-muted-foreground">Categorias dos andamentos do processo</p>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <ul className="space-y-2">
              {tipos.map((t) => (
                <Linha key={t.id} t={t} podeExcluir={podeExcluir} onMudou={invalidar} />
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-2 border-t p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Novo tipo</p>
          <Input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder="Ex.: Perícia designada" />
          <Swatches valor={novaCor} onEscolher={setNovaCor} />
          <Button className="w-full" onClick={() => criar.mutate()} disabled={criar.isPending || novoNome.trim().length < 2}>
            {criar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Adicionar tipo
          </Button>
        </div>
      </div>
    </div>
  );
}
