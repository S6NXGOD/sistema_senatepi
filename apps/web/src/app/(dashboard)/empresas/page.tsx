'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Search, Building2, KeyRound, ShieldCheck, Clock, Trash2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useAuth } from '@/lib/auth';
import { podeExcluir } from '@/lib/permissoes';
import { formatarData } from '@/lib/utils';
import { listarEmpresas, excluirEmpresa, mascaraCnpj, type Empresa } from '@/lib/empresas';
import { EmpresaFormModal } from '@/components/empresas/empresa-form-modal';

/**
 * Módulo Patronal — listagem das empresas conveniadas.
 *
 * A mesma tabela guarda empregadoras usadas no cadastro de colaboradores PJ;
 * a coluna "Portal" distingue quem já tem credencial de acesso.
 */
export default function EmpresasPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  // Excluir é privativo do Administrador — o botão nem aparece para os demais.
  const ehAdmin = podeExcluir(user?.role);

  const [rascunho, setRascunho] = useState('');
  const [busca, setBusca] = useState('');
  const [page, setPage] = useState(1);
  const [novaAberta, setNovaAberta] = useState(false);
  const [excluindo, setExcluindo] = useState<Empresa | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['empresas', busca, page],
    queryFn: () => listarEmpresas({ busca: busca || undefined, page, pageSize: 10 }),
  });

  const excluir = useMutation({
    mutationFn: () => excluirEmpresa(excluindo!.id),
    onSuccess: (r) => {
      toast.success(`${excluindo?.razaoSocial} foi excluída.`);
      if (r.contribuicoesRemovidas > 0) {
        toast.warning(`${r.contribuicoesRemovidas} contribuição(ões) e seus documentos foram removidos.`);
      }
      if (r.colaboradoresDesvinculados > 0) {
        toast.info(`${r.colaboradoresDesvinculados} colaborador(es) ficaram sem empresa vinculada.`);
      }
      setExcluindo(null);
      void qc.invalidateQueries({ queryKey: ['empresas'] });
      void qc.invalidateQueries({ queryKey: ['contribuicoes-patronais'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível excluir.'),
  });

  const linhas = data?.data;

  function aplicarBusca() {
    setBusca(rascunho.trim());
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Empresas</h1>
          <p className="text-sm text-muted-foreground">
            {data ? `${data.total} empresa(s) cadastrada(s)` : 'Módulo Patronal'}
          </p>
        </div>
        <Button onClick={() => setNovaAberta(true)}>
          <Plus className="h-4 w-4" /> Nova empresa
        </Button>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Buscar por razão social, nome fantasia ou CNPJ..."
                value={rascunho}
                onChange={(e) => setRascunho(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && aplicarBusca()}
              />
            </div>
            <Button onClick={aplicarBusca}>
              <Search className="h-4 w-4" /> Buscar
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {/* Desktop */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Razão social</th>
                  <th className="px-4 py-3 font-medium">CNPJ</th>
                  <th className="px-4 py-3 font-medium">Cidade / UF</th>
                  <th className="px-4 py-3 font-medium">Portal</th>
                  <th className="px-4 py-3 font-medium">Cadastro</th>
                  <th className="px-4 py-3 text-right font-medium">{ehAdmin ? 'Ações' : ''}</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Carregando...</td></tr>
                )}
                {!isLoading && linhas?.map((e) => (
                  <tr key={e.id} className="border-b transition-colors last:border-0 hover:bg-muted/40">
                    <td className="px-4 py-3">
                      <p className="font-medium">{e.razaoSocial}</p>
                      {e.nomeFantasia && (
                        <p className="text-xs text-muted-foreground">{e.nomeFantasia}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{mascaraCnpj(e.cnpj)}</td>
                    <td className="px-4 py-3">
                      {e.cidade ? `${e.cidade}${e.uf ? ` / ${e.uf}` : ''}` : '—'}
                    </td>
                    <td className="px-4 py-3"><StatusPortal empresa={e} /></td>
                    <td className="px-4 py-3 text-muted-foreground">{formatarData(e.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      {ehAdmin && (
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Excluir empresa"
                          className="text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
                          onClick={() => setExcluindo(e)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {!isLoading && linhas && linhas.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                      <Building2 className="mx-auto mb-2 h-8 w-8 opacity-40" />
                      Nenhuma empresa encontrada.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile */}
          <div className="divide-y md:hidden">
            {isLoading && <p className="p-6 text-center text-muted-foreground">Carregando...</p>}
            {!isLoading && linhas?.map((e) => (
              <div key={e.id} className="space-y-1.5 p-4">
                <p className="font-medium">{e.razaoSocial}</p>
                {e.nomeFantasia && <p className="text-xs text-muted-foreground">{e.nomeFantasia}</p>}
                <p className="font-mono text-xs text-muted-foreground">{mascaraCnpj(e.cnpj)}</p>
                <p className="text-xs text-muted-foreground">
                  {e.cidade ? `${e.cidade}${e.uf ? ` / ${e.uf}` : ''}` : 'Endereço não informado'}
                </p>
                <div className="flex items-center justify-between gap-2">
                  <StatusPortal empresa={e} />
                  {ehAdmin && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
                      onClick={() => setExcluindo(e)}
                    >
                      <Trash2 className="h-4 w-4" /> Excluir
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {!isLoading && linhas && linhas.length === 0 && (
              <p className="p-6 text-center text-muted-foreground">Nenhuma empresa encontrada.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Página {data.page} de {data.totalPages}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= data.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Próxima
            </Button>
          </div>
        </div>
      )}

      <EmpresaFormModal open={novaAberta} onClose={() => setNovaAberta(false)} />

      <ConfirmDialog
        open={!!excluindo}
        variant="destructive"
        title="Excluir empresa permanentemente?"
        confirmLabel="Excluir definitivamente"
        loading={excluir.isPending}
        icon={<Trash2 className="h-6 w-6" />}
        onConfirm={() => excluir.mutate()}
        onClose={() => (excluir.isPending ? null : setExcluindo(null))}
        description={
          <>
            <strong>{excluindo?.razaoSocial}</strong> será removida de forma{' '}
            <strong>permanente e irreversível</strong>, junto com todas as contribuições
            patronais declaradas e os documentos enviados (comprovantes e relações de
            trabalhadores).
            <br /><br />
            Colaboradores vinculados a esta empresa <strong>não são excluídos</strong> — apenas
            ficam sem empregadora. Lançamentos já feitos no caixa também são mantidos.
          </>
        }
      />
    </div>
  );
}

/** Três estados possíveis: sem credencial, senha provisória pendente, ativo. */
function StatusPortal({ empresa }: { empresa: Empresa }) {
  if (!empresa.temAcessoPortal) {
    return (
      <Badge className="bg-muted text-muted-foreground">
        <Building2 className="h-3 w-3" /> Sem acesso
      </Badge>
    );
  }
  if (empresa.primeiroAcesso) {
    return (
      <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
        <Clock className="h-3 w-3" /> Senha provisória
      </Badge>
    );
  }
  return (
    <Badge className="bg-brand-50 text-brand-800 dark:bg-brand-900/40 dark:text-brand-300">
      <ShieldCheck className="h-3 w-3" /> Ativo
    </Badge>
  );
}
