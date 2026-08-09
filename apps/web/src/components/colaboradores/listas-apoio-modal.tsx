'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { X, Plus, Loader2, Trash2, Check, Pencil, EyeOff, Eye, Briefcase, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  listarCargos, criarCargo, atualizarCargo, removerCargo,
  listarDepartamentos, criarDepartamento, atualizarDepartamento, removerDepartamento,
  type ItemLista,
} from '@/lib/colaboradores';

/**
 * Cargos e Departamentos — as listas que alimentam o formulário de colaborador.
 *
 * Vieram do módulo "Cadastros Base", que tinha menu e permissão só para isto.
 * Como só esta tela as consome, moraram para cá no mesmo padrão dos tipos de
 * evento da Agenda: um diálogo ao lado de quem usa.
 *
 * OCULTAR, e não excluir, é a ação principal. `cargo_id`/`departamento_id` são
 * obrigatórios em colaborador, então um item em uso NUNCA pode ser apagado —
 * antes disso, a única saída era conviver com cargos extintos na lista.
 */

type Api = {
  listar: (incluirInativos?: boolean) => Promise<ItemLista[]>;
  criar: (nome: string) => Promise<ItemLista>;
  atualizar: (id: string, dto: { nome?: string; ativo?: boolean }) => Promise<unknown>;
  remover: (id: string) => Promise<unknown>;
};

const API: Record<'cargos' | 'departamentos', Api> = {
  cargos: { listar: listarCargos, criar: criarCargo, atualizar: atualizarCargo, remover: removerCargo },
  departamentos: {
    listar: listarDepartamentos, criar: criarDepartamento,
    atualizar: atualizarDepartamento, remover: removerDepartamento,
  },
};

const erro = (e: any, fallback: string) => {
  const m = e?.response?.data?.message;
  toast.error(Array.isArray(m) ? m[0] : m ?? fallback);
};

function Linha({
  item, chave, podeEditar, podeExcluir,
}: {
  item: ItemLista;
  chave: 'cargos' | 'departamentos';
  podeEditar: boolean;
  podeExcluir: boolean;
}) {
  const qc = useQueryClient();
  const api = API[chave];
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(item.nome);

  useEffect(() => { setNome(item.nome); }, [item.nome]);

  // Invalida as duas variantes (com e sem inativos) — o formulário de
  // colaborador lê a lista curta, este diálogo lê a completa.
  const invalidar = () => qc.invalidateQueries({ queryKey: [chave] });

  const salvar = useMutation({
    mutationFn: () => api.atualizar(item.id, { nome: nome.trim() }),
    onSuccess: () => { toast.success('Nome atualizado.'); setEditando(false); invalidar(); },
    onError: (e) => erro(e, 'Não foi possível salvar.'),
  });
  const alternar = useMutation({
    mutationFn: () => api.atualizar(item.id, { ativo: !item.ativo }),
    onSuccess: () => invalidar(),
    onError: (e) => erro(e, 'Não foi possível alterar.'),
  });
  const excluir = useMutation({
    mutationFn: () => api.remover(item.id),
    onSuccess: () => { toast.success('Excluído.'); invalidar(); },
    onError: (e) => erro(e, 'Não foi possível excluir.'),
  });

  if (editando) {
    return (
      <li className="space-y-2 rounded-lg border p-3">
        <Input value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => { setEditando(false); setNome(item.nome); }}>
            Cancelar
          </Button>
          <Button size="sm" onClick={() => salvar.mutate()} disabled={salvar.isPending || nome.trim().length < 2}>
            {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Salvar
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className={cn('flex items-center gap-3 rounded-lg border p-2.5', !item.ativo && 'opacity-60')}>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-sm font-medium">
          {item.nome}
          {!item.ativo && (
            <span className="rounded bg-muted px-1.5 text-[10px] text-muted-foreground">oculto</span>
          )}
        </p>
      </div>
      {podeEditar && (
        <>
          <button
            type="button" onClick={() => setEditando(true)} title="Renomear"
            className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button" onClick={() => alternar.mutate()} disabled={alternar.isPending}
            title={item.ativo ? 'Ocultar dos formulários' : 'Reativar'}
            className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {item.ativo ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </>
      )}
      {podeExcluir && (
        <button
          type="button" onClick={() => excluir.mutate()} disabled={excluir.isPending}
          title="Excluir (só se ninguém estiver usando)"
          className="rounded p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
        >
          {excluir.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </button>
      )}
    </li>
  );
}

function Painel({
  chave, podeEditar, podeExcluir, placeholder,
}: {
  chave: 'cargos' | 'departamentos';
  podeEditar: boolean;
  podeExcluir: boolean;
  placeholder: string;
}) {
  const qc = useQueryClient();
  const api = API[chave];
  const [novo, setNovo] = useState('');

  const { data: itens = [], isLoading } = useQuery({
    queryKey: [chave, true],
    queryFn: () => api.listar(true),
  });

  const criar = useMutation({
    mutationFn: () => api.criar(novo.trim()),
    onSuccess: () => { toast.success('Adicionado.'); setNovo(''); qc.invalidateQueries({ queryKey: [chave] }); },
    onError: (e) => erro(e, 'Não foi possível adicionar.'),
  });

  return (
    <>
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : itens.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Nenhum item cadastrado.</p>
        ) : (
          <ul className="space-y-2">
            {itens.map((i) => (
              <Linha key={i.id} item={i} chave={chave} podeEditar={podeEditar} podeExcluir={podeExcluir} />
            ))}
          </ul>
        )}
      </div>

      {podeEditar && (
        <div className="space-y-2 border-t p-4">
          <Input
            value={novo}
            onChange={(e) => setNovo(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && novo.trim().length >= 2) criar.mutate(); }}
            placeholder={placeholder}
          />
          <Button
            className="w-full"
            onClick={() => criar.mutate()}
            disabled={criar.isPending || novo.trim().length < 2}
          >
            {criar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Adicionar
          </Button>
        </div>
      )}
    </>
  );
}

export function ListasApoioModal({
  open, onClose, podeEditar, podeExcluir,
}: {
  open: boolean;
  onClose: () => void;
  podeEditar: boolean;
  /** Exclusão real é do Administrador (regra global do sistema). */
  podeExcluir: boolean;
}) {
  const [aba, setAba] = useState<'cargos' | 'departamentos'>('cargos');
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b p-5">
          <div>
            <h3 className="font-semibold">Cargos e Departamentos</h3>
            <p className="text-xs text-muted-foreground">Listas usadas no cadastro de colaboradores</p>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex gap-1 border-b px-4 pt-3">
          {([
            ['cargos', 'Cargos', Briefcase],
            ['departamentos', 'Departamentos', Layers],
          ] as const).map(([k, label, Icon]) => (
            <button
              key={k}
              type="button"
              onClick={() => setAba(k)}
              className={cn(
                'flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-sm transition',
                aba === k
                  ? 'border-brand-600 font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>

        {/* `key` remonta o painel na troca de aba: o campo "novo" não deve
            carregar o texto digitado na outra lista. */}
        <Painel
          key={aba}
          chave={aba}
          podeEditar={podeEditar}
          podeExcluir={podeExcluir}
          placeholder={aba === 'cargos' ? 'Ex.: Advogado(a)' : 'Ex.: Jurídico'}
        />

        {podeEditar && (
          <p className="border-t px-4 py-2.5 text-[11px] leading-snug text-muted-foreground">
            <strong>Ocultar</strong> tira o item dos formulários e preserva quem já o usa. Excluir só
            funciona se nenhum colaborador estiver vinculado.
          </p>
        )}
      </div>
    </div>
  );
}
