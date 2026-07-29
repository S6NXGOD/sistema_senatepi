'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ChevronDown, ChevronRight, User, Plus, CalendarClock, Trash2, Loader2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ParcelaAcoes } from '@/components/cobrancas/parcela-actions';
import {
  FiliadoResumoFin, historicoFiliado, excluirCobranca,
  formatBRL, formatData, statusExibicao, STATUS_LABEL, STATUS_COR, TIPO_LABEL,
} from '@/lib/cobrancas';

/** Linha/card de um filiado na listagem agrupada — expande para ver as cobranças. */
export function FiliadoCobrancasCard({ resumo, onMudou }: { resumo: FiliadoResumoFin; onMudou: () => void }) {
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [confirmar, setConfirmar] = useState<{
    id: string;
    label: string;
    qtdPagas: number;
    valorPago: number;
  } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['cobrancas-filiado', resumo.filiadoId],
    queryFn: () => historicoFiliado(resumo.filiadoId),
    enabled: aberto,
  });

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['cobrancas-filiado', resumo.filiadoId] });
    onMudou();
  };

  const excluir = useMutation({
    mutationFn: ({ id, force }: { id: string; force: boolean }) => excluirCobranca(id, force),
    onSuccess: () => {
      toast.success('Cobrança excluída.');
      setConfirmar(null);
      invalidar();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível excluir a cobrança.'),
  });

  const emDia = resumo.totalVencido <= 0 && resumo.totalEmAberto <= 0;

  return (
    <div className="rounded-xl border bg-card">
      {/* Cabeçalho do filiado */}
      <div className="flex items-center gap-3 p-4">
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          aria-label={aberto ? 'Recolher' : 'Expandir'}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
        >
          {aberto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>

        <div className="min-w-0 flex-1">
          <button type="button" onClick={() => setAberto((v) => !v)} className="block w-full text-left">
            <p className="flex items-center gap-1.5 truncate font-semibold">
              <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> {resumo.nomeCompleto}
            </p>
            <p className="text-xs text-muted-foreground">Matrícula {resumo.matricula} · {resumo.qtdParcelas} parcela(s)</p>
          </button>
          {/* Chips de situação */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            {resumo.totalVencido > 0 && (
              <Badge className="bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                Vencido {formatBRL(resumo.totalVencido)} · {resumo.qtdVencidas}
              </Badge>
            )}
            {resumo.totalEmAberto > 0 && (
              <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                A vencer {formatBRL(resumo.totalEmAberto)}
              </Badge>
            )}
            {emDia && (
              <Badge className="bg-senatepi-50 text-senatepi-800 dark:bg-senatepi-900/30 dark:text-senatepi-400">Em dia</Badge>
            )}
            {resumo.proximoVencimento && (
              <span className="flex items-center gap-1 text-muted-foreground">
                <CalendarClock className="h-3 w-3" /> próx. {formatData(resumo.proximoVencimento)}
              </span>
            )}
          </div>
        </div>

        <Link href={`/cobrancas/nova?filiadoId=${resumo.filiadoId}`} className="shrink-0">
          <Button size="sm" variant="outline"><Plus className="h-4 w-4" /> <span className="hidden sm:inline">Nova</span></Button>
        </Link>
      </div>

      {/* Cobranças do filiado (carregadas ao expandir) */}
      {aberto && (
        <div className="border-t p-4">
          {isLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-senatepi-800 dark:text-senatepi-400" /></div>
          ) : !data || data.cobrancas.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Nenhuma cobrança lançada.</p>
          ) : (
            <div className="space-y-3">
              {data.cobrancas.map((c) => (
                <div key={c.id} className="overflow-hidden rounded-lg border">
                  <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
                    <p className="min-w-0 truncate text-sm">
                      <span className="font-semibold">{TIPO_LABEL[c.tipo]}</span> · {c.parcelas.length}× · {formatBRL(c.valorTotal)}
                      <span className="text-xs text-muted-foreground"> · {formatData(c.createdAt)}</span>
                    </p>
                    <Button
                      size="icon" variant="ghost"
                      className="h-8 w-8 shrink-0 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                      title="Excluir cobrança"
                      onClick={() => {
                        const pagas = c.parcelas.filter((p) => p.status === 'PAGO');
                        setConfirmar({
                          id: c.id,
                          label: `${TIPO_LABEL[c.tipo]} (${c.parcelas.length}× · ${formatBRL(c.valorTotal)})`,
                          qtdPagas: pagas.length,
                          valorPago: pagas.reduce((s, p) => s + Number(p.valor), 0),
                        });
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <ul className="divide-y">
                    {c.parcelas.map((p) => {
                      const st = statusExibicao(p);
                      return (
                        <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">{p.numero}</span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium tabular-nums">{formatBRL(p.valor)}</p>
                            <p className="text-xs text-muted-foreground">Vence {formatData(p.dataVencimento)}</p>
                          </div>
                          <Badge className={`${STATUS_COR[st]} shrink-0`}>{STATUS_LABEL[st]}</Badge>
                          <ParcelaAcoes
                            parcela={{
                              id: p.id, numero: p.numero, valor: p.valor,
                              dataCompetencia: p.dataCompetencia, dataVencimento: p.dataVencimento,
                              status: p.status, tipo: c.tipo, cobrancaId: c.id,
                              filiado: {
                                nomeCompleto: resumo.nomeCompleto,
                                matricula: resumo.matricula,
                                telefonePrincipal: resumo.telefonePrincipal,
                              },
                            }}
                            onMudou={invalidar}
                          />
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!confirmar}
        variant="destructive"
        title="Excluir cobrança"
        icon={<Trash2 className="h-6 w-6" />}
        description={
          confirmar?.qtdPagas ? (
            <>
              A cobrança <strong>{confirmar.label}</strong> possui{' '}
              <strong>{confirmar.qtdPagas} parcela(s) paga(s)</strong>. Excluir também vai{' '}
              <strong>remover o(s) lançamento(s) financeiro(s)</strong> de{' '}
              <strong>{formatBRL(confirmar.valorPago)}</strong>, reduzindo o saldo da conta. Esta
              ação é <strong>irreversível</strong>.
            </>
          ) : (
            <>
              Excluir a cobrança <strong>{confirmar?.label}</strong> e todas as suas parcelas? Esta
              ação é irreversível.
            </>
          )
        }
        confirmLabel={confirmar?.qtdPagas ? 'Excluir mesmo assim' : 'Excluir cobrança'}
        loading={excluir.isPending}
        onConfirm={() => confirmar && excluir.mutate({ id: confirmar.id, force: confirmar.qtdPagas > 0 })}
        onClose={() => setConfirmar(null)}
      />
    </div>
  );
}
