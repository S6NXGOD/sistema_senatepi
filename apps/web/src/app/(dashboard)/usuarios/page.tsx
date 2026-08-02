'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ShieldCheck, Plus, Search, Loader2, Pencil, Trash2, Users as UsersIcon,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { UsuarioFormModal } from '@/components/usuarios/usuario-form-modal';
import { listarUsuarios, excluirUsuario, UsuarioSistema } from '@/lib/usuarios';
import { PERFIL_LABEL, PerfilUsuario } from '@/lib/permissoes';

const PERFIL_COR: Record<PerfilUsuario, string> = {
  ADMINISTRADOR: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  COORDENACAO: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  ADVOGADO: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  TRIAGEM: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
};

export default function UsuariosPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [busca, setBusca] = useState('');
  const [buscaDeb, setBuscaDeb] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editar, setEditar] = useState<UsuarioSistema | null>(null);
  const [excluirAlvo, setExcluirAlvo] = useState<UsuarioSistema | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setBuscaDeb(busca.trim()), 350);
    return () => clearTimeout(t);
  }, [busca]);

  const { data: usuarios = [], isLoading } = useQuery({
    queryKey: ['usuarios', buscaDeb],
    queryFn: () => listarUsuarios(buscaDeb || undefined),
  });

  const invalidar = () => qc.invalidateQueries({ queryKey: ['usuarios'] });

  const excluir = useMutation({
    mutationFn: (id: string) => excluirUsuario(id),
    onSuccess: () => {
      toast.success('Usuário excluído.');
      setExcluirAlvo(null);
      invalidar();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível excluir.'),
  });

  function novo() {
    setEditar(null);
    setFormOpen(true);
  }
  function editarUsuario(u: UsuarioSistema) {
    setEditar(u);
    setFormOpen(true);
  }

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-senatepi-50 dark:bg-senatepi-900/30">
            <ShieldCheck className="h-5 w-5 text-senatepi-800 dark:text-senatepi-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">Usuários e Perfis</h2>
            <p className="text-sm text-muted-foreground">Controle de acesso e permissões da equipe</p>
          </div>
        </div>
        <Button onClick={novo}>
          <Plus className="h-4 w-4" /> Novo Usuário
        </Button>
      </div>

      {/* Busca */}
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Buscar por nome, usuário ou e-mail…" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : usuarios.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 py-16 text-center">
          <UsersIcon className="h-8 w-8 text-muted-foreground opacity-60" />
          <p className="font-medium">Nenhum usuário encontrado</p>
        </Card>
      ) : (
        <>
          {/* Mobile: cards */}
          <div className="space-y-3 md:hidden">
            {usuarios.map((u) => (
              <Card key={u.id} className="p-4">
                <div className="flex items-start gap-3">
                  <Avatar u={u} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 font-semibold">
                      <span className="truncate">{u.nome}</span>
                      {u.id === user?.id && <span className="text-[10px] font-bold text-senatepi-700">VOCÊ</span>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', PERFIL_COR[u.role])}>{PERFIL_LABEL[u.role]}</span>
                      <StatusPill ativo={u.ativo} />
                    </div>
                  </div>
                  <Acoes u={u} onEditar={() => editarUsuario(u)} onExcluir={() => setExcluirAlvo(u)} ehProprio={u.id === user?.id} />
                </div>
              </Card>
            ))}
          </div>

          {/* Desktop: tabela */}
          <Card className="hidden overflow-hidden p-0 md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Nome</th>
                    <th className="px-4 py-3 font-medium">Exibição</th>
                    <th className="px-4 py-3 font-medium">Perfil</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {usuarios.map((u) => (
                    <tr key={u.id} className="transition-colors hover:bg-muted/40">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar u={u} />
                          <div className="min-w-0">
                            <p className="flex items-center gap-1.5 font-medium">
                              <span className="truncate">{u.nome}</span>
                              {u.id === user?.id && <span className="text-[10px] font-bold text-senatepi-700">VOCÊ</span>}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{u.nomeExibicao || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', PERFIL_COR[u.role])}>{PERFIL_LABEL[u.role]}</span>
                      </td>
                      <td className="px-4 py-3"><StatusPill ativo={u.ativo} /></td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end">
                          <Acoes u={u} onEditar={() => editarUsuario(u)} onExcluir={() => setExcluirAlvo(u)} ehProprio={u.id === user?.id} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <UsuarioFormModal open={formOpen} onClose={() => setFormOpen(false)} onSalvo={invalidar} editar={editar} />

      <ConfirmDialog
        open={!!excluirAlvo}
        onClose={() => setExcluirAlvo(null)}
        onConfirm={() => excluirAlvo && excluir.mutate(excluirAlvo.id)}
        title="Excluir usuário"
        description={`Excluir "${excluirAlvo?.nome}"? Esta ação não pode ser desfeita.`}
        confirmLabel="Excluir"
        loading={excluir.isPending}
        variant="destructive"
      />
    </div>
  );
}

function Avatar({ u }: { u: UsuarioSistema }) {
  return u.avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={u.avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-full border object-cover" />
  ) : (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-senatepi-400 text-sm font-bold text-senatepi-900">
      {u.nome.charAt(0)}
    </div>
  );
}

function StatusPill({ ativo }: { ativo: boolean }) {
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-[11px] font-medium',
        ativo
          ? 'bg-senatepi-50 text-senatepi-800 dark:bg-senatepi-900/30 dark:text-senatepi-400'
          : 'bg-muted text-muted-foreground',
      )}
    >
      {ativo ? 'Ativo' : 'Inativo'}
    </span>
  );
}

function Acoes({
  u, onEditar, onExcluir, ehProprio,
}: { u: UsuarioSistema; onEditar: () => void; onExcluir: () => void; ehProprio: boolean }) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={onEditar}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
        title="Editar"
      >
        <Pencil className="h-4 w-4" />
      </button>
      {!ehProprio && (
        <button
          type="button"
          onClick={onExcluir}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
          title="Excluir"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
