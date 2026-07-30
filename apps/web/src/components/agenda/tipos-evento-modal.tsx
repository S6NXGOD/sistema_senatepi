'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { X, Plus, Loader2, Trash2, Check, Pencil, EyeOff, Eye, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  listarTiposEvento, criarTipoEvento, atualizarTipoEvento, excluirTipoEvento,
  CORES_TIPO, PALETA_TIPO, TipoEventoItem,
} from '@/lib/agenda';

function Swatches({ valor, onEscolher }: { valor: string; onEscolher: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {CORES_TIPO.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onEscolher(c)}
          title={c}
          className={cn(
            'h-6 w-6 rounded-full ring-offset-2 ring-offset-card transition',
            PALETA_TIPO[c].ponto,
            valor === c ? 'ring-2 ring-foreground' : 'hover:ring-2 hover:ring-muted-foreground/40',
          )}
        />
      ))}
    </div>
  );
}

function LinhaTipo({
  t, podeEditar, podeExcluir, onChanged,
}: {
  t: TipoEventoItem; podeEditar: boolean; podeExcluir: boolean; onChanged: () => void;
}) {
  const qc = useQueryClient();
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(t.nome);
  const [cor, setCor] = useState(t.cor);

  useEffect(() => { setNome(t.nome); setCor(t.cor); }, [t.nome, t.cor]);

  const invalidar = () => { qc.invalidateQueries({ queryKey: ['tipos-evento'] }); onChanged(); };
  const salvar = useMutation({
    mutationFn: () => atualizarTipoEvento(t.id, { nome: nome.trim(), cor }),
    onSuccess: () => { toast.success('Tipo atualizado.'); setEditando(false); invalidar(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível salvar.'),
  });
  const toggle = useMutation({
    mutationFn: () => atualizarTipoEvento(t.id, { ativo: !t.ativo }),
    onSuccess: () => invalidar(),
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Falhou.'),
  });
  const excluir = useMutation({
    mutationFn: () => excluirTipoEvento(t.id),
    onSuccess: () => { toast.success('Tipo excluído.'); invalidar(); },
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
      <span className={cn('h-3.5 w-3.5 shrink-0 rounded-full', PALETA_TIPO[t.cor]?.ponto ?? PALETA_TIPO.slate.ponto)} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-sm font-medium">
          {t.nome}
          {t.sistema && <Lock className="h-3 w-3 text-muted-foreground" aria-label="Tipo do sistema" />}
          {!t.ativo && <span className="rounded bg-muted px-1.5 text-[10px] text-muted-foreground">oculto</span>}
        </p>
      </div>
      {podeEditar && (
        <>
          <button type="button" onClick={() => setEditando(true)} title="Editar" className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <Pencil className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => toggle.mutate()} title={t.ativo ? 'Ocultar' : 'Reativar'} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            {t.ativo ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </>
      )}
      {podeExcluir && !t.sistema && (
        <button type="button" onClick={() => excluir.mutate()} disabled={excluir.isPending} title="Excluir" className="rounded p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30">
          {excluir.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </button>
      )}
    </li>
  );
}

export function TiposEventoModal({
  open, onClose, podeEditar, podeExcluir, onChanged,
}: {
  open: boolean;
  onClose: () => void;
  podeEditar: boolean;
  podeExcluir: boolean;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const { data: tipos = [], isLoading } = useQuery({
    queryKey: ['tipos-evento', true],
    queryFn: () => listarTiposEvento(true),
    enabled: open,
  });

  const [novoNome, setNovoNome] = useState('');
  const [novaCor, setNovaCor] = useState<string>('sky');

  const invalidar = () => { qc.invalidateQueries({ queryKey: ['tipos-evento'] }); onChanged(); };
  const criar = useMutation({
    mutationFn: () => criarTipoEvento({ nome: novoNome.trim(), cor: novaCor }),
    onSuccess: () => { toast.success('Tipo criado.'); setNovoNome(''); setNovaCor('sky'); invalidar(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível criar.'),
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b p-5">
          <div>
            <h3 className="font-semibold">Tipos de evento</h3>
            <p className="text-xs text-muted-foreground">Personalize as categorias da agenda</p>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <ul className="space-y-2">
              {tipos.map((t) => (
                <LinhaTipo key={t.id} t={t} podeEditar={podeEditar} podeExcluir={podeExcluir} onChanged={onChanged} />
              ))}
            </ul>
          )}
        </div>

        {podeEditar && (
          <div className="space-y-2 border-t p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Novo tipo</p>
            <Input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder="Ex.: Sustentação oral" />
            <Swatches valor={novaCor} onEscolher={setNovaCor} />
            <Button className="w-full" onClick={() => criar.mutate()} disabled={criar.isPending || novoNome.trim().length < 2}>
              {criar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Adicionar tipo
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
