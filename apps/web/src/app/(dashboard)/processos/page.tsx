'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Gavel, Plus, Search, Loader2, ChevronLeft, ChevronRight, User, Landmark, FileWarning,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { ImportarProcessoDialog } from '@/components/processos/importar-processo-dialog';
import { ProcessoDetalheSheet } from '@/components/processos/processo-detalhe-sheet';
import {
  listarProcessos, formatNPU, ProcessoLista, ParteProcesso, StatusProcesso,
  STATUS_PROCESSO_COR, STATUS_PROCESSO_LABEL, STATUS_PROCESSO_ORDEM,
} from '@/lib/processos';

const inputCls = 'h-12 rounded-md border border-input bg-background px-3 text-base md:h-10 md:text-sm';

function StatusBadge({ status }: { status: StatusProcesso }) {
  return (
    <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium', STATUS_PROCESSO_COR[status])}>
      {STATUS_PROCESSO_LABEL[status]}
    </span>
  );
}

export default function ProcessosPage() {
  const qc = useQueryClient();
  const [busca, setBusca] = useState('');
  const [buscaDeb, setBuscaDeb] = useState('');
  const [status, setStatus] = useState<'' | StatusProcesso>('');
  const [page, setPage] = useState(1);

  const [importOpen, setImportOpen] = useState(false);
  const [detalheId, setDetalheId] = useState<string | null>(null);
  const [partesIniciais, setPartesIniciais] = useState<ParteProcesso[] | undefined>();

  useEffect(() => {
    const t = setTimeout(() => {
      setBuscaDeb(busca.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [busca]);

  const filtro = useMemo(
    () => ({ busca: buscaDeb || undefined, statusInterno: status || undefined, page, pageSize: 20 }),
    [buscaDeb, status, page],
  );

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['processos', buscaDeb, status, page],
    queryFn: () => listarProcessos(filtro),
  });
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPaginas = data?.totalPaginas ?? 1;

  const invalidar = () => qc.invalidateQueries({ queryKey: ['processos'] });

  function abrirDetalhe(id: string, partes?: ParteProcesso[]) {
    setPartesIniciais(partes);
    setDetalheId(id);
  }

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-senatepi-50 dark:bg-senatepi-900/30">
            <Gavel className="h-5 w-5 text-senatepi-800 dark:text-senatepi-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">Processos</h2>
            <p className="text-sm text-muted-foreground">Acompanhamento processual · DATAJUD (CNJ)</p>
          </div>
        </div>
        <Button onClick={() => setImportOpen(true)}>
          <Plus className="h-4 w-4" /> Importar Processo
        </Button>
      </div>

      {/* Filtros */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por NPU, filiado, classe…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          {isFetching && (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>
        <select
          className={cn(inputCls, 'sm:w-48')}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as '' | StatusProcesso);
            setPage(1);
          }}
        >
          <option value="">Todos os status</option>
          {STATUS_PROCESSO_ORDEM.map((s) => (
            <option key={s} value={s}>
              {STATUS_PROCESSO_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 py-16 text-center">
          <FileWarning className="h-8 w-8 text-muted-foreground opacity-60" />
          <div>
            <p className="font-medium">Nenhum processo encontrado</p>
            <p className="text-sm text-muted-foreground">
              Importe um processo pelo número (NPU) para começar o acompanhamento.
            </p>
          </div>
          <Button onClick={() => setImportOpen(true)}>
            <Plus className="h-4 w-4" /> Importar Processo
          </Button>
        </Card>
      ) : (
        <>
          {/* Mobile: cards */}
          <div className="space-y-3 md:hidden">
            {items.map((p) => (
              <ProcessoCard key={p.id} p={p} onClick={() => abrirDetalhe(p.id)} />
            ))}
          </div>

          {/* Desktop: tabela */}
          <Card className="hidden overflow-hidden p-0 md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Processo (NPU)</th>
                    <th className="px-4 py-3 font-medium">Filiado</th>
                    <th className="px-4 py-3 font-medium">Classe</th>
                    <th className="px-4 py-3 font-medium">Tribunal</th>
                    <th className="px-4 py-3 font-medium">Mov.</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map((p) => (
                    <tr
                      key={p.id}
                      onClick={() => abrirDetalhe(p.id)}
                      className="cursor-pointer transition-colors hover:bg-muted/40"
                    >
                      <td className="px-4 py-3 font-mono text-[13px] font-medium">{formatNPU(p.numeroCNJ)}</td>
                      <td className="px-4 py-3">{p.filiado?.nomeCompleto ?? <span className="text-muted-foreground">—</span>}</td>
                      <td className="max-w-[220px] truncate px-4 py-3" title={p.classeProcessual ?? ''}>
                        {p.classeProcessual ?? '—'}
                      </td>
                      <td className="px-4 py-3">{p.tribunal ?? '—'}</td>
                      <td className="px-4 py-3 tabular-nums text-muted-foreground">{p._count.movimentacoes}</td>
                      <td className="px-4 py-3"><StatusBadge status={p.statusInterno} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Paginação */}
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {total} processo{total === 1 ? '' : 's'}
            </span>
            {totalPaginas > 1 && (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="tabular-nums">
                  {page} / {totalPaginas}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPaginas, p + 1))}
                  disabled={page >= totalPaginas}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Modal de importação */}
      <ImportarProcessoDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={(p) => {
          invalidar();
          abrirDetalhe(p.id, p.partes);
        }}
      />

      {/* Gaveta de detalhes */}
      <ProcessoDetalheSheet
        processoId={detalheId}
        open={!!detalheId}
        onClose={() => setDetalheId(null)}
        partesIniciais={partesIniciais}
        onChanged={invalidar}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card (mobile)
// ---------------------------------------------------------------------------

function ProcessoCard({ p, onClick }: { p: ProcessoLista; onClick: () => void }) {
  return (
    <Card className="cursor-pointer p-4" onClick={onClick}>
      <div className="flex items-start justify-between gap-2">
        <p className="font-mono text-sm font-semibold">{formatNPU(p.numeroCNJ)}</p>
        <StatusBadge status={p.statusInterno} />
      </div>
      <div className="mt-2 space-y-1 text-sm">
        <p className="flex items-center gap-1.5 text-muted-foreground">
          <User className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate text-foreground">{p.filiado?.nomeCompleto ?? 'Sem filiado vinculado'}</span>
        </p>
        {p.classeProcessual && <p className="truncate text-muted-foreground">{p.classeProcessual}</p>}
        <p className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Landmark className="h-3.5 w-3.5" /> {p.tribunal ?? '—'}
          </span>
          <span>{p._count.movimentacoes} movimentação(ões)</span>
        </p>
      </div>
    </Card>
  );
}
