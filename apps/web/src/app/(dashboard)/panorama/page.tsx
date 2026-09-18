'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Swords, Layers, Inbox, ArrowRight, Clock, Scale, TrendingUp, TrendingDown, Download,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Carregando, Esqueleto, EsqueletoCartoes } from '@/components/ui/esqueleto';
import { FalhaAoCarregar } from '@/components/falha-ao-carregar';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { AbasDoAcervo } from '@/components/processos/abas-do-acervo';
import { PdfDoPanorama } from '@/components/processos/pdf-do-panorama';
import { tenant } from '@/tenant.config';
import {
  carregarPanorama, desfechosParaLer, duracaoEmPalavras, julgadasNoHistorico, LEITURA,
  ressalvaDoRecurso, resumoDesfechos,
  rotuloDoAno, tendencia,
  type Concentracao, type Desfechos, type Dispersao, type Historico, type NossoPapel,
  type PorAno,
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
  const { user } = useAuth();
  const [pdfAberto, setPdfAberto] = useState(false);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['panorama'],
    queryFn: carregarPanorama,
  });

  const vazio = !!data && !data.concentracoes.length && !data.dispersoes.length;
  const anoCorrente = new Date().getFullYear();

  return (
    <div className="space-y-5 p-4 pb-24 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-semibold md:text-2xl">
            <Scale className="h-5 w-5 text-brand-700 dark:text-brand-400" />
            Panorama do acervo
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            O que aparece quando os processos são somados em vez de lidos um a um. São contagens
            do próprio acervo e desfechos carimbados pelo tribunal — a leitura jurídica é sua.
          </p>
        </div>
        {/*
          O PAPEL IMPRIME O QUE A TELA JÁ MOSTRA — sem rota nova e sem permissão
          própria: o dado já está no navegador de quem vê a tela.
        */}
        <Button
          variant="outline"
          onClick={() => setPdfAberto(true)}
          disabled={!data}
          className="w-full sm:w-auto"
        >
          <Download className="h-4 w-4" /> Baixar PDF
        </Button>
      </header>

      <AbasDoAcervo atual="panorama" />

      {/* A forma do que vai aparecer: três cartões de papel e dois cartões de réu. */}
      {isLoading && (
        <Carregando texto="Somando o acervo…" className="space-y-5">
          <EsqueletoCartoes quantidade={3} className="grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-3" />
          <div className="space-y-3" aria-hidden="true">
            {[0, 1].map((i) => (
              <div key={i} className="rounded-xl border border-l-4 bg-card p-4">
                <Esqueleto className="h-4 w-56 max-w-full" />
                <Esqueleto className="mt-2 h-3 w-40 max-w-full" />
                <Esqueleto className="mt-3 h-2 w-full rounded-full" />
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Esqueleto className="h-5 w-44 max-w-full rounded-full" />
                  <Esqueleto className="h-5 w-28 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        </Carregando>
      )}

      {isError && (
        <Card>
          <FalhaAoCarregar erro={error} oQue="o panorama" onTentarDeNovo={() => refetch()} />
        </Card>
      )}

      {vazio && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          <Inbox className="mx-auto mb-2 h-6 w-6 opacity-60" />
          Nenhum padrão no acervo ativo — nenhum réu responde três vezes pelo mesmo pedido, e
          nenhum pedido se repete contra cinco réus diferentes. Não é falta de dado: é o acervo
          não ter concentração.
        </Card>
      )}

      {/*
        DE QUE LADO ESTAMOS — a leitura que não existia em lugar nenhum.

        O acervo é lido o tempo todo por réu e por pedido, e nunca pelo PAPEL da
        própria entidade. Medido: autor em 93, patrono do filiado em 31, réu em
        3. A do meio é a que se esquece e é a segunda maior — "processo do
        sindicato" e "processo que o sindicato conduz" são coisas diferentes, e
        a diferença muda quem responde por ele.

        Cada número leva à lista já filtrada, então isto é leitura E porta de
        entrada: o filtro existe no painel, mas ninguém abre painel de filtro
        para descobrir uma pergunta que ainda não fez.
      */}
      {!!data?.nossoPapel && (
        <section className="space-y-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Scale className="h-4 w-4 text-brand-700 dark:text-brand-400" />
              De que lado estamos
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              O papel do {tenant.sigla} em cada processo ativo. Clique para ver a lista.
            </p>
          </div>
          {/*
            O LINK LEVA O MESMO RECORTE QUE O CARTÃO CONTOU. Sem `status=ATIVO`
            a lista trazia também os encerrados, e o número mudava na chegada.
          */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <CartaoPapel
              titulo={`${tenant.sigla} é o autor`}
              valor={data.nossoPapel.autor}
              nota="Ação movida pela entidade em nome próprio ou da categoria."
              href="/processos?nossoPapel=AUTOR&status=ATIVO"
            />
            <CartaoPapel
              titulo="Representamos o filiado"
              valor={data.nossoPapel.representando}
              nota="A parte é o filiado; a entidade não figura em polo nenhum."
              href="/processos?nossoPapel=REPRESENTANDO&status=ATIVO"
            />
            <CartaoPapel
              titulo={`${tenant.sigla} é réu`}
              valor={data.nossoPapel.reu}
              nota="Ação contra a entidade — responde ela, não o filiado."
              href="/processos?nossoPapel=REU&status=ATIVO"
            />
          </div>
          <ContaQueNaoFecha papel={data.nossoPapel} acervoAtivo={data.acervoAtivo} />
        </section>
      )}

      {!!data?.concentracoes.length && (
        <section className="space-y-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Swords className="h-4 w-4 text-brand-700 dark:text-brand-400" />
              O mesmo réu, o mesmo pedido
            </h2>
            {/*
              "PARTES CONTRÁRIAS", e não "empregadores": numa ação contra o sindicato o
              adversário é quem o processa, e nem todo réu é empregador.
            */}
            <p className="mt-0.5 text-xs text-muted-foreground">
              Partes contrárias com três ou mais ações ativas repetindo os mesmos pedidos. Os
              desfechos contam todas as ações ajuizadas contra cada uma.
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
              Aqui o padrão não é de um réu — é da categoria: o mesmo pedido aparece em seis ou
              mais ações ativas, contra cinco ou mais partes contrárias diferentes.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {data.dispersoes.map((d) => (
              <CartaoDispersao key={d.assunto} d={d} anoCorrente={anoCorrente} />
            ))}
          </div>
        </section>
      )}

      {!!data && (
        <p className="pt-1 text-[11px] leading-snug text-muted-foreground">
          {data.acervoAtivo} processos ativos. Um processo trata de vários assuntos, então ele
          aparece em mais de um bloco — os números não se somam. Os nomes dos pedidos são os que
          o tribunal registrou. O desfecho é a última sentença registrada, e sentença não é
          resultado final: recurso julgado depois pode mudá-lo.
        </p>
      )}

      {data && pdfAberto && (
        <PdfDoPanorama
          panorama={data}
          emitidoPor={user?.nomeExibicao || user?.nome || tenant.sigla}
          onFechar={() => setPdfAberto(false)}
        />
      )}
    </div>
  );
}

/**
 * Um papel e o quanto ele pesa. Zero aparece — "nunca fomos processados" é uma
 * informação, e esconder faria a ausência do cartão significar duas coisas
 * (não há, ou não carregou).
 */
/**
 * OS TRÊS CARTÕES NÃO COBREM O ACERVO, E A TELA NÃO DIZIA (18/09/2026).
 *
 * O rodapé anuncia "161 processos ativos" logo abaixo de três cartões somando
 * 155. Quem confere encontra um buraco de seis e nenhuma explicação — e a
 * explicação é boa: são processos ATIVOS sem parte nenhuma cadastrada, em que
 * não dá para afirmar o lado. Forçá-los para dentro de um cartão seria pior
 * que o buraco; dizer que existem é trabalho de cadastro à vista.
 *
 * E a conta pode fechar por cima: o sindicato nos DOIS polos (reconvenção) é
 * contado em autor e em réu. Aí a soma passa do acervo, e a frase muda.
 *
 * A linha só nasce quando há o que dizer. Com o acervo redondo, ela não
 * aparece — bloco vazio vira uma linha, e linha sem conteúdo vira nada.
 */
function ContaQueNaoFecha({
  papel,
  acervoAtivo,
}: {
  papel: NossoPapel;
  acervoAtivo: number;
}) {
  // A API velha não manda os dois campos: na janela de troca a linha cala em
  // vez de inventar diferença. Ver `senatepi-deploy-janela-de-troca`.
  if (papel.semPartes === undefined || papel.ambosOsPolos === undefined) return null;
  const { semPartes, ambosOsPolos } = papel;
  if (!semPartes && !ambosOsPolos) return null;

  return (
    <p className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-muted-foreground">
      {semPartes > 0 && (
        <span>
          <Link
            href="/processos?semPartes=true&status=ATIVO"
            className="font-medium text-foreground underline-offset-2 hover:underline"
          >
            {semPartes === 1 ? '1 processo ativo' : `${semPartes} processos ativos`}
          </Link>{' '}
          {semPartes === 1 ? 'não tem' : 'não têm'} parte nenhuma cadastrada — sem elas não dá
          para dizer o lado, e {semPartes === 1 ? 'ele fica' : 'eles ficam'} fora dos três
          cartões.
        </span>
      )}
      {ambosOsPolos > 0 && (
        <span>
          {ambosOsPolos === 1
            ? 'Em 1 deles o sindicato está nos dois polos, e ele aparece em autor e em réu.'
            : `Em ${ambosOsPolos} deles o sindicato está nos dois polos, e aparecem em autor e em réu.`}
        </span>
      )}
      <span className="opacity-70">Ao todo, {acervoAtivo.toLocaleString('pt-BR')} ativos.</span>
    </p>
  );
}
function CartaoPapel({
  titulo, valor, nota, href,
}: {
  titulo: string;
  valor: number;
  nota: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-xl border bg-card p-4 transition hover:border-brand-400"
    >
      <p className="text-2xl font-bold tabular-nums">{valor}</p>
      <p className="mt-0.5 text-sm font-medium">{titulo}</p>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{nota}</p>
    </Link>
  );
}

function CartaoConcentracao({ c }: { c: Concentracao }) {
  // A leitura mais forte define a cor da borda; as demais entram como selo.
  const principal = LEITURA[c.leituras[0]];
  const julgadas = julgadasNoHistorico(c);

  return (
    <Card className={cn('border-l-4 p-4', TOM[principal.tom].borda)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-base font-semibold">{c.adversario}</h3>
        {/* `status=ATIVO`: o cartão conta o acervo ativo, e a lista tem de contar igual. */}
        <Link
          href={`/processos?parteExternaId=${c.parteExternaId}&status=ATIVO`}
          className="inline-flex items-center gap-1 text-xs font-medium text-brand-800 hover:underline dark:text-brand-300"
        >
          Ver os {c.processos} processos <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {/*
        DUAS PERGUNTAS NA MESMA LINHA, sem misturar: quantas estão em curso (é o
        que o link abre) e como as ajuizadas têm sido julgadas (é o que a barra
        desenha).
      */}
      <p className="mt-0.5 text-xs text-muted-foreground">
        {c.processos} {c.processos === 1 ? 'ativa' : 'ativas'}
        {c.individuais > 0 && <> ({c.individuais} {c.individuais === 1 ? 'individual' : 'individuais'})</>}
        {julgadas && <> · {julgadas}</>}
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

function CartaoDispersao({ d, anoCorrente }: { d: Dispersao; anoCorrente: number }) {
  const rumo = tendencia(d.porAno, anoCorrente);
  const julgadas = julgadasNoHistorico(d);
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
        <strong className="text-foreground">{d.processos}</strong>{' '}
        {d.processos === 1 ? 'ativa' : 'ativas'} contra{' '}
        <strong className="text-foreground">{d.adversarios}</strong>{' '}
        {d.adversarios === 1 ? 'parte contrária' : 'partes contrárias diferentes'}
        {d.individuais > 0 && (
          <> · {d.individuais} {d.individuais === 1 ? 'individual' : 'individuais'}</>
        )}
        {julgadas && <> · {julgadas}</>}
      </p>

      <BarraDeDesfechos d={d} />
      {d.porAno.length >= 2 && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          {d.historico ? 'Ações ajuizadas por ano, inclusive as já encerradas' : 'Ações ativas por ano'}
        </p>
      )}
      <ColunasPorAno serie={d.porAno} />

      <div className="mt-auto pt-2.5">
        <Link
          href={`/processos?assunto=${encodeURIComponent(d.assunto)}&status=ATIVO`}
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
 *
 * A BARRA DESENHA O HISTÓRICO — todas as ações ajuizadas, inclusive as que já
 * saíram do ativo (decidido é justamente o que sai). E diz quantas tiveram
 * recurso julgado depois: a sentença não é o resultado final, e em 12/09/2026
 * eram 49 dos 109 processos ativos julgados.
 */
function BarraDeDesfechos({
  d,
}: {
  d: Desfechos & { historico?: Historico | null; medianaDias?: number | null };
}) {
  const h = desfechosParaLer(d);
  if (!h.julgados) return null;
  /*
    "1 PROCEDENTES" (18/09/2026). A legenda colava o número num rótulo fixo no
    plural. `resumoDesfechos` e `ressalvaDoRecurso` já flexionavam; esta lista,
    escrita depois, não — e a tela mostrava "1 procedentes em parte" em todo
    réu com um julgado só.
  */
  const faixas = [
    { n: h.procedentes, cor: 'bg-emerald-600', um: 'procedente', varios: 'procedentes' },
    { n: h.parciais, cor: 'bg-teal-500', um: 'procedente em parte', varios: 'procedentes em parte' },
    { n: h.improcedentes, cor: 'bg-amber-500', um: 'improcedente', varios: 'improcedentes' },
  ]
    .filter((f) => f.n > 0)
    .map((f) => ({ ...f, nome: f.n === 1 ? f.um : f.varios }));
  const ressalva = ressalvaDoRecurso(h);
  const duracao = duracaoEmPalavras(d.medianaDias);

  return (
    <div className="mt-2">
      <div
        className="flex h-2 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={resumoDesfechos(h) ?? ''}
      >
        {/* Cresce uma vez, na montagem: revalidar a consulta não desmonta a barra. */}
        <div className="flex h-full w-full animate-crescer-x">
          {faixas.map((f) => (
            <div
              key={f.nome}
              className={f.cor}
              style={{ width: `${(f.n / h.julgados) * 100}%` }}
              title={`${f.n} ${f.nome}`}
            />
          ))}
        </div>
      </div>
      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        {faixas.map((f) => (
          <span key={f.nome} className="inline-flex items-center gap-1">
            <span className={cn('h-2 w-2 rounded-full', f.cor)} aria-hidden />
            {f.n} {f.nome}
          </span>
        ))}
      </p>
      {ressalva && (
        <p className="mt-1 text-[11px] leading-snug text-amber-800 dark:text-amber-300">
          {ressalva}.
        </p>
      )}
      {/*
        QUANTO TEMPO ATÉ A SENTENÇA (18/09/2026). A tela contava quantas e como
        foram julgadas, nunca em quanto tempo — e é o número que o filiado pede
        na porta e a diretoria pede na reunião. Cala com menos de três julgados.
      */}
      {duracao && (
        <p className="mt-1 flex items-start gap-1 text-[11px] leading-snug text-muted-foreground">
          <Clock className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
          <span>
            Da distribuição à sentença, <strong className="font-medium">{duracao}</strong>.
          </span>
        </p>
      )}
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
function ColunasPorAno({
  serie,
  anoCorrente = new Date().getFullYear(),
}: {
  serie: PorAno[];
  anoCorrente?: number;
}) {
  if (serie.length < 2) return null;
  const maior = Math.max(...serie.map((a) => a.processos), 1);

  return (
    <div className="mt-3">
      <div
        className="flex h-12 items-end gap-1"
        role="img"
        aria-label={serie.map((a) => `${rotuloDoAno(a.ano, anoCorrente)}: ${a.processos}`).join(', ')}
      >
        {serie.map((a) => (
          <div key={a.ano} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
            <span className="text-[10px] leading-none text-muted-foreground">
              {a.processos || ''}
            </span>
            <div
              className={cn(
                'w-full animate-crescer-y rounded-sm',
                a.ano === anoCorrente ? 'bg-brand-300 dark:bg-brand-800' : 'bg-brand-600',
              )}
              // 2px de piso: o ano zerado precisa ocupar espaço para se ver que
              // ele existiu e não teve nada — sumir contaria outra história.
              style={{ height: `${Math.max((a.processos / maior) * 100, 4)}%` }}
              title={`${rotuloDoAno(a.ano, anoCorrente)}: ${a.processos}`}
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
