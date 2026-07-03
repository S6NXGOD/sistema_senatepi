'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Plus,
  Search,
  Eye,
  Pencil,
  IdCard,
  Filter,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatarData, mascararCpf } from '@/lib/utils';
import {
  Funcionario,
  STATUS,
  STATUS_COR,
  STATUS_LABEL,
  TIPO_LABEL,
  TIPOS,
} from '@/lib/funcionarios';
import { abrirPdf } from '@/lib/pdf';

export default function FuncionariosPage() {
  const [filtros, setFiltros] = useState({
    nome: '',
    cpf: '',
    cargo: '',
    departamento: '',
    tipo: '',
    status: '',
  });
  const [page, setPage] = useState(1);
  const [mostrarFiltros, setMostrarFiltros] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['funcionarios', filtros, page],
    queryFn: async () =>
      (await api.get('/funcionarios', { params: { ...limpar(filtros), page, pageSize: 10 } })).data,
  });

  function set<K extends keyof typeof filtros>(k: K, v: string) {
    setFiltros((f) => ({ ...f, [k]: v }));
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Funcionários</h2>
          <p className="text-sm text-muted-foreground">{data?.total ?? 0} cadastrados</p>
        </div>
        <Link href="/funcionarios/novo">
          <Button>
            <Plus className="h-4 w-4" /> Novo funcionário
          </Button>
        </Link>
      </div>

      {/* Busca + filtros */}
      <div className="space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome..."
              className="pl-10"
              value={filtros.nome}
              onChange={(e) => set('nome', e.target.value)}
            />
          </div>
          <Button variant="outline" onClick={() => setMostrarFiltros((v) => !v)}>
            <Filter className="h-4 w-4" /> Filtros
          </Button>
        </div>

        {mostrarFiltros && (
          <Card>
            <CardContent className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
              <Input placeholder="CPF" value={filtros.cpf} onChange={(e) => set('cpf', e.target.value)} />
              <Input placeholder="Cargo" value={filtros.cargo} onChange={(e) => set('cargo', e.target.value)} />
              <Input placeholder="Departamento" value={filtros.departamento} onChange={(e) => set('departamento', e.target.value)} />
              <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={filtros.tipo} onChange={(e) => set('tipo', e.target.value)}>
                <option value="">Todos os tipos</option>
                {TIPOS.map((t) => <option key={t} value={t}>{TIPO_LABEL[t]}</option>)}
              </select>
              <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={filtros.status} onChange={(e) => set('status', e.target.value)}>
                <option value="">Todos os status</option>
                {STATUS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Foto</th>
                  <th className="px-4 py-3 font-medium">Nome</th>
                  <th className="px-4 py-3 font-medium">CPF</th>
                  <th className="px-4 py-3 font-medium">Cargo</th>
                  <th className="px-4 py-3 font-medium">Departamento</th>
                  <th className="px-4 py-3 font-medium">Tipo</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Admissão</th>
                  <th className="px-4 py-3 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">Carregando...</td></tr>
                )}
                {data?.data?.map((f: Funcionario) => (
                  <tr key={f.id} className="border-b transition-colors last:border-0 hover:bg-muted/40">
                    <td className="px-4 py-2">
                      {f.fotoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={f.fotoUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
                      ) : (
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-senatepi-50 text-xs font-semibold text-senatepi-800">
                          {f.nome.charAt(0)}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium">{f.nome}</td>
                    <td className="px-4 py-3">{mascararCpf(f.cpf)}</td>
                    <td className="px-4 py-3">{f.cargo ?? '-'}</td>
                    <td className="px-4 py-3">{f.departamento ?? '-'}</td>
                    <td className="px-4 py-3 text-xs">{TIPO_LABEL[f.tipo]}</td>
                    <td className="px-4 py-3">
                      <Badge className={STATUS_COR[f.status]}>{STATUS_LABEL[f.status]}</Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{formatarData(f.dataAdmissao)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Link href={`/funcionarios/${f.id}`} title="Visualizar">
                          <Button variant="ghost" size="icon"><Eye className="h-4 w-4" /></Button>
                        </Link>
                        <Link href={`/funcionarios/${f.id}/editar`} title="Editar">
                          <Button variant="ghost" size="icon"><Pencil className="h-4 w-4" /></Button>
                        </Link>
                        <Button variant="ghost" size="icon" title="Carteirinha (com QR Code)" onClick={() => abrirPdf(`/funcionarios/${f.id}/carteirinha/pdf`)}>
                          <IdCard className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {data && data.data.length === 0 && (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">Nenhum funcionário encontrado</td></tr>
                )}
              </tbody>
            </table>
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
    </div>
  );
}

function limpar<T extends Record<string, string>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== '')) as Partial<T>;
}
