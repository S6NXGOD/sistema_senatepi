'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Plus,
  Search,
  Filter,
  Eye,
  Pencil,
  IdCard,
  FileText,
  RefreshCw,
  Upload,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatarData, mascararCpf } from '@/lib/utils';
import {
  Filiado,
  FORMACAO_LABEL,
  SITUACAO_COR,
  SITUACAO_LABEL,
  SITUACOES,
} from '@/lib/filiados';
import { abrirPdf } from '@/lib/pdf';

export default function FiliadosPage() {
  const VAZIO = { busca: '', coren: '', cidade: '', situacao: '', dataInicio: '', dataFim: '' };
  // rascunho = o que está sendo digitado; aplicado = o que de fato consulta a API
  const [rascunho, setRascunho] = useState(VAZIO);
  const [aplicado, setAplicado] = useState(VAZIO);
  const [page, setPage] = useState(1);
  const [mostrarFiltros, setMostrarFiltros] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['filiados', aplicado, page],
    queryFn: async () =>
      (await api.get('/filiados', { params: { ...limpar(aplicado), page, pageSize: 10 } })).data,
  });

  function setR<K extends keyof typeof rascunho>(k: K, v: string) {
    setRascunho((f) => ({ ...f, [k]: v }));
  }
  function aplicar() {
    setAplicado(rascunho);
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Filiados</h2>
          <p className="text-sm text-muted-foreground">{data?.total ?? 0} associados</p>
        </div>
        <div className="flex gap-2">
          <Link href="/filiados/importar">
            <Button variant="outline"><Upload className="h-4 w-4" /> Importar CSV</Button>
          </Link>
          <Link href="/filiados/novo">
            <Button><Plus className="h-4 w-4" /> Nova filiação</Button>
          </Link>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex gap-2">
          <div className="relative max-w-md flex-1">
            <Search className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, matrícula ou CPF..."
              className="pl-10"
              value={rascunho.busca}
              onChange={(e) => setR('busca', e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') aplicar(); }}
            />
          </div>
          <Button onClick={aplicar}><Search className="h-4 w-4" /> Buscar</Button>
          <Button variant="outline" onClick={() => setMostrarFiltros((v) => !v)}>
            <Filter className="h-4 w-4" /> Filtros
          </Button>
        </div>

        {mostrarFiltros && (
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Input placeholder="COREN" value={rascunho.coren} onChange={(e) => setR('coren', e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') aplicar(); }} />
                <Input placeholder="Cidade" value={rascunho.cidade} onChange={(e) => setR('cidade', e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') aplicar(); }} />
                <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={rascunho.situacao} onChange={(e) => setR('situacao', e.target.value)}>
                  <option value="">Todas as situações</option>
                  {SITUACOES.map((s) => <option key={s} value={s}>{SITUACAO_LABEL[s]}</option>)}
                </select>
                <div>
                  <label className="text-xs text-muted-foreground">Filiação de</label>
                  <Input type="date" value={rascunho.dataInicio} onChange={(e) => setR('dataInicio', e.target.value)} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">até</label>
                  <Input type="date" value={rascunho.dataFim} onChange={(e) => setR('dataFim', e.target.value)} />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => { setRascunho(VAZIO); setAplicado(VAZIO); setPage(1); }}>Limpar</Button>
                <Button size="sm" onClick={aplicar}>Aplicar filtros</Button>
              </div>
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
                  <th className="px-4 py-3 font-medium">Matrícula</th>
                  <th className="px-4 py-3 font-medium">Categoria</th>
                  <th className="px-4 py-3 font-medium">Telefone</th>
                  <th className="px-4 py-3 font-medium">Situação</th>
                  <th className="px-4 py-3 font-medium">Filiação</th>
                  <th className="px-4 py-3 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">Carregando...</td></tr>
                )}
                {data?.data?.map((f: Filiado) => (
                  <tr key={f.id} className="border-b transition-colors last:border-0 hover:bg-muted/40">
                    <td className="px-4 py-2">
                      {f.fotoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={f.fotoUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
                      ) : (
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-senatepi-50 text-xs font-semibold text-senatepi-800">{f.nomeCompleto.charAt(0)}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium">{f.nomeCompleto}</td>
                    <td className="px-4 py-3">{f.cpf ? mascararCpf(f.cpf) : '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs">{f.matricula}</td>
                    <td className="px-4 py-3 text-xs">{f.formacao ? FORMACAO_LABEL[f.formacao] : '-'}</td>
                    <td className="px-4 py-3">{f.telefonePrincipal ?? '-'}</td>
                    <td className="px-4 py-3"><Badge className={SITUACAO_COR[f.situacao]}>{SITUACAO_LABEL[f.situacao]}</Badge></td>
                    <td className="px-4 py-3 text-muted-foreground">{formatarData(f.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-0.5">
                        <Link href={`/filiados/${f.id}`} title="Visualizar"><Button variant="ghost" size="icon"><Eye className="h-4 w-4" /></Button></Link>
                        <Link href={`/filiados/${f.id}/editar`} title="Editar"><Button variant="ghost" size="icon"><Pencil className="h-4 w-4" /></Button></Link>
                        <Link href={`/filiados/${f.id}/recadastrar`} title="Recadastrar"><Button variant="ghost" size="icon"><RefreshCw className="h-4 w-4" /></Button></Link>
                        <Button variant="ghost" size="icon" title="Carteirinha (com QR Code)" onClick={() => abrirPdf(`/filiados/${f.id}/carteirinha/pdf`)}><IdCard className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" title="Termo de consentimento" onClick={() => abrirPdf(`/filiados/${f.id}/termo/pdf`)}><FileText className="h-4 w-4" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {data && data.data.length === 0 && (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">Nenhum filiado encontrado</td></tr>
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
