'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  Newspaper, Search, Loader2, Inbox, ChevronLeft, ChevronRight, Bot, Gavel, X,
  SlidersHorizontal, ChevronDown, Info,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Carregando, Esqueleto, EsqueletoLinhas } from '@/components/ui/esqueleto';
import { FalhaAoCarregar } from '@/components/falha-ao-carregar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AbasDoAcervo } from '@/components/processos/abas-do-acervo';
import {
  buscarPublicacoes, facetasPublicacoes, statusDjen, semAtoNoDiario, type SemAtoNoDiario as SemAto,
  PROVIDENCIA_LABEL, PROVIDENCIA_COR, PROVIDENCIA_COR_PADRAO, type FiltroPublicacoes,
} from '@/lib/djen';
import { agruparPublicacoes } from '@/lib/publicacoes-irmas';
import { PublicacaoDjenCard } from '@/components/processos/publicacao-djen-card';
import {
  listarAdvogadosDisponiveis, formatNPU } from '@/lib/processos';
import { STATUS_LABEL, type StatusCompromisso } from '@/lib/agenda';
import { useAuth } from '@/lib/auth';
import { useFiltroPorUrl } from '@/lib/use-abrir-por-url';

/**
 * O ACERVO DE PUBLICAÇÕES, PROCURÁVEL.
 *
 * Em 03/09/2026 havia 136 publicações guardadas e 14 tinham virado atividade.
 * As outras 122 existiam no banco e não existiam na prática: só se chegava
 * nelas abrindo o processo certo e rolando a aba certa. Esta tela é o caminho
 * que faltava — e é também a resposta à pergunta "dá para achar um ato pelo
 * nome da parte?": pela API do CNJ, não (o parâmetro existe e é ignorado pelo
 * servidor deles); aqui, sim, porque a parte vem dentro de cada publicação.
 */

/** Rótulos curtos para as etiquetas de filtro ativo. */
const ONDE_LABEL: Record<string, string> = {
  TUDO: 'tudo', AUTOR: 'autor', REU: 'réu', NUMERO: 'nº do processo', TEOR: 'teor',
};
const SITUACAO_LABEL: Record<string, string> = {
  COM_TAREFA: 'Já virou tarefa',
  SEM_TAREFA: 'Sem tarefa na agenda',
  SEM_DECISAO: 'Esperando decisão',
};

/**
 * AS JANELAS DE DATA — as que alguém pede de verdade.
 *
 * "O que chegou esta semana" é a pergunta de segunda-feira; trinta e noventa
 * dias servem a quem confere se algo passou. Data livre não entrou: quem procura
 * um ato específico procura pelo número ou pela parte.
 */
const JANELAS: { dias: number; texto: string }[] = [
  { dias: 7, texto: 'Últimos 7 dias' },
  { dias: 30, texto: 'Últimos 30 dias' },
  { dias: 90, texto: 'Últimos 90 dias' },
];

const inputCls =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ' +
  'ring-offset-background focus-visible:ring-2 focus-visible:ring-ring';

/**
 * `useSearchParams` (dos links `?dias=7` e `?situacao=`) obriga a um limite de
 * Suspense — sem ele o build do Next falha ao pré-renderizar a rota. Mesmo
 * padrão da lista de processos.
 */
/**
 * OS PROCESSOS EM QUE O DIÁRIO NUNCA TROUXE NADA (25/09/2026).
 *
 * "Será se o DJEN está deixando alguém de fora?" — a pergunta do dono. Medido
 * contra a produção, a resposta é sim, mas não onde se procurava:
 *
 *  · POR OAB não deixa ninguém de fora. Dos 157 processos vivos, ZERO estão
 *    sem advogado com OAB consultável na equipe.
 *  · POR PROCESSO deixa 8. Três com história longa — um com 319 movimentações
 *    desde 2016 e nenhuma publicação. O histórico deles no Diário foi lido e
 *    voltou vazio.
 *
 * NÃO É ALARME, e por isso não é âmbar: não há defeito a consertar. Nem todo
 * tribunal manda tudo para o DJEN. É ESTADO — o recado é "para estes, não
 * confie só nesta tela", e ele vale igual amanhã e no mês que vem.
 *
 * ZERO NÃO VIRA LINHA. Bloco vazio dizendo "nenhum" é ruído todo dia para
 * avisar de nada; quando some, a ausência já é a resposta.
 */
function SemAtoNoDiario({ dados }: { dados?: SemAto }) {
  const [aberto, setAberto] = useState(false);
  if (!dados?.total) return null;
  const { total, exemplos } = dados;

  return (
    <div className="rounded-xl border border-input bg-muted/40 text-sm text-muted-foreground">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition hover:brightness-[0.98]"
      >
        <span className="flex min-w-0 items-start gap-2.5">
          <Info className="mt-0.5 h-4 w-4 shrink-0 opacity-70" />
          <span className="min-w-0">
            <strong className="text-foreground">
              {total === 1
                ? '1 processo em acompanhamento nunca recebeu ato pelo Diário'
                : `${total} processos em acompanhamento nunca receberam ato pelo Diário`}
            </strong>
            . O histórico {total === 1 ? 'dele' : 'deles'} já foi lido e voltou vazio — nem
            todo tribunal publica tudo no DJEN. Nesses casos, confira o portal antes de
            confiar só nesta tela.
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-0.5 pt-0.5 text-xs font-semibold opacity-80">
          {aberto ? 'Ocultar' : 'Ver quais'}
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', aberto && 'rotate-180')} />
        </span>
      </button>

      {aberto && (
        <ul className="border-t border-input">
          {exemplos.map((e) => (
            <li key={e.processoId}>
              <Link
                href={`/processos?processo=${e.processoId}`}
                className="flex flex-col gap-0.5 border-t border-input/60 px-4 py-2.5 first:border-t-0 transition hover:bg-muted sm:flex-row sm:items-center sm:gap-3"
              >
                {/*
                  O NÚMERO INTEIRO, inclusive em 400px: é o que alguém copia
                  para conferir no portal do tribunal. Lado a lado com a
                  contagem ele truncava em "0856490-91.2026.8.18.0…".
                */}
                <span className="min-w-0 flex-1 font-mono text-xs font-semibold text-foreground">
                  {e.numeroCNJ ? formatNPU(e.numeroCNJ) : 'Sem número'}
                </span>
                {/*
                  A CONTAGEM DE ANDAMENTOS É O QUE SEPARA OS DOIS CASOS: zero
                  publicações num processo cadastrado ontem é normal; num com
                  319 andamentos, o Diário simplesmente não é a via dele.
                */}
                <span className="shrink-0 text-xs opacity-80">
                  {e.movimentacoes} {e.movimentacoes === 1 ? 'andamento' : 'andamentos'} no DataJud
                </span>
              </Link>
            </li>
          ))}
          {total > exemplos.length && (
            <li className="border-t border-input/60 px-4 py-2 text-xs opacity-70">
              e mais {total - exemplos.length} — os com mais andamento vêm primeiro.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

export default function PublicacoesPage() {
  return (
    <Suspense
      fallback={<Carregando texto="Carregando as publicações…"><EsqueletoLinhas quantidade={6} altura={96} /></Carregando>}
    >
      <Publicacoes />
    </Suspense>
  );
}

type SituacaoDaPublicacao = 'COM_TAREFA' | 'SEM_TAREFA' | 'SEM_DECISAO';

function Publicacoes() {
  const [termo, setTermo] = useState('');
  const [busca, setBusca] = useState('');
  const [providencia, setProvidencia] = useState('');
  const [tribunal, setTribunal] = useState('');
  const [situacao, setSituacao] = useState<'' | SituacaoDaPublicacao>('');
  const [onde, setOnde] = useState<'TUDO' | 'AUTOR' | 'REU' | 'NUMERO' | 'TEOR'>('TUDO');
  /**
   * QUEM FOI INTIMADO NO ATO — e não de quem é o processo.
   *
   * `soMeus` filtra pelo ACERVO (a tabela de vínculo). Este filtra por CITAÇÃO:
   * o nome do advogado está na publicação. São perguntas diferentes e as
   * respostas divergem — medido em 07/09/2026, a Dra. Jaqueline tinha 0
   * publicações pelo acervo e 4 que a citavam. O prazo corre para quem foi
   * intimado.
   */
  const [citaAdvogado, setCitaAdvogado] = useState('');
  const [pagina, setPagina] = useState(1);
  /*
    NO CELULAR OS FILTROS COMEÇAM FECHADOS.

    Somados, o seletor de escopo, a busca, os cinco botões de "procurar em" e os
    quatro selects ocupavam a tela inteira do telefone: rolava-se um aparelho
    inteiro de controles antes da primeira publicação. Quem abre esta tela quer
    LER as publicações; filtrar é o segundo gesto, não o primeiro.

    No desktop continuam abertos (`lg:` ignora este estado): lá o espaço existe
    e escondê-los só acrescentaria um clique.
  */
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  /** Janela por data de disponibilização; vazio é "qualquer data". */
  const [dias, setDias] = useState('');

  /*
    OS LINKS DE FORA CHEGAM FILTRADOS.

    O painel manda `?dias=7` ("18 em 7 dias") e o relatório manda
    `?situacao=SEM_DECISAO` ("esperando decisão"). Sem ler a URL, os dois
    atalhos abririam o acervo inteiro — o tipo de link quebrado de que ninguém
    desconfia. Valor desconhecido é ignorado.
  */
  useFiltroPorUrl(
    'dias',
    (v) => {
      if (JANELAS.some((j) => String(j.dias) === v)) {
        setDias(v);
        setPagina(1);
      }
    },
    '/publicacoes',
  );
  useFiltroPorUrl(
    'situacao',
    (v) => {
      // `hasOwn`, e não `in`: `in` sobe no protótipo, e `?situacao=toString`
      // passaria como filtro válido e voltaria da API como erro 400.
      if (Object.prototype.hasOwnProperty.call(SITUACAO_LABEL, v)) {
        setSituacao(v as SituacaoDaPublicacao);
        setPagina(1);
      }
    },
    '/publicacoes',
  );

  /**
   * O ADVOGADO ABRE NA PRÓPRIA CARTEIRA.
   *
   * Nove advogados dividem o acervo, e o padrão "tudo" faria cada um chegar
   * numa lista em que oito de cada nove linhas não são dele. Quem coordena
   * abre no global, que é o trabalho dele. Os dois trocam num clique.
   */
  const { user } = useAuth();
  const [soMeus, setSoMeus] = useState(false);
  const [escopoDefinido, setEscopoDefinido] = useState(false);
  useEffect(() => {
    if (escopoDefinido || !user) return;
    setSoMeus(user.role === 'ADVOGADO');
    setEscopoDefinido(true);
  }, [user, escopoDefinido]);

  // Digitar não dispara requisição a cada tecla: 400ms é o intervalo em que a
  // pessoa termina de escrever uma palavra.
  useEffect(() => {
    const t = setTimeout(() => {
      setBusca(termo.trim());
      setPagina(1);
    }, 400);
    return () => clearTimeout(t);
  }, [termo]);

  const { data: status } = useQuery({ queryKey: ['djen-status'], queryFn: statusDjen });

  /* A MESMA chave de cache do painel de filtros e do cartão de publicação: uma
     requisição serve as três telas. */
  const advogados = useQuery({
    queryKey: ['processos', 'advogados-disponiveis'],
    queryFn: listarAdvogadosDisponiveis,
    staleTime: 5 * 60_000,
  });
  const ligado = status?.ativo !== false;

  const { data: facetas } = useQuery({
    queryKey: ['djen-facetas'],
    queryFn: facetasPublicacoes,
    enabled: ligado,
  });

  /*
    ONDE O DIÁRIO NUNCA TROUXE NADA. Meia hora de cache: é um retrato do
    acervo, muda quando uma publicação nova casa com um processo — de noite.
  */
  const { data: semAto } = useQuery({
    queryKey: ['djen-sem-ato'],
    queryFn: semAtoNoDiario,
    enabled: ligado,
    staleTime: 30 * 60_000,
    retry: false,
  });

  const filtro: FiltroPublicacoes = useMemo(
    () => ({
      q: busca || undefined,
      providencia: providencia || undefined,
      tribunal: tribunal || undefined,
      situacao: situacao || undefined,
      onde,
      meus: soMeus ? ('true' as const) : undefined,
      citaAdvogado: citaAdvogado || undefined,
      dias: dias ? Number(dias) : undefined,
      pagina,
    }),
    // `dias` na lista: filtro fora das dependências é ficha que aparece com a
    // lista parada — a consulta nem sabe que ele mudou.
    [busca, providencia, tribunal, situacao, onde, soMeus, citaAdvogado, dias, pagina],
  );

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['djen-busca', filtro],
    queryFn: () => buscarPublicacoes(filtro),
    enabled: ligado,
    // Trocar de página sem piscar a lista inteira em branco.
    placeholderData: keepPreviousData,
  });

  /*
    O CARTÃO PRECISA DAS PARTES ACHATADAS.
    A API devolve `processo.partes`; o cartão é o mesmo componente usado dentro
    do processo, onde essa informação não existe. Achatar aqui mantém o cartão
    sem saber de onde veio o dado.
  */
  const grupos = useMemo(
    () =>
      agruparPublicacoes(
        (data?.itens ?? []).map((p) => ({ ...p, partesDoProcesso: p.processo?.partes ?? null })),
      ),
    [data],
  );
  /*
    O FILTRO DE ADVOGADO FICAVA PRESO — e em silêncio.

    `citaAdvogado` não entrava nem em `temFiltro` nem em `limpar()`: escolher
    "Intimou Dra. Shérad" e depois clicar em "Limpar filtros" devolvia a lista
    ainda filtrada por ela, com o botão de limpar já sumido. A pessoa concluía
    que o acervo tinha 4 publicações.

    A lista de filtros ativos abaixo é a defesa estrutural contra isso voltar:
    filtro que não aparece como etiqueta é filtro que ninguém sabe que aplicou.
  */
  const ativos: { chave: string; texto: string; limpar: () => void }[] = [
    busca && { chave: 'q', texto: `"${busca}"`, limpar: () => setTermo('') },
    onde !== 'TUDO' && {
      chave: 'onde',
      texto: `Procurando em ${ONDE_LABEL[onde]}`,
      limpar: () => setOnde('TUDO'),
    },
    providencia && {
      chave: 'prov',
      texto: PROVIDENCIA_LABEL[providencia] ?? providencia,
      limpar: () => setProvidencia(''),
    },
    tribunal && { chave: 'trib', texto: tribunal, limpar: () => setTribunal('') },
    situacao && { chave: 'sit', texto: SITUACAO_LABEL[situacao], limpar: () => setSituacao('') },
    dias && {
      chave: 'dias',
      texto: JANELAS.find((j) => String(j.dias) === dias)?.texto ?? `Últimos ${dias} dias`,
      limpar: () => setDias(''),
    },
    citaAdvogado && {
      chave: 'adv',
      texto: `Intimou ${
        (advogados.data ?? []).find((a) => a.id === citaAdvogado)?.nomeExibicao ??
        (advogados.data ?? []).find((a) => a.id === citaAdvogado)?.nome ??
        'advogado'
      }`,
      limpar: () => setCitaAdvogado(''),
    },
  ].filter(Boolean) as { chave: string; texto: string; limpar: () => void }[];

  const temFiltro = ativos.length > 0;

  function limpar() {
    setTermo('');
    setBusca('');
    setProvidencia('');
    setTribunal('');
    setSituacao('');
    setCitaAdvogado('');
    setDias('');
    setOnde('TUDO');
    setPagina(1);
  }

  if (status && !status.ativo) {
    return (
      <div className="mx-auto max-w-2xl p-4">
        <Card className="p-8 text-center">
          <Newspaper className="mx-auto mb-3 h-8 w-8 text-muted-foreground/60" />
          <h1 className="mb-1 text-lg font-semibold">Publicações do DJEN</h1>
          <p className="text-sm text-muted-foreground">
            A integração com o Diário de Justiça Eletrônico Nacional está desligada nesta
            instalação.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 pb-24 md:p-6">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold md:text-2xl">
          <Newspaper className="h-5 w-5 text-brand-700 dark:text-brand-400" />
          Publicações
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Intimações, despachos, decisões e sentenças que o DJEN publicou nos processos do
          acervo — de qualquer tribunal do país.
        </p>
      </header>

      <AbasDoAcervo atual="publicacoes" />

      {/*
        DOIS BOTÕES, NÃO UM SELETOR: são dois modos de trabalho, não um filtro
        entre muitos. No celular ocupam a linha inteira e o alvo do dedo é o
        botão todo.
      */}
      <div className="flex rounded-lg border p-0.5">
        {[
          { valor: true, texto: 'Meus processos' },
          { valor: false, texto: 'Todo o acervo' },
        ].map((op) => (
          <button
            key={String(op.valor)}
            type="button"
            onClick={() => {
              setSoMeus(op.valor);
              setPagina(1);
            }}
            aria-pressed={soMeus === op.valor}
            className={cn(
              'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition',
              soMeus === op.valor
                ? 'bg-brand-700 text-white dark:bg-brand-600'
                : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {op.texto}
          </button>
        ))}
      </div>

      {/*
        A BUSCA É O CONTROLE PRINCIPAL: campo largo, primeiro, sozinho na linha
        no celular. Os filtros são refinamento e vêm abaixo, em uma coluna no
        telefone e três no desktop.
      */}
      <Card className="space-y-3 p-3 md:p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder="Parte, advogado, OAB, número do processo ou trecho do teor"
            className={cn(inputCls, 'pl-9 pr-9')}
            aria-label="Buscar publicações"
          />
          {termo && (
            <button
              type="button"
              onClick={() => setTermo('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted"
              aria-label="Limpar busca"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/*
          O BOTÃO QUE ABRE OS FILTROS — só no celular, e com o número de ativos.

          Sem o número, fechar os filtros esconderia o motivo de a lista estar
          curta, e a pessoa não teria como saber que há algo aplicado. Com ele,
          fechado continua sendo honesto.
        */}
        <button
          type="button"
          onClick={() => setFiltrosAbertos((v) => !v)}
          aria-expanded={filtrosAbertos}
          className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input px-3 text-sm font-medium transition hover:bg-muted lg:hidden"
        >
          <span className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
            Filtros
            {ativos.length > 0 && (
              <span className="rounded-full bg-brand-700 px-1.5 text-[10px] font-bold leading-[18px] text-white dark:bg-brand-600">
                {ativos.length}
              </span>
            )}
          </span>
          <ChevronDown
            className={cn('h-4 w-4 text-muted-foreground transition-transform', filtrosAbertos && 'rotate-180')}
          />
        </button>

        <div className={cn('space-y-3', !filtrosAbertos && 'hidden lg:block')}>
        {/*
          ONDE PROCURAR — colado no campo, porque muda o SENTIDO do que foi
          digitado, e não a lista. "Hapvida" em Réu é "processos contra a
          Hapvida"; em Tudo, é qualquer publicação que a mencione, inclusive no
          meio do teor. Longe do campo de texto, ninguém liga uma coisa à outra.
        */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="shrink-0 text-muted-foreground">Procurar em</span>
          <div className="flex flex-wrap gap-0.5 rounded-md border p-0.5">
            {([
              { valor: 'TUDO', texto: 'Tudo' },
              { valor: 'AUTOR', texto: 'Autor' },
              { valor: 'REU', texto: 'Réu' },
              { valor: 'NUMERO', texto: 'Nº do processo' },
              { valor: 'TEOR', texto: 'Teor' },
            ] as const).map((op) => (
              <button
                key={op.valor}
                type="button"
                onClick={() => {
                  setOnde(op.valor);
                  setPagina(1);
                }}
                aria-pressed={onde === op.valor}
                className={cn(
                  'rounded px-2.5 py-1 font-medium transition',
                  onde === op.valor
                    ? 'bg-brand-700 text-white dark:bg-brand-600'
                    : 'text-muted-foreground hover:bg-muted',
                )}
              >
                {op.texto}
              </button>
            ))}
          </div>
        </div>

        {/*
          CINCO FILTROS. O de advogado foi o primeiro que faltou: POR ADVOGADO
          CITADO. A busca livre já achava por nome ou OAB, mas exigia saber e
          digitar. A pergunta real — "o que intimou a Dra. Shérad?" — é de
          escolher, não de escrever. E é por CITAÇÃO, não por acervo: o prazo
          corre para quem foi intimado, e as duas listas divergem muito (a Dra.
          Jaqueline tinha 0 pelo acervo e 4 que a citavam).

          E A DATA, que entrou por último e vem primeiro: "o que chegou esta
          semana" é a pergunta mais comum desta tela, e não tinha como ser feita
          — o link "18 em 7 dias" do painel abria as 2.066 publicações do acervo.

          Select nativo, uma coluna no celular: ele abre a roda do sistema, e não
          um menu que ninguém consegue rolar.
        */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <select
            value={dias}
            onChange={(e) => {
              setDias(e.target.value);
              setPagina(1);
            }}
            className={inputCls}
            aria-label="Filtrar por data"
          >
            <option value="">Qualquer data</option>
            {JANELAS.map((j) => (
              <option key={j.dias} value={String(j.dias)}>
                {j.texto}
              </option>
            ))}
          </select>

          <select
            value={providencia}
            onChange={(e) => {
              setProvidencia(e.target.value);
              setPagina(1);
            }}
            className={inputCls}
            aria-label="Filtrar por providência"
          >
            <option value="">Toda providência</option>
            {(facetas?.providencias ?? []).map((p) => (
              <option key={p.slug} value={p.slug}>
                {PROVIDENCIA_LABEL[p.slug] ?? p.slug} ({p.total})
              </option>
            ))}
          </select>

          <select
            value={tribunal}
            onChange={(e) => {
              setTribunal(e.target.value);
              setPagina(1);
            }}
            className={inputCls}
            aria-label="Filtrar por tribunal"
          >
            <option value="">Todo tribunal</option>
            {(facetas?.tribunais ?? []).map((t) => (
              <option key={t.sigla} value={t.sigla}>
                {t.sigla} ({t.total})
              </option>
            ))}
          </select>

          <select
            value={situacao}
            onChange={(e) => {
              setSituacao(e.target.value as '' | SituacaoDaPublicacao);
              setPagina(1);
            }}
            className={inputCls}
            aria-label="Filtrar por situação"
          >
            <option value="">Com ou sem tarefa</option>
            <option value="COM_TAREFA">Já virou tarefa</option>
            <option value="SEM_TAREFA">Sem tarefa na agenda</option>
            {/* "Sem tarefa" junta o que o robô dispensou com motivo; esta opção é só a fila. */}
            <option value="SEM_DECISAO">Esperando decisão</option>
          </select>

          <select
            value={citaAdvogado}
            onChange={(e) => {
              setCitaAdvogado(e.target.value);
              setPagina(1);
            }}
            className={inputCls}
            aria-label="Filtrar por advogado citado no ato"
          >
            <option value="">Qualquer advogado</option>
            {(advogados.data ?? [])
              // Sem OAB no cadastro não há como casar — oferecer a opção daria
              // sempre zero, e um filtro que só sabe dar zero é uma armadilha.
              .filter((a) => a.oab)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  Intimou {a.nomeExibicao || a.nome}
                </option>
              ))}
          </select>
        </div>

        </div>

        {/*
          O QUE ESTÁ APLICADO, EM ETIQUETAS — e cada uma sai sozinha.

          Antes só havia "Limpar filtros", tudo ou nada: para trocar o tribunal
          mantendo a providência era preciso reencontrar o select certo entre
          quatro. E, no celular com os filtros fechados, nada dizia o que estava
          filtrando. Fica FORA do bloco colapsável de propósito.
        */}
        {ativos.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {ativos.map((f) => (
              <button
                key={f.chave}
                type="button"
                onClick={() => {
                  f.limpar();
                  setPagina(1);
                }}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-brand-200 bg-brand-50 py-1 pl-2.5 pr-1.5 text-xs font-medium text-brand-900 transition hover:bg-brand-100 dark:border-brand-800 dark:bg-brand-950/40 dark:text-brand-200 dark:hover:bg-brand-900/40"
              >
                <span className="truncate">{f.texto}</span>
                <X className="h-3 w-3 shrink-0 opacity-70" />
              </button>
            ))}
            {ativos.length > 1 && (
              <button
                type="button"
                onClick={limpar}
                className="px-1.5 text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
              >
                Limpar tudo
              </button>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {/*
              O PLURAL ENTRE PARÊNTESES é jeito de programador escapar da
              escolha. A tela sabe o número; decidir a palavra custa um ternário.

              (O comentário não escreve a forma antiga de propósito: o teste
              proíbe aquela string, e citá-la aqui reprovaria o arquivo já
              corrigido — armadilha em que este projeto já caiu três vezes.)
            */}
            {isLoading
              ? 'Procurando…'
              : `${(data?.total ?? 0).toLocaleString('pt-BR')} ${
                  (data?.total ?? 0) === 1 ? 'publicação' : 'publicações'
                }`}
            {isFetching && !isLoading && <Loader2 className="ml-1.5 inline h-3 w-3 animate-spin" />}
          </span>
        </div>
      </Card>

      {/*
        COLADA À CONTAGEM, E NÃO NO TOPO DA TELA.

        A pergunta que ela responde é "esta lista é tudo?", e essa pergunta
        nasce ao lado do "14 publicações" — não antes de a pessoa ver o que
        veio. No topo ela empurrava o trabalho para fora da dobra do celular
        para dar um recado que é contexto, não tarefa.
      */}
      <SemAtoNoDiario dados={semAto} />

      {isError ? (
        <Card className="p-2">
          <FalhaAoCarregar erro={error} oQue="as publicações" onTentarDeNovo={() => refetch()} />
        </Card>
      ) : isLoading ? (
        <Carregando texto="Carregando as publicações…" className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-xl border bg-card p-4">
              <Esqueleto className="h-3.5 w-2/5" />
              <Esqueleto className="mt-3 h-3 w-4/5" />
              <Esqueleto className="mt-2 h-3 w-1/3" />
            </div>
          ))}
        </Carregando>
      ) : grupos.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          <Inbox className="mx-auto mb-2 h-6 w-6 opacity-60" />
          {temFiltro
            ? 'Nada encontrado com esses filtros.'
            : soMeus
              ? 'Nenhuma publicação nos seus processos. Veja todo o acervo para as dos colegas.'
              : 'Nenhuma publicação no acervo ainda. A varredura roda todo dia às 5h.'}
        </Card>
      ) : (
        <ul className="space-y-2">
          {grupos.map((grupo) => (
            <PublicacaoDjenCard
              key={grupo.principal.id}
              como="li"
              grupo={grupo}
              className="border-l-4 border-l-indigo-400"
              chips={
                <>
                  {grupo.principal.providencia && PROVIDENCIA_LABEL[grupo.principal.providencia] && (
                    <span
                      className={cn(
                        // 11px e semibold: é O campo que responde "o que eu
                        // tenho de fazer aqui?" numa lista de 1.420 atos, e
                        // estava do mesmo tamanho e peso da sigla do tribunal.
                        'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                        PROVIDENCIA_COR[grupo.principal.providencia] ?? PROVIDENCIA_COR_PADRAO,
                      )}
                    >
                      {PROVIDENCIA_LABEL[grupo.principal.providencia]}
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground/70">
                    {grupo.principal.siglaTribunal}
                  </span>
                </>
              }
              acoes={
                <>
                  {grupo.principal.processo && (
                    <Link
                      href={`/processos?processo=${grupo.principal.processo.id}`}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-800 underline-offset-2 hover:underline dark:text-brand-300"
                    >
                      <Gavel className="h-3 w-3" />
                      {formatNPU(grupo.principal.processo.numeroCNJ ?? '') || 'Ver processo'}
                    </Link>
                  )}
                  {grupo.principal.compromisso && (
                    <Link
                      href={`/agenda?compromisso=${grupo.principal.compromisso.id}`}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-800 underline-offset-2 hover:underline dark:text-brand-300"
                    >
                      <Bot className="h-3 w-3" />
                      {grupo.principal.compromisso.titulo}
                      <span className="text-muted-foreground">
                        {' · '}
                        {STATUS_LABEL[grupo.principal.compromisso.status as StatusCompromisso] ??
                          grupo.principal.compromisso.status}
                      </span>
                    </Link>
                  )}
                </>
              }
            />
          ))}
        </ul>
      )}

      {(data?.paginas ?? 1) > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={pagina <= 1}
            onClick={() => setPagina((p) => p - 1)}
          >
            <ChevronLeft className="h-4 w-4" /> Anterior
          </Button>
          <span className="text-xs text-muted-foreground">
            {data?.pagina} de {data?.paginas}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={pagina >= (data?.paginas ?? 1)}
            onClick={() => setPagina((p) => p + 1)}
          >
            Próxima <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
