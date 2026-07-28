'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Search, Plus, Receipt, CalendarClock, User } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ParcelaAcoes } from '@/components/cobrancas/parcela-actions';
import {
  listarParcelas, StatusParcela, TIPO_LABEL, STATUS_LABEL, STATUS_COR,
  formatBRL, formatData, statusExibicao,
} from '@/lib/cobrancas';

const STATUS_FILTRO: { valor: '' | StatusParcela; label: string }[] = [
  { valor: '', label: 'Todas' },
  { valor: 'PENDENTE', label: 'A vencer' },
  { valor: 'VENCIDO', label: 'Vencidas' },
  { valor: 'PAGO', label: 'Pagas' },
  { valor: 'CANCELADO', label: 'Canceladas' },
];

export default function CobrancasPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'' | StatusParcela>('');
  const [mes, setMes] = useState('');
  const [busca, setBusca] = useState('');
  const [buscaDeb, setBuscaDeb] = useState('');

  // debounce leve da busca
  useEffect(() => {
    const t = setTimeout(() => setBuscaDeb(busca.trim()), 350);
    return () => clearTimeout(t);
  }, [busca]);

  const { data, isLoading } = useQuery({
    queryKey: ['cobrancas-parcelas', status, mes, buscaDeb],
    queryFn: () => listarParcelas({ status: status || undefined, mes: mes || undefined, busca: buscaDeb || undefined }),
  });

  const parcelas = data ?? [];
  const invalidar = () => qc.invalidateQueries({ queryKey: ['cobrancas-parcelas'] });

  const resumo = useMemo(() => {
    let aberto = 0, vencido = 0, pago = 0;
    for (const p of parcelas) {
      const st = statusExibicao(p);
      const v = Number(p.valor);
      if (st === 'PAGO') pago += v;
      else if (st === 'VENCIDO') vencido += v;
      else if (st === 'PENDENTE') aberto += v;
    }
    return { aberto, vencido, pago, total: parcelas.length };
  }, [parcelas]);

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
            <p className="text-sm text-muted-foreground">Carnês e parcelas dos filiados</p>
          </div>
        </div>
        <Link href="/cobrancas/nova">
          <Button><Plus className="h-4 w-4" /> Nova cobrança</Button>
        </Link>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ResumoTile rotulo="Parcelas" valor={String(resumo.total)} />
        <ResumoTile rotulo="A vencer" valor={formatBRL(resumo.aberto)} cor="text-amber-600 dark:text-amber-400" />
        <ResumoTile rotulo="Vencidas" valor={formatBRL(resumo.vencido)} cor="text-red-600 dark:text-red-400" />
        <ResumoTile rotulo="Pagas" valor={formatBRL(resumo.pago)} cor="text-senatepi-700 dark:text-senatepi-400" />
      </div>

      {/* Filtros */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar por filiado (nome, matrícula, CPF)…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <input
          type="month"
          value={mes}
          onChange={(e) => setMes(e.target.value)}
          aria-label="Mês de vencimento"
          className="h-12 rounded-md border border-input bg-background px-3 text-base sm:h-10 sm:w-auto sm:text-sm"
        />
        <div className="flex flex-wrap gap-1 rounded-lg border border-input bg-card p-1">
          {STATUS_FILTRO.map((f) => (
            <button
              key={f.label}
              onClick={() => setStatus(f.valor)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                status === f.valor ? 'bg-senatepi-800 text-white shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-senatepi-800 dark:text-senatepi-400" /></div>
      ) : parcelas.length === 0 ? (
        <Card><CardContent className="py-20 text-center text-muted-foreground">Nenhuma parcela encontrada com esses filtros.</CardContent></Card>
      ) : (
        <>
          {/* Mobile: cards */}
          <div className="space-y-3 sm:hidden">
            {parcelas.map((p) => {
              const st = statusExibicao(p);
              return (
                <div key={p.id} className="rounded-xl border bg-card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 truncate font-semibold">
                        <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> {p.filiado.nomeCompleto}
                      </p>
                      <p className="text-xs text-muted-foreground">Matrícula {p.filiado.matricula} · {TIPO_LABEL[p.tipo]} · Parc. {p.numero}</p>
                    </div>
                    <ParcelaAcoes parcela={p} onMudou={invalidar} />
                  </div>
                  <div className="mt-3 flex items-end justify-between">
                    <div>
                      <p className="text-lg font-bold">{formatBRL(p.valor)}</p>
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <CalendarClock className="h-3.5 w-3.5" /> Vence {formatData(p.dataVencimento)}
                      </p>
                    </div>
                    <Badge className={STATUS_COR[st]}>{STATUS_LABEL[st]}</Badge>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop: tabela */}
          <Card className="hidden sm:block">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                      <th className="px-4 py-3 font-medium">Filiado</th>
                      <th className="px-4 py-3 font-medium">Tipo / Parcela</th>
                      <th className="px-4 py-3 font-medium">Vencimento</th>
                      <th className="px-4 py-3 font-medium">Valor</th>
                      <th className="px-4 py-3 font-medium">Situação</th>
                      <th className="px-4 py-3 text-right font-medium">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parcelas.map((p) => {
                      const st = statusExibicao(p);
                      return (
                        <tr key={p.id} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="px-4 py-3">
                            <div className="font-medium">{p.filiado.nomeCompleto}</div>
                            <div className="text-xs text-muted-foreground">Matrícula {p.filiado.matricula}</div>
                          </td>
                          <td className="px-4 py-3">{TIPO_LABEL[p.tipo]} · {p.numero}</td>
                          <td className="px-4 py-3 tabular-nums">{formatData(p.dataVencimento)}</td>
                          <td className="px-4 py-3 font-semibold tabular-nums">{formatBRL(p.valor)}</td>
                          <td className="px-4 py-3"><Badge className={STATUS_COR[st]}>{STATUS_LABEL[st]}</Badge></td>
                          <td className="px-4 py-3">
                            <div className="flex justify-end"><ParcelaAcoes parcela={p} onMudou={invalidar} /></div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function ResumoTile({ rotulo, valor, cor }: { rotulo: string; valor: string; cor?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{rotulo}</p>
        <p className={`mt-1 text-lg font-bold tabular-nums ${cor ?? ''}`}>{valor}</p>
      </CardContent>
    </Card>
  );
}
