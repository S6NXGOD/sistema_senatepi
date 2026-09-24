'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, FileText, IdCard, Receipt } from 'lucide-react';
import { CascaDoPortal } from '@/components/portal-filiado/casca';
import { Carregando, EsqueletoLinhas } from '@/components/ui/esqueleto';
import { buscarResumo } from '@/lib/portal-filiado';
import { formatDataPura } from '@/lib/data-pura';
import { cn } from '@/lib/utils';

const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export default function InicioDoPortalPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['portal-filiado', 'resumo'],
    queryFn: buscarResumo,
  });

  return (
    <CascaDoPortal>
      {isLoading || !data ? (
        <Carregando texto="Carregando…" className="space-y-3">
          <EsqueletoLinhas quantidade={3} altura={88} className="divide-y-0 space-y-3" />
        </Carregando>
      ) : (
        <div className="space-y-4">
          {/* ---- Quem é, e como está ---- */}
          <section className="rounded-2xl border bg-card p-5">
            <p className="text-xs text-muted-foreground">
              {/* Saudação sem título acadêmico: o cadastro não guarda gênero de tratamento. */}
              Olá,
            </p>
            <h1 className="mt-0.5 text-lg font-bold leading-tight">{data.nomeCompleto}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 font-semibold',
                  data.situacao === 'ATIVO'
                    ? 'bg-brand-50 text-brand-800 dark:bg-brand-900/30 dark:text-brand-300'
                    : 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
                )}
              >
                {data.situacaoRotulo}
              </span>
              <span className="text-muted-foreground">Matrícula {data.matricula}</span>
              {/*
                A data só aparece quando existe. 908 dos ativos vieram da carga
                sem ela, e "filiado desde —" não informa nada: some a linha.
              */}
              {data.dataFiliacao && (
                <span className="text-muted-foreground">
                  Filiado(a) desde {formatDataPura(data.dataFiliacao)}
                </span>
              )}
            </div>
          </section>

          {/* ---- O que pede atenção, quando pede ---- */}
          {data.cobrancas && data.cobrancas.vencidas > 0 && (
            <Link
              href="/filiado/cobrancas"
              className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 transition-colors hover:bg-amber-100 dark:border-amber-900/70 dark:bg-amber-900/20 dark:hover:bg-amber-900/30"
            >
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400" />
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-semibold text-amber-900 dark:text-amber-200">
                  {data.cobrancas.vencidas === 1
                    ? '1 parcela vencida'
                    : `${data.cobrancas.vencidas} parcelas vencidas`}
                </p>
                <p className="text-xs text-amber-800/90 dark:text-amber-300/90">
                  Veja os valores e fale com o sindicato para regularizar.
                </p>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
            </Link>
          )}

          {/* ---- Carteirinha ---- */}
          <Atalho
            href="/filiado/carteirinha"
            Icone={IdCard}
            titulo="Carteirinha digital"
            descricao={
              data.carteirinha
                ? `Nº ${data.carteirinha.numero}${
                    data.carteirinha.validaAte
                      ? ` · válida até ${formatDataPura(data.carteirinha.validaAte)}`
                      : ''
                  }`
                : 'Ainda não emitida — a secretaria emite quando você pedir.'
            }
          />

          {/* ---- Processos ---- */}
          <Atalho
            href="/filiado/processos"
            Icone={FileText}
            titulo="Meus processos"
            descricao={
              data.processos.total === 0
                ? 'Você não tem processo no sindicato.'
                : `${data.processos.total} no total · ${data.processos.emAndamento} em andamento`
            }
          />

          {/* ---- Cobranças: só onde o cliente usa ---- */}
          {data.cobrancas && (
            <Atalho
              href="/filiado/cobrancas"
              Icone={Receipt}
              titulo="Minhas cobranças"
              descricao={
                data.cobrancas.emAberto === 0
                  ? 'Nada em aberto.'
                  : `${data.cobrancas.emAberto} em aberto · ${MOEDA.format(data.cobrancas.total)}`
              }
            />
          )}
        </div>
      )}
    </CascaDoPortal>
  );
}

function Atalho({
  href,
  Icone,
  titulo,
  descricao,
}: {
  href: string;
  Icone: typeof IdCard;
  titulo: string;
  descricao: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-2xl border bg-card p-4 transition-colors hover:bg-muted/50"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-800 dark:bg-brand-900/30 dark:text-brand-300">
        <Icone className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{titulo}</p>
        <p className="text-xs leading-snug text-muted-foreground">{descricao}</p>
      </div>
      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
