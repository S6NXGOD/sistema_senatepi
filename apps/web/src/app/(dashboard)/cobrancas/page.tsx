'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Loader2, Search, Plus, Receipt, Settings2, Users,
  TrendingUp, TrendingDown, AlertTriangle, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FiliadoCobrancasCard } from '@/components/cobrancas/filiado-cobrancas-card';
import { listarPorFiliado, getDashboard, formatBRL } from '@/lib/cobrancas';

const PAGE_SIZE = 20;

export default function CobrancasPage() {
  const qc = useQueryClient();
  const [busca, setBusca] = useState('');
  const [buscaDeb, setBuscaDeb] = useState('');
  const [inadimplentes, setInadimplentes] = useState(false);
  const [page, setPage] = useState(1);

  // debounce da busca + volta pra 1ª página quando muda o filtro
  useEffect(() => {
    const t = setTimeout(() => { setBuscaDeb(busca.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [busca]);
  useEffect(() => { setPage(1); }, [inadimplentes]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['cobrancas-por-filiado', buscaDeb, inadimplentes, page],
    queryFn: () => listarPorFiliado({ busca: buscaDeb || undefined, inadimplentes, page, pageSize: PAGE_SIZE }),
  });

  const { data: dash } = useQuery({ queryKey: ['cobrancas-dashboard'], queryFn: getDashboard });

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['cobrancas-por-filiado'] });
    qc.invalidateQueries({ queryKey: ['cobrancas-dashboard'] });
  };

  const itens = data?.items ?? [];
  const totalPaginas = data?.totalPaginas ?? 1;

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-senatepi-50 dark:bg-senatepi-900/30">
            <Receipt className="h-5 w-5 text-senatepi-800 dark:text-senatepi-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">Cobranças</h2>
            <p className="text-sm text-muted-foreground">Carnês e parcelas por filiado</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/cobrancas/configuracao">
            <Button variant="outline"><Settings2 className="h-4 w-4" /> Configuração</Button>
          </Link>
          <Link href="/cobrancas/nova">
            <Button><Plus className="h-4 w-4" /> Nova cobrança</Button>
          </Link>
        </div>
      </div>

      {/* Mini-dashboard de inadimplência (mês corrente) */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <DashCard Icon={TrendingUp} rotulo="Receita prevista (mês)" valor={formatBRL(dash?.receitaPrevista ?? 0)} sub="Parcelas a vencer no mês" cor="text-amber-600 dark:text-amber-400" bg="bg-amber-100 dark:bg-amber-900/30" />
        <DashCard Icon={TrendingDown} rotulo="Receita realizada (mês)" valor={formatBRL(dash?.receitaRealizada ?? 0)} sub="Parcelas pagas no mês" cor="text-senatepi-700 dark:text-senatepi-400" bg="bg-senatepi-50 dark:bg-senatepi-900/30" />
        <DashCard Icon={AlertTriangle} rotulo="Inadimplência (mês)" valor={`${(dash?.taxaInadimplencia ?? 0).toLocaleString('pt-BR')}%`} sub={`${dash?.qtdVencido ?? 0} vencida(s) · ${formatBRL(dash?.totalVencido ?? 0)}`} cor="text-red-600 dark:text-red-400" bg="bg-red-100 dark:bg-red-900/30" />
      </div>

      {/* Filtros */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar filiado (nome, matrícula, CPF)…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          {isFetching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
        </div>
        <label className="flex cursor-pointer select-none items-center gap-2 rounded-lg border border-input bg-card px-3 py-2 text-sm">
          <input type="checkbox" checked={inadimplentes} onChange={(e) => setInadimplentes(e.target.checked)} className="h-4 w-4 accent-senatepi-700" />
          Somente inadimplentes
        </label>
      </div>

      {/* Lista agrupada por filiado */}
      {isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-senatepi-800 dark:text-senatepi-400" /></div>
      ) : itens.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-20 text-center text-muted-foreground">
            <Users className="h-8 w-8 opacity-40" />
            {buscaDeb || inadimplentes ? 'Nenhum filiado encontrado com esses filtros.' : 'Nenhuma cobrança lançada ainda.'}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="space-y-3">
            {itens.map((r) => (
              <FiliadoCobrancasCard key={r.filiadoId} resumo={r} onMudou={invalidar} />
            ))}
          </div>

          {/* Paginação */}
          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="text-sm text-muted-foreground">
              {data?.total ?? 0} filiado(s) · página {data?.page ?? 1} de {totalPaginas}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1 || isFetching} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                <ChevronLeft className="h-4 w-4" /> Anterior
              </Button>
              <Button variant="outline" size="sm" disabled={page >= totalPaginas || isFetching} onClick={() => setPage((p) => Math.min(totalPaginas, p + 1))}>
                Próxima <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function DashCard({ Icon, rotulo, valor, sub, cor, bg }: {
  Icon: React.ElementType;
  rotulo: string;
  valor: string;
  sub?: string;
  cor?: string;
  bg?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${bg ?? 'bg-muted'}`}>
          <Icon className={`h-5 w-5 ${cor ?? ''}`} />
        </div>
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{rotulo}</p>
          <p className={`text-xl font-bold tabular-nums ${cor ?? ''}`}>{valor}</p>
          {sub && <p className="truncate text-[11px] text-muted-foreground">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
