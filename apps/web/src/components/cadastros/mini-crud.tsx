'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Loader2, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

export interface CampoCrud {
  name: string;
  label: string;
  placeholder?: string;
  mask?: (v: string) => string;
}
export interface ColunaCrud {
  key: string;
  label: string;
  format?: (v: string) => string;
  mono?: boolean;
}
type Registro = { id: string; [key: string]: any };

interface ApiCrud {
  listar: () => Promise<any[]>;
  criar: (valores: Record<string, string>) => Promise<unknown>;
  atualizar: (id: string, valores: Record<string, string>) => Promise<unknown>;
  remover: (id: string) => Promise<unknown>;
}

/** Mini-CRUD reutilizável (lista + adicionar/editar em modal + excluir). */
export function MiniCrud({
  singular,
  queryKey,
  campos,
  colunas,
  api,
}: {
  singular: string;
  queryKey: string;
  campos: CampoCrud[];
  colunas: ColunaCrud[];
  api: ApiCrud;
}) {
  const qc = useQueryClient();
  const [editar, setEditar] = useState<Registro | null | 'novo'>(null);
  const [excluir, setExcluir] = useState<Registro | null>(null);
  const [carregandoAcao, setCarregandoAcao] = useState(false);

  const { data, isLoading } = useQuery({ queryKey: [queryKey], queryFn: api.listar });
  const invalidar = () => qc.invalidateQueries({ queryKey: [queryKey] });

  async function confirmarExcluir() {
    if (!excluir) return;
    setCarregandoAcao(true);
    try {
      await api.remover(excluir.id);
      toast.success(`${singular} excluído.`);
      setExcluir(null);
      invalidar();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Não foi possível excluir.');
    } finally {
      setCarregandoAcao(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{data?.length ?? 0} registro(s)</p>
        <Button size="sm" onClick={() => setEditar('novo')}>
          <Plus className="h-4 w-4" /> Adicionar
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {/* Desktop */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  {colunas.map((c) => <th key={c.key} className="px-4 py-3 font-medium">{c.label}</th>)}
                  <th className="px-4 py-3 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && <tr><td colSpan={colunas.length + 1} className="px-4 py-8 text-center text-muted-foreground">Carregando...</td></tr>}
                {!isLoading && data?.map((r) => (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                    {colunas.map((c) => (
                      <td key={c.key} className={`px-4 py-3 ${c.mono ? 'font-mono text-xs' : ''}`}>
                        {c.format ? c.format(r[c.key]) : r[c.key]}
                      </td>
                    ))}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-0.5">
                        <Button variant="ghost" size="icon" title="Editar" onClick={() => setEditar(r)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" title="Excluir" className="text-red-600 dark:text-red-400" onClick={() => setExcluir(r)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!isLoading && data?.length === 0 && (
                  <tr><td colSpan={colunas.length + 1} className="px-4 py-8 text-center text-muted-foreground">Nenhum registro.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile */}
          <div className="divide-y md:hidden">
            {isLoading && <p className="px-4 py-8 text-center text-sm text-muted-foreground">Carregando...</p>}
            {!isLoading && data?.map((r) => (
              <div key={r.id} className="flex items-start justify-between gap-2 p-4">
                <div className="min-w-0">
                  <p className="truncate font-medium">{colunas[0].format ? colunas[0].format(r[colunas[0].key]) : r[colunas[0].key]}</p>
                  {colunas[1] && <p className="truncate text-xs text-muted-foreground">{colunas[1].format ? colunas[1].format(r[colunas[1].key]) : r[colunas[1].key]}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button variant="ghost" size="icon" onClick={() => setEditar(r)}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" className="text-red-600 dark:text-red-400" onClick={() => setExcluir(r)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
            ))}
            {!isLoading && data?.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhum registro.</p>}
          </div>
        </CardContent>
      </Card>

      {editar !== null && (
        <FormModal
          singular={singular}
          campos={campos}
          registro={editar === 'novo' ? null : editar}
          onClose={() => setEditar(null)}
          onSalvar={async (valores) => {
            setCarregandoAcao(true);
            try {
              if (editar === 'novo') await api.criar(valores);
              else if (editar) await api.atualizar(editar.id, valores);
              toast.success(editar === 'novo' ? `${singular} adicionado.` : `${singular} atualizado.`);
              setEditar(null);
              invalidar();
            } catch (e: any) {
              toast.error(e?.response?.data?.message ?? 'Não foi possível salvar.');
            } finally {
              setCarregandoAcao(false);
            }
          }}
          salvando={carregandoAcao}
        />
      )}

      <ConfirmDialog
        open={!!excluir}
        variant="destructive"
        title={`Excluir ${singular.toLowerCase()}?`}
        confirmLabel="Excluir"
        loading={carregandoAcao}
        onConfirm={confirmarExcluir}
        onClose={() => (carregandoAcao ? null : setExcluir(null))}
        description={<>Esta ação removerá o registro permanentemente. Não é possível excluir itens em uso por colaboradores.</>}
      />
    </div>
  );
}

function FormModal({
  singular,
  campos,
  registro,
  onClose,
  onSalvar,
  salvando,
}: {
  singular: string;
  campos: CampoCrud[];
  registro: Registro | null;
  onClose: () => void;
  onSalvar: (valores: Record<string, string>) => void;
  salvando: boolean;
}) {
  const [valores, setValores] = useState<Record<string, string>>(() =>
    Object.fromEntries(campos.map((c) => [c.name, registro?.[c.name] ?? ''])),
  );
  const preenchido = campos.every((c) => (valores[c.name] ?? '').trim().length > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={salvando ? undefined : onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-t-2xl bg-card shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b p-5">
          <h3 className="font-semibold">{registro ? `Editar ${singular.toLowerCase()}` : `Novo ${singular.toLowerCase()}`}</h3>
          <Button variant="ghost" size="icon" onClick={onClose} disabled={salvando}><X className="h-4 w-4" /></Button>
        </div>
        <form
          className="space-y-4 p-5"
          onSubmit={(e) => { e.preventDefault(); if (preenchido) onSalvar(valores); }}
        >
          {campos.map((c) => (
            <div key={c.name} className="space-y-1.5">
              <label className="text-sm font-medium">{c.label}</label>
              <Input
                placeholder={c.placeholder}
                value={valores[c.name] ?? ''}
                onChange={(e) => setValores((v) => ({ ...v, [c.name]: c.mask ? c.mask(e.target.value) : e.target.value }))}
              />
            </div>
          ))}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose} disabled={salvando}>Cancelar</Button>
            <Button type="submit" disabled={salvando || !preenchido}>
              {salvando && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
