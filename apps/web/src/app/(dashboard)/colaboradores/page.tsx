'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Search, Pencil, Trash2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { mascararCpf } from '@/lib/utils';
import {
  Colaborador,
  listarColaboradores,
  excluirColaborador,
  STATUS_COLAB,
  STATUS_COLAB_LABEL,
  STATUS_COLAB_COR,
  TIPO_VINCULO_LABEL,
} from '@/lib/colaboradores';

export default function ColaboradoresPage() {
  const qc = useQueryClient();
  const [busca, setBusca] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [excluir, setExcluir] = useState<Colaborador | null>(null);
  const [removendo, setRemovendo] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['colaboradores', busca, status, page],
    queryFn: () =>
      listarColaboradores({
        ...(busca ? { busca } : {}),
        ...(status ? { status } : {}),
        page,
        pageSize: 10,
      }),
  });

  async function confirmarExcluir() {
    if (!excluir) return;
    setRemovendo(true);
    try {
      await excluirColaborador(excluir.id);
      toast.success(`${excluir.nome} foi excluído(a).`);
      setExcluir(null);
      qc.invalidateQueries({ queryKey: ['colaboradores'] });
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Não foi possível excluir.');
    } finally {
      setRemovendo(false);
    }
  }

  const linhas = data?.data;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Colaboradores</h2>
          <p className="text-sm text-muted-foreground">{data?.total ?? 0} cadastrados</p>
        </div>
        <Link href="/colaboradores/novo">
          <Button><Plus className="h-4 w-4" /> Novo colaborador</Button>
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome ou CPF..."
            className="pl-10"
            value={busca}
            onChange={(e) => { setBusca(e.target.value); setPage(1); }}
          />
        </div>
        <select
          className="h-12 rounded-md border border-input bg-background px-3 text-base md:h-10 md:text-sm"
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
        >
          <option value="">Todos os status</option>
          {STATUS_COLAB.map((s) => <option key={s} value={s}>{STATUS_COLAB_LABEL[s]}</option>)}
        </select>
      </div>

      <Card>
        <CardContent className="p-0">
          {/* Desktop */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Nome</th>
                  <th className="px-4 py-3 font-medium">CPF</th>
                  <th className="px-4 py-3 font-medium">Cargo</th>
                  <th className="px-4 py-3 font-medium">Departamento</th>
                  <th className="px-4 py-3 font-medium">Vínculo</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Carregando...</td></tr>}
                {!isLoading && linhas?.map((c) => (
                  <tr key={c.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="px-4 py-3 font-medium">{c.nome}</td>
                    <td className="px-4 py-3">{mascararCpf(c.cpf)}</td>
                    <td className="px-4 py-3">{c.cargo.nome}</td>
                    <td className="px-4 py-3">{c.departamento.nome}</td>
                    <td className="px-4 py-3 text-xs">{TIPO_VINCULO_LABEL[c.tipoVinculo]}</td>
                    <td className="px-4 py-3"><Badge className={STATUS_COLAB_COR[c.status]}>{STATUS_COLAB_LABEL[c.status]}</Badge></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-0.5">
                        <Link href={`/colaboradores/${c.id}/editar`} title="Editar"><Button variant="ghost" size="icon"><Pencil className="h-4 w-4" /></Button></Link>
                        <Button variant="ghost" size="icon" className="text-red-600 dark:text-red-400" title="Excluir" onClick={() => setExcluir(c)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!isLoading && linhas?.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Nenhum colaborador encontrado</td></tr>}
              </tbody>
            </table>
          </div>

          {/* Mobile */}
          <div className="divide-y md:hidden">
            {isLoading && <p className="px-4 py-8 text-center text-sm text-muted-foreground">Carregando...</p>}
            {!isLoading && linhas?.map((c) => (
              <div key={c.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold leading-tight">{c.nome}</p>
                    <p className="text-xs text-muted-foreground">{mascararCpf(c.cpf)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Link href={`/colaboradores/${c.id}/editar`}><Button variant="ghost" size="icon"><Pencil className="h-4 w-4" /></Button></Link>
                    <Button variant="ghost" size="icon" className="text-red-600 dark:text-red-400" onClick={() => setExcluir(c)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
                <div className="mt-1.5"><Badge className={STATUS_COLAB_COR[c.status]}>{STATUS_COLAB_LABEL[c.status]}</Badge></div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                  <Info label="Cargo" valor={c.cargo.nome} />
                  <Info label="Departamento" valor={c.departamento.nome} />
                  <Info label="Vínculo" valor={TIPO_VINCULO_LABEL[c.tipoVinculo]} />
                  {c.empresa && <Info label="Empresa" valor={c.empresa.razaoSocial} />}
                </dl>
              </div>
            ))}
            {!isLoading && linhas?.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhum colaborador encontrado</p>}
          </div>
        </CardContent>
      </Card>

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
          <span className="text-sm text-muted-foreground">Página {page} de {data.totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>Próxima</Button>
        </div>
      )}

      <ConfirmDialog
        open={!!excluir}
        variant="destructive"
        title="Excluir colaborador?"
        confirmLabel="Excluir"
        loading={removendo}
        onConfirm={confirmarExcluir}
        onClose={() => (removendo ? null : setExcluir(null))}
        description={<>Remove <strong>{excluir?.nome}</strong> permanentemente. Esta ação não pode ser desfeita.</>}
      />
    </div>
  );
}

function Info({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="truncate">{valor}</dd>
    </div>
  );
}
