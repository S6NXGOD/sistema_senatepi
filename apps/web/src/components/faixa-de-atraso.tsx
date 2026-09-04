'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { podeVer } from '@/lib/permissoes';
import { minhasPendencias, PENDENCIA, rotulo } from '@/lib/pendencias';

/**
 * A FAIXA DE ATRASO — o sino não basta para prazo vencido.
 *
 * O sino é discreto de propósito: ele convive com o dia normal. Prazo vencido
 * não é dia normal, e um contador no canto superior direito é fácil demais de
 * não ver quando se entra no sistema para fazer outra coisa.
 *
 * TRÊS REGRAS QUE A IMPEDEM DE VIRAR RUÍDO:
 *
 *  1. Só aparece para o que JÁ VENCEU e para publicação que nunca virou tarefa.
 *     Tarefa de hoje e audiência da semana ficam no sino. Uma faixa que aparece
 *     todo dia é um cabeçalho, e cabeçalho ninguém lê.
 *  2. NÃO tem botão de fechar. Ela não some por ser dispensada — some quando o
 *     trabalho é feito, porque é estado derivado. Fechar seria ensinar que dá
 *     para calar o aviso sem resolver.
 *  3. Uma linha, e nada de vermelho pesado. O texto diz o número e leva para a
 *     agenda; não repreende ninguém.
 *
 * Usa a MESMA chave de consulta do sino: o React Query serve os dois com uma
 * requisição só.
 */
export function FaixaDeAtraso() {
  const { user } = useAuth();
  const permitido = podeVer(user?.role, user?.permissoes, 'agenda');

  const { data } = useQuery({
    queryKey: ['minhas-pendencias'],
    queryFn: minhasPendencias,
    enabled: permitido,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });

  const urgentes = (data?.pendencias ?? []).filter((p) => PENDENCIA[p.tipo].urgente);
  if (!urgentes.length) return null;

  return (
    <div className="border-b border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30">
      <Link
        href="/agenda"
        className="flex items-center gap-2 px-4 py-2 text-sm text-amber-900 transition hover:bg-amber-100/60 dark:text-amber-200 dark:hover:bg-amber-950/50 md:px-6"
      >
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {urgentes.map((p) => rotulo(p)).join(' · ')}
        </span>
        <ArrowRight className="h-4 w-4 shrink-0" />
      </Link>
    </div>
  );
}
