'use client';

import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Receipt } from 'lucide-react';
import { CascaDoPortal } from '@/components/portal-filiado/casca';
import { Carregando, EsqueletoLinhas } from '@/components/ui/esqueleto';
import { buscarMinhasCobrancas } from '@/lib/portal-filiado';
import { diasDesdeDataPura, formatDataPura } from '@/lib/data-pura';
import { cn } from '@/lib/utils';
import { tenant } from '@/tenant.config';

const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** O rótulo que a pessoa entende, não o enum do banco. */
const ROTULO_DA_PARCELA: Record<string, string> = {
  PAGO: 'Paga',
  PENDENTE: 'Em aberto',
  ATRASADO: 'Vencida',
  CANCELADO: 'Cancelada',
};

export default function MinhasCobrancasPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['portal-filiado', 'cobrancas'],
    queryFn: buscarMinhasCobrancas,
  });


  return (
    <CascaDoPortal>
      <h1 className="mb-4 text-lg font-bold">Minhas cobranças</h1>

      {isLoading ? (
        <Carregando texto="Carregando…">
          <EsqueletoLinhas quantidade={2} altura={140} className="divide-y-0 space-y-3" />
        </Carregando>
      ) : !data?.length ? (
        <div className="rounded-2xl border bg-card p-6 text-center">
          <Receipt className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-semibold">Você não tem cobrança registrada.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {data.map((c) => (
            <section key={c.id} className="overflow-hidden rounded-2xl border bg-card">
              <header className="border-b px-5 py-3">
                <p className="text-sm font-semibold">{c.descricao || c.tipo}</p>
                <p className="text-xs text-muted-foreground">
                  {c.parcelas.length === 1
                    ? 'Parcela única'
                    : `${c.parcelas.length} parcelas`}{' '}
                  · {MOEDA.format(c.valorTotal)}
                </p>
              </header>

              <ul className="divide-y">
                {c.parcelas.map((p) => {
                  const paga = p.status === 'PAGO';
                  /*
                    VENCIDA SE COMPARA POR DIA, não por instante. `dataVencimento`
                    é coluna de DATA PURA (meia-noite UTC): comparar com
                    `new Date()` no fuso local marcaria como vencida a parcela
                    que vence hoje.
                  */
                  /*
                    `diasDesdeDataPura` e não uma comparação de datas: comparar
                    "24/09/2026" com "25/09/2026" como TEXTO não ordena (o dia
                    vem antes do ano), e comparar `Date` cru erra por um dia
                    porque a coluna é data pura em meia-noite UTC. A função da
                    casa já conta por calendário de Teresina; > 0 significa que
                    o dia do vencimento já passou — vencer HOJE não é vencida.
                  */
                  const vencida = !paga && (diasDesdeDataPura(p.dataVencimento) ?? 0) > 0;
                  return (
                    <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                      <span
                        className={cn(
                          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                          paga
                            ? 'bg-brand-50 text-brand-800 dark:bg-brand-900/30 dark:text-brand-300'
                            : vencida
                              ? 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                              : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {paga ? <CheckCircle2 className="h-4 w-4" /> : p.numero}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{MOEDA.format(p.valor)}</p>
                        <p className="text-[11px] text-muted-foreground">
                          Vence em {formatDataPura(p.dataVencimento)}
                          {paga && p.dataPagamento && ` · paga em ${formatDataPura(p.dataPagamento)}`}
                        </p>
                      </div>
                      <span
                        className={cn(
                          'shrink-0 text-[11px] font-semibold',
                          paga
                            ? 'text-brand-700 dark:text-brand-400'
                            : vencida
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-muted-foreground',
                        )}
                      >
                        {vencida && !paga ? 'Vencida' : (ROTULO_DA_PARCELA[p.status] ?? p.status)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          {/*
            O PORTAL NÃO COBRA E NÃO RECEBE. Não há botão de pagar porque não há
            pagamento pelo sistema: a parte financeira é da secretaria, e
            prometer um "pague aqui" que não existe faria a pessoa esperar por
            um boleto que nunca chega.
          */}
          <p className="text-center text-[11px] leading-snug text-muted-foreground">
            Para segunda via, PIX ou acerto de valores, fale com a secretaria do {tenant.sigla}.
          </p>
        </div>
      )}
    </CascaDoPortal>
  );
}
