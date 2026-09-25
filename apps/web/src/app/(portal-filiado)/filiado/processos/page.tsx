'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, FileText, Lock, MessageSquareText } from 'lucide-react';
import { CascaDoPortal } from '@/components/portal-filiado/casca';
import { Carregando, EsqueletoLinhas } from '@/components/ui/esqueleto';
import { buscarMeusProcessos, type MeuProcesso } from '@/lib/portal-filiado';
import { formatData } from '@/lib/processos';
import { cn } from '@/lib/utils';
import { tenant } from '@/tenant.config';

/**
 * As cores dizem em que pé está o caso — e nunca prometem resultado.
 *
 * "Ganho — em execução" é verde porque já aconteceu; "Em andamento" é neutro
 * porque ainda não se sabe. Pintar de verde um processo em curso seria o
 * sistema opinando sobre o que o juiz ainda vai decidir.
 */
const COR_DA_SITUACAO: Record<string, string> = {
  GANHO_EXECUCAO: 'bg-brand-50 text-brand-800 dark:bg-brand-900/30 dark:text-brand-300',
  IMPROCEDENTE: 'bg-rose-50 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300',
  ENCERRADO: 'bg-muted text-muted-foreground',
  ARQUIVADO: 'bg-muted text-muted-foreground',
  SUSPENSO: 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
};

export default function MeusProcessosPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['portal-filiado', 'processos'],
    queryFn: buscarMeusProcessos,
  });

  return (
    <CascaDoPortal>
      <h1 className="mb-4 text-lg font-bold">Meus processos</h1>

      {isLoading ? (
        <Carregando texto="Carregando…">
          <EsqueletoLinhas quantidade={3} altura={96} className="divide-y-0 space-y-3" />
        </Carregando>
      ) : !data?.length ? (
        <div className="rounded-2xl border bg-card p-6 text-center">
          <FileText className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-semibold">Você não tem processo no sindicato.</p>
          <p className="mx-auto mt-1 max-w-xs text-xs leading-snug text-muted-foreground">
            Se precisar de orientação jurídica, procure o {tenant.sigla} — o atendimento começa por
            uma triagem.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {data.map((p) => (
            <li key={p.id}>
              <CartaoDoProcesso processo={p} />
            </li>
          ))}
        </ul>
      )}
    </CascaDoPortal>
  );
}

function CartaoDoProcesso({ processo: p }: { processo: MeuProcesso }) {
  return (
    <Link
      href={`/filiado/processos/${p.id}`}
      className="flex items-start gap-3 rounded-2xl border bg-card p-4 transition-colors hover:bg-muted/50"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[11px] font-semibold',
              COR_DA_SITUACAO[p.statusInterno] ?? 'bg-muted text-muted-foreground',
            )}
          >
            {p.situacao}
          </span>
          {p.segredoJustica && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Lock className="h-3 w-3" /> Segredo de justiça
            </span>
          )}
          {/*
            O RECADO NÃO PODE FICAR ESCONDIDO ATRÁS DE UM TOQUE. Se alguém
            escreveu para esta pessoa, ela tem de ver na lista — senão o
            advogado escreve e ninguém lê.
          */}
          {p.recadosNovos > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
              <MessageSquareText className="h-3 w-3" />
              {p.recadosNovos === 1 ? 'Recado novo' : `${p.recadosNovos} recados novos`}
            </span>
          )}
        </div>

        {/*
          O NÚMERO É O QUE A PESSOA CONFERE com o advogado e com o tribunal —
          por isso vem em destaque, e não o título interno. Sem número (fase
          pré-processual), a API já manda a frase que explica em vez de um vazio.
        */}
        <p className="mt-2 break-all font-mono text-sm font-semibold leading-snug">
          {p.identificacao}
        </p>

        {(p.classeProcessual || p.assuntoPrincipal) && (
          <p className="mt-1 line-clamp-2 text-xs leading-snug text-muted-foreground">
            {[p.classeProcessual, p.assuntoPrincipal].filter(Boolean).join(' · ')}
          </p>
        )}

        <p className="mt-2 text-[11px] text-muted-foreground">
          {p.orgaoJulgador ?? p.tribunal ?? 'Órgão ainda não informado'}
          {p.ultimoMovimentoEm && ` · última movimentação em ${formatData(p.ultimoMovimentoEm)}`}
        </p>
      </div>
      <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
