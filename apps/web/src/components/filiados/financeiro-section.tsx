'use client';

import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Wallet, Plus, CalendarClock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ParcelaAcoes } from '@/components/cobrancas/parcela-actions';
import {
  historicoFiliado, formatBRL, formatData, statusExibicao,
  STATUS_LABEL, STATUS_COR, TIPO_LABEL,
} from '@/lib/cobrancas';

interface FiliadoFin {
  id: string;
  nomeCompleto: string;
  matricula: string;
  telefonePrincipal?: string | null;
}

/** Bloco financeiro dentro do perfil do filiado: resumo + parcelas + ações. */
export function FinanceiroSection({ filiado }: { filiado: FiliadoFin }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['cobrancas-filiado', filiado.id],
    queryFn: () => historicoFiliado(filiado.id),
  });

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['cobrancas-filiado', filiado.id] });
    qc.invalidateQueries({ queryKey: ['cobrancas-parcelas'] });
  };

  const parcelas = (data?.cobrancas ?? []).flatMap((c) =>
    c.parcelas.map((p) => ({ ...p, tipo: c.tipo, cobrancaId: c.id })),
  );

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2"><Wallet className="h-4 w-4" /> Financeiro</CardTitle>
        <Link href={`/cobrancas/nova?filiadoId=${filiado.id}`}>
          <Button size="sm" variant="outline"><Plus className="h-4 w-4" /> Nova cobrança</Button>
        </Link>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-brand-800 dark:text-brand-400" /></div>
        ) : (
          <>
            {/* Resumo */}
            {data && (
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-muted/40 p-2">
                  <p className="text-[11px] uppercase text-muted-foreground">A vencer</p>
                  <p className="text-sm font-bold tabular-nums text-amber-600 dark:text-amber-400">{formatBRL(data.resumo.totalEmAberto)}</p>
                </div>
                <div className="rounded-lg bg-muted/40 p-2">
                  <p className="text-[11px] uppercase text-muted-foreground">Vencido</p>
                  <p className="text-sm font-bold tabular-nums text-red-600 dark:text-red-400">{formatBRL(data.resumo.totalVencido)}</p>
                </div>
                <div className="rounded-lg bg-muted/40 p-2">
                  <p className="text-[11px] uppercase text-muted-foreground">Pago</p>
                  <p className="text-sm font-bold tabular-nums text-brand-700 dark:text-brand-400">{formatBRL(data.resumo.totalPago)}</p>
                </div>
              </div>
            )}

            {/* Lista de parcelas */}
            {parcelas.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma cobrança lançada para este filiado.</p>
            ) : (
              <ul className="divide-y">
                {parcelas.map((p) => {
                  const st = statusExibicao(p);
                  return (
                    <li key={p.id} className="flex items-center gap-3 py-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">{p.numero}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium tabular-nums">{formatBRL(p.valor)}</p>
                        <p className="flex items-center gap-1 text-xs text-muted-foreground">
                          <CalendarClock className="h-3 w-3" /> {formatData(p.dataVencimento)} · {TIPO_LABEL[p.tipo]}
                        </p>
                      </div>
                      <Badge className={`${STATUS_COR[st]} shrink-0`}>{STATUS_LABEL[st]}</Badge>
                      <ParcelaAcoes
                        parcela={{
                          id: p.id,
                          numero: p.numero,
                          valor: p.valor,
                          dataCompetencia: p.dataCompetencia,
                          dataVencimento: p.dataVencimento,
                          status: p.status,
                          tipo: p.tipo,
                          cobrancaId: p.cobrancaId,
                          filiado: {
                            nomeCompleto: filiado.nomeCompleto,
                            matricula: filiado.matricula,
                            telefonePrincipal: filiado.telefonePrincipal,
                          },
                        }}
                        onMudou={invalidar}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
