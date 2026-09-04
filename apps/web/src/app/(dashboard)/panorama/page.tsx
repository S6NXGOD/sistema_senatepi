'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Swords, Layers, Loader2, Inbox, ArrowRight, Scale, TrendingUp, TrendingDown,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { AbasDoAcervo } from '@/components/processos/abas-do-acervo';
import {
  carregarPanorama, LEITURA, resumoDesfechos, tendencia,
  type Concentracao, type Desfechos, type Dispersao, type PorAno,
} from '@/lib/panorama';

/**
 * PANORAMA DO ACERVO — o que só aparece olhando os processos juntos.
 *
 * Cada advogado cuida do seu processo e faz isso bem. Ninguém tem por ofício
 * somar o acervo e perguntar "isto aqui é o mesmo problema sete vezes?". Era o
 * caso da Unimed em 04/09/2026: sete ações individuais, todas ganhas ao menos
 * em parte, repartidas entre advogados diferentes — invisível para cada um
 * deles, óbvio no conjunto.
 *
 * A TELA NÃO MANDA FAZER NADA. Ela conta o que existe e nomeia a decisão que
 * aquele padrão costuma informar. Estratégia processual é ofício de quem lê.
 */

const TOM = {
  alerta: {
    borda: 'border-l-amber-500',
    selo: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  },
  favoravel: {
    borda: 'border-l-emerald-500',
    selo: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  },
  neutro: {
    borda: 'border-l-brand-500',
    selo: 'bg-brand-100 text-brand-800 dark:bg-brand-950/40 dark:text-brand-300',
  },
} as const;

export default function PanoramaPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['panorama'],
    queryFn: carregarPanorama,
  });

  const vazio = !!data && !data.concentracoes.length && !data.dispersoes.length;

  return (
    <div className="space-y-5 p-4 pb-24 md:p-6">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold md:text-2xl">
          <Scale className="h-5 w-5 text-brand-700 dark:text-brand-400" />
          Panorama do acervo
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          O que aparece quando os processos são somados em vez de lidos um a um. São contagens
          do próprio acervo e desfechos carimbados pelo tribunal — a leitura jurídica é sua.
        </p>
      </header>

      <AbasDoAcervo atual="panorama" />

      {isLoading && (
        <p className="flex items-center gap-2 py-10 text-center text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Somando o acervo…
        </p>
      )}

      {isError && (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          Não foi possível montar o panorama agora.
        </Card>
      )}

      {vazio && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          <Inbox className="mx-auto mb-2 h-6 w-6 opacity-60" />
          Nenhum padrão no acervo ativo — nenhum réu responde três vezes pelo mesmo pedido, e
          nenhum pedido se repete contra cinco empregadores. Não é falta de dado: é o acervo
          não ter concentração.
        </Card>
      )}

      {!!data?.concentracoes.length && (
        <section className="space-y-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Swords className="h-4 w-4 text-brand-700 dark:text-brand-400" />
              O mesmo réu, o mesmo pedido
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Empregadores que respondem a três ou mais ações do acervo repetindo os mesmos
              pedidos.
            </p>
          </div>
          {data.concentracoes.map((c) => (
            <CartaoConcentracao key={c.parteExternaId} c={c} />
          ))}
        </section>
      )}

      {!!data?.dispersoes.length && (
        <section className="space-y-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Layers className="h-4 w-4 text-brand-700 dark:text-brand-400" />
              O mesmo pedido, muitos réus
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Aqui o padrão não é de um empregador — é da categoria. Costuma ser assunto de
              cláusula em convenção ou de ação normativa, e não de mais uma ação por empresa.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {data.dispersoes.map((d) => (
              <CartaoDispersao key={d.assunto} d={d} />
            ))}
          </div>
        </section>
      )}

      {!!data && (
        <p className="pt-1 text-[11px] leading-snug text-muted-foreground">
          {data.acervoAtivo} processos ativos. Um processo trata de vários assuntos, então ele
          aparece em mais de um bloco — os números não somam o acervo. Os nomes dos pedidos são
          os que o tribunal registrou.
        </p>
      )}
    </div>
  );
}

function CartaoConcentracao({ c }: { c: Concentracao }) {
  // A leitura mais forte define a cor da borda; as demais entram como selo.
  const principal = LEITURA[c.leituras[0]];

  return (
    <Card className={cn('border-l-4 p-4', TOM[principal.tom].borda)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-base font-semibold">{c.adversario}</h3>
        <Link
          href={`/processos?parteExternaId=${c.parteExternaId}`}
          className="inline-flex items-center gap-1 text-xs font-medium text-brand-800 hover:underline dark:text-brand-300"
        >
          Ver os {c.processos} processos <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      <p className="mt-0.5 text-xs text-muted-foreground">
        {c.processos} ações ativas
        {c.individuais > 0 && <> · {c.individuais} individuais</>}
      </p>

      <BarraDeDesfechos d={c} />

      {/*
        OS PEDIDOS SÃO O CORAÇÃO DO CARTÃO. "Cinco ações contra a Hapvida" o
        painel já dizia; o que faz disto um padrão é as cinco pedirem a mesma
        coisa.
      */}
      <ul className="mt-2.5 flex flex-wrap gap-1.5">
        {c.pedidos.map((p) => (
          <li
            key={p.assunto}
            className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px]"
          >
            {p.assunto}
            <span className="ml-1 font-semibold text-muted-foreground">{p.processos}×</span>
          </li>
        ))}
      </ul>

      <div className="mt-3 space-y-2 border-t pt-2.5">
        {c.leituras.map((slug) => {
          const l = LEITURA[slug];
          return (
            <div key={slug}>
              <p className="flex flex-wrap items-center gap-1.5">
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                    TOM[l.tom].selo,
                  )}
                >
                  {l.titulo}
                </span>
              </p>
              <p className="mt-1 text-xs leading-snug text-muted-foreground">{l.explicacao}</p>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function CartaoDispersao({ d }: { d: Dispersao }) {
  const rumo = tendencia(d.porAno);
  return (
    <Card className="flex h-full flex-col p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold leading-snug">{d.assunto}</h3>
        {/*
          A TENDÊNCIA SÓ FALA QUANDO HÁ O QUE DIZER — compara dois anos fechados
          com os dois anteriores e cala quando a variação é pequena. Uma seta em
          todo cartão viraria enfeite.
        */}
        {rumo && (
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
              rumo === 'CRESCENDO'
                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                : 'bg-muted text-muted-foreground',
            )}
            title="Comparação dos dois últimos anos fechados com os dois anteriores"
          >
            {rumo === 'CRESCENDO' ? (
              <TrendingUp className="h-3 w-3" />
            ) : (
              <TrendingDown className="h-3 w-3" />
            )}
            {rumo === 'CRESCENDO' ? 'crescendo' : 'diminuindo'}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        <strong className="text-foreground">{d.processos}</strong> processos contra{' '}
        <strong className="text-foreground">{d.adversarios}</strong> empregadores diferentes
        {d.individuais > 0 && <> · {d.individuais} individuais</>}
      </p>

      <BarraDeDesfechos d={d} />
      <ColunasPorAno serie={d.porAno} />

      <div className="mt-auto pt-2.5">
        <Link
          href={`/processos?assunto=${encodeURIComponent(d.assunto)}`}
          className="inline-flex items-center gap-1 text-xs font-medium text-brand-800 hover:underline dark:text-brand-300"
        >
          Ver na listagem <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </Card>
  );
}

/**
 * OS DESFECHOS COMO BARRA — e não como mais uma frase.
 *
 * "7 já julgadas: 7 procedentes em parte" está certo e ninguém lê. A mesma
 * informação em uma faixa de três cores se entende antes de ler: o olho vê a
 * proporção, e o número continua ali para quem quiser conferir.
 *
 * Improcedente é ÂMBAR, não vermelho. Perder um pedido é resultado normal de
 * litígio, não erro do escritório — vermelho aqui acusaria alguém.
 */
function BarraDeDesfechos({ d }: { d: Desfechos }) {
  if (!d.julgados) return null;
  const faixas = [
    { n: d.procedentes, cor: 'bg-emerald-600', nome: 'procedentes' },
    { n: d.parciais, cor: 'bg-teal-500', nome: 'procedentes em parte' },
    { n: d.improcedentes, cor: 'bg-amber-500', nome: 'improcedentes' },
  ].filter((f) => f.n > 0);

  return (
    <div className="mt-2">
      <div
        className="flex h-2 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={resumoDesfechos(d) ?? ''}
      >
        {faixas.map((f) => (
          <div
            key={f.nome}
            className={f.cor}
            style={{ width: `${(f.n / d.julgados) * 100}%` }}
            title={`${f.n} ${f.nome}`}
          />
        ))}
      </div>
      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        {faixas.map((f) => (
          <span key={f.nome} className="inline-flex items-center gap-1">
            <span className={cn('h-2 w-2 rounded-full', f.cor)} aria-hidden />
            {f.n} {f.nome}
          </span>
        ))}
      </p>
    </div>
  );
}

/**
 * AÇÕES POR ANO — colunas de `div`, sem biblioteca de gráfico.
 *
 * São cinco barras. Carregar um motor de gráfico para desenhar cinco retângulos
 * custaria mais que a informação vale, e traria eixos, grade e tooltip que
 * ninguém pediu. O ano corrente aparece esmaecido: ele ainda não terminou, e
 * comparar um ano pela metade com anos fechados é comparar coisas diferentes.
 */
function ColunasPorAno({ serie }: { serie: PorAno[] }) {
  if (serie.length < 2) return null;
  const maior = Math.max(...serie.map((a) => a.processos), 1);
  const anoCorrente = new Date().getFullYear();

  return (
    <div className="mt-3">
      <div className="flex h-12 items-end gap-1">
        {serie.map((a) => (
          <div key={a.ano} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-[10px] leading-none text-muted-foreground">
              {a.processos || ''}
            </span>
            <div
              className={cn(
                'w-full rounded-sm',
                a.ano === anoCorrente ? 'bg-brand-300 dark:bg-brand-800' : 'bg-brand-600',
              )}
              // 2px de piso: o ano zerado precisa ocupar espaço para se ver que
              // ele existiu e não teve nada — sumir contaria outra história.
              style={{ height: `${Math.max((a.processos / maior) * 100, 4)}%` }}
              title={`${a.ano}: ${a.processos}`}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1">
        {serie.map((a) => (
          <span
            key={a.ano}
            className="flex-1 text-center text-[10px] tabular-nums text-muted-foreground"
          >
            {String(a.ano).slice(2)}
          </span>
        ))}
      </div>
    </div>
  );
}
