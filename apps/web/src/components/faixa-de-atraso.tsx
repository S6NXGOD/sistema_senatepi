'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Users } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { podeVer } from '@/lib/permissoes';
import { fraseDaFaixa, minhasPendencias } from '@/lib/pendencias';

/**
 * A FAIXA DE AVISOS — o único aviso que aparece em toda tela.
 *
 * TRÊS REGRAS QUE A IMPEDEM DE VIRAR RUÍDO:
 *
 *  1. Só o que não pode esperar: o que é seu e ficou para trás, a publicação que
 *     nunca virou tarefa, e a tarefa da sua equipe sem ninguém cuidando. O dia de
 *     hoje e a audiência da semana moram no painel. Faixa que aparece todo dia é
 *     cabeçalho, e cabeçalho ninguém lê.
 *  2. NÃO tem botão de fechar. Ela some quando o trabalho é feito, porque é
 *     estado derivado — fechar ensinaria que dá para calar o aviso sem resolver.
 *  3. Uma linha, âmbar, sem repreender ninguém. Um item só leva ao próprio item;
 *     vários levam à lista.
 *
 * ERA A IRMÃ DO SINO, que saiu em 12/09/2026 por repetir o painel numa gaveta
 * que ninguém abria. Ficou só ela — e por isso passou a dizer QUAL é a coisa, e
 * não só quantas.
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

  const pendencias = data?.pendencias ?? [];
  if (!pendencias.length) return null;

  const [primeira, ...demais] = pendencias.map(fraseDaFaixa);
  const Icone = pendencias[0].tipo === 'PRECISA_DA_EQUIPE' ? Users : AlertTriangle;

  return (
    <div className="border-b border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30">
      <div className="flex items-center gap-2 px-4 py-2 text-sm text-amber-900 dark:text-amber-200 md:px-6">
        <Link
          href={primeira.href}
          className="flex min-w-0 flex-1 items-center gap-2 rounded underline-offset-2 hover:underline"
        >
          <Icone className="h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-0 truncate">{primeira.texto}</span>
          <ArrowRight className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
        </Link>
        {/* No computador cabe o resto na mesma linha; no celular, vira um "+N". */}
        {demais.map((f) => (
          <Link
            key={`${f.href}|${f.texto}`}
            href={f.href}
            className="hidden shrink-0 border-l border-amber-300/70 pl-2 underline-offset-2 hover:underline dark:border-amber-800 lg:inline"
          >
            {f.texto}
          </Link>
        ))}
        {demais.length > 0 && (
          <Link
            href="/dashboard"
            aria-label={`Mais ${demais.length} ${demais.length === 1 ? 'aviso' : 'avisos'} no painel`}
            className="shrink-0 rounded-full bg-amber-200/70 px-2 py-0.5 text-xs font-semibold transition hover:bg-amber-200 dark:bg-amber-900/60 lg:hidden"
          >
            +{demais.length}
          </Link>
        )}
      </div>
    </div>
  );
}
