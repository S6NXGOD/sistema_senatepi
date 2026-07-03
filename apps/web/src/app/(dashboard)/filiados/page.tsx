'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Filter, Upload, Copy } from 'lucide-react';
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
  buscarDuplicados,
} from '@/lib/filiados';
import { FiliadoRowActions } from '@/components/filiados/filiado-row-actions';

export default function FiliadosPage() {
  const VAZIO = { busca: '', coren: '', cidade: '', situacao: '', dataInicio: '', dataFim: '' };
  // rascunho = o que está sendo digitado; aplicado = o que de fato consulta a API
  const [rascunho, setRascunho] = useState(VAZIO);
  const [aplicado, setAplicado] = useState(VAZIO);
  const [page, setPage] = useState(1);
  const [mostrarFiltros, setMostrarFiltros] = useState(false);
  const [mostrarDuplicados, setMostrarDuplicados] = useState(false);

  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['filiados', aplicado, page],
    queryFn: async () =>
      (await api.get('/filiados', { params: { ...limpar(aplicado), page, pageSize: 10 } })).data,
    enabled: !mostrarDuplicados,
  });

  // Duplicados: consumido apenas quando o toggle está ativo.
  const dupQuery = useQuery({
    queryKey: ['filiados-duplicados'],
    queryFn: buscarDuplicados,
    enabled: mostrarDuplicados,
  });

  const carregando = mostrarDuplicados ? dupQuery.isLoading : isLoading;
  const linhas: Filiado[] | undefined = mostrarDuplicados ? dupQuery.data?.data : data?.data;

  function setR<K extends keyof typeof rascunho>(k: K, v: string) {
    setRascunho((f) => ({ ...f, [k]: v }));
  }
  function aplicar() {
    setAplicado(rascunho);
    setPage(1);
  }
  function revalidar() {
    queryClient.invalidateQueries({ queryKey: ['filiados'] });
    queryClient.invalidateQueries({ queryKey: ['filiados-duplicados'] });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Filiados</h2>
          <p className="text-sm text-muted-foreground">
            {mostrarDuplicados
              ? `${dupQuery.data?.total ?? 0} registros em ${dupQuery.data?.grupos ?? 0} CPFs duplicados`
              : `${data?.total ?? 0} associados`}
          </p>
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
        <div className="flex flex-wrap gap-2">
          <div className="relative max-w-md flex-1">
            <Search className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, matrícula ou CPF..."
              className="pl-10"
              value={rascunho.busca}
              disabled={mostrarDuplicados}
              onChange={(e) => setR('busca', e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') aplicar(); }}
            />
          </div>
          <Button onClick={aplicar} disabled={mostrarDuplicados}><Search className="h-4 w-4" /> Buscar</Button>
          <Button variant="outline" onClick={() => setMostrarFiltros((v) => !v)} disabled={mostrarDuplicados}>
            <Filter className="h-4 w-4" /> Filtros
          </Button>
          <Button
            variant={mostrarDuplicados ? 'default' : 'outline'}
            onClick={() => { setMostrarDuplicados((v) => !v); setMostrarFiltros(false); }}
            title="Exibe filiados que compartilham o mesmo CPF"
          >
            <Copy className="h-4 w-4" /> {mostrarDuplicados ? 'Ver todos' : 'Mostrar duplicados'}
          </Button>
        </div>

        {mostrarFiltros && !mostrarDuplicados && (
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Input placeholder="COREN" value={rascunho.coren} onChange={(e) => setR('coren', e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') aplicar(); }} />
                <Input placeholder="Cidade" value={rascunho.cidade} onChange={(e) => setR('cidade', e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') aplicar(); }} />
                <select className="h-12 rounded-md border border-input md:h-10 bg-background px-3 text-base md:text-sm" value={rascunho.situacao} onChange={(e) => setR('situacao', e.target.value)}>
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

        {mostrarDuplicados && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/20 dark:text-amber-200">
            <Copy className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Exibindo apenas filiados que <strong>compartilham o mesmo CPF</strong>, agrupados para
              facilitar a conferência. Use as ações da linha para desfiliar ou excluir os registros duplicados.
            </span>
          </div>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {/* Desktop (>= md): tabela tradicional */}
          <div className="hidden overflow-x-auto md:block">
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
                {carregando && (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">Carregando...</td></tr>
                )}
                {!carregando && linhas?.map((f: Filiado) => (
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
                      <FiliadoRowActions filiado={f} onChanged={revalidar} />
                    </td>
                  </tr>
                ))}
                {!carregando && linhas && linhas.length === 0 && (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                    {mostrarDuplicados ? 'Nenhum CPF duplicado encontrado' : 'Nenhum filiado encontrado'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile (< md): cards empilhados com os mesmos registros */}
          <div className="divide-y md:hidden">
            {carregando && (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">Carregando...</p>
            )}
            {!carregando && linhas?.map((f: Filiado) => (
              <FiliadoCardMobile key={f.id} f={f} onChanged={revalidar} />
            ))}
            {!carregando && linhas && linhas.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                {mostrarDuplicados ? 'Nenhum CPF duplicado encontrado' : 'Nenhum filiado encontrado'}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {!mostrarDuplicados && data && data.totalPages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
          <span className="text-sm text-muted-foreground">Página {page} de {data.totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>Próxima</Button>
        </div>
      )}
    </div>
  );
}

/** Card de filiado para o mobile (< md) — mesmo registro da tabela, empilhado. */
function FiliadoCardMobile({ f, onChanged }: { f: Filiado; onChanged: () => void }) {
  return (
    <div className="flex gap-3 p-4">
      {f.fotoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={f.fotoUrl} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" />
      ) : (
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-senatepi-50 text-sm font-semibold text-senatepi-800">
          {f.nomeCompleto.charAt(0)}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-semibold leading-tight">{f.nomeCompleto}</p>
            <p className="font-mono text-xs text-muted-foreground">{f.matricula}</p>
          </div>
          <FiliadoRowActions filiado={f} onChanged={onChanged} />
        </div>
        <div className="mt-1.5">
          <Badge className={SITUACAO_COR[f.situacao]}>{SITUACAO_LABEL[f.situacao]}</Badge>
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
          <Info label="CPF" valor={f.cpf ? mascararCpf(f.cpf) : '—'} />
          <Info label="Categoria" valor={f.formacao ? FORMACAO_LABEL[f.formacao] : '—'} />
          <Info label="Telefone" valor={f.telefonePrincipal ?? '—'} />
          <Info label="Filiação" valor={formatarData(f.createdAt)} />
        </dl>
      </div>
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

function limpar<T extends Record<string, string>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== '')) as Partial<T>;
}
