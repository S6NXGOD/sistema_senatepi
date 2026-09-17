'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Gavel, Users } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { podeVer } from '@/lib/permissoes';
import { fraseDaFaixa, minhasPendencias, type TipoPendencia } from '@/lib/pendencias';

/**
 * A FAIXA DE AVISOS — o único aviso que aparece em toda tela.
 *
 * TRÊS REGRAS QUE A IMPEDEM DE VIRAR RUÍDO:
 *
 *  1. Só o que não pode esperar: o que é seu e ficou para trás, a publicação que
 *     nunca virou tarefa, a tarefa da sua equipe sem ninguém cuidando e o ato do
 *     tribunal que ninguém decidiu. O dia de hoje e a audiência da semana moram
 *     no painel. Faixa que aparece todo dia é cabeçalho, e cabeçalho ninguém lê.
 *
 *     O QUARTO ENTROU EM 17/09/2026, no lugar de uma tarefa. O robô do DataJud
 *     abria "Verificação de Intimação / Prazo" sem saber o que o juízo pediu —
 *     32 das 48 foram canceladas. "Se for algo urgente, mande um alerta, mas não
 *     encha de tarefas desnecessárias": o ato passou a ser aviso, e aviso some
 *     quando alguém decide, sem entulhar a agenda de ninguém.
 *  2. NÃO tem botão de fechar. Ela some quando o trabalho é feito, porque é
 *     estado derivado — fechar ensinaria que dá para calar o aviso sem resolver.
 *  3. Uma linha, âmbar, sem repreender ninguém. Um item só leva ao próprio item;
 *     vários levam à lista.
 *
 * ERA A IRMÃ DO SINO, que saiu em 12/09/2026 por repetir o painel numa gaveta
 * que ninguém abria. Ficou só ela — e por isso passou a dizer QUAL é a coisa, e
 * não só quantas.
 */
/**
 * O DESENHO DIZ DE QUE NATUREZA É O AVISO, antes de a frase ser lida.
 *
 * Três naturezas diferentes com o mesmo triângulo de alerta viravam uma coisa só
 * no canto do olho. O martelo do ato do tribunal separa "o juízo fez algo e
 * ninguém olhou" de "você está atrasado" — que pedem reações diferentes.
 *
 * O `??` na leitura é a rede da janela de troca: tipo que a tela não conhece já
 * não chega aqui (`soConhecidas`), mas um ícone faltando não pode derrubar o
 * cabeçalho de todas as páginas.
 */
const ICONE: Partial<Record<TipoPendencia, typeof AlertTriangle>> = {
  PRECISA_DA_EQUIPE: Users,
  ATO_ESPERANDO_OLHO: Gavel,
};

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
  const Icone = ICONE[pendencias[0].tipo] ?? AlertTriangle;

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
