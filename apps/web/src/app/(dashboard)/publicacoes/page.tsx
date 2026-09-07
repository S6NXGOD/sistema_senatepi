'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  Newspaper, Search, Loader2, Inbox, ChevronLeft, ChevronRight, Bot, Gavel, X,
  SlidersHorizontal, ChevronDown,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { FalhaAoCarregar } from '@/components/falha-ao-carregar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AbasDoAcervo } from '@/components/processos/abas-do-acervo';
import {
  buscarPublicacoes, facetasPublicacoes, statusDjen,
  PROVIDENCIA_LABEL, PROVIDENCIA_COR, PROVIDENCIA_COR_PADRAO, type FiltroPublicacoes,
} from '@/lib/djen';
import { agruparPublicacoes } from '@/lib/publicacoes-irmas';
import { PublicacaoDjenCard } from '@/components/processos/publicacao-djen-card';
import {
  listarAdvogadosDisponiveis, formatNPU } from '@/lib/processos';
import { STATUS_LABEL, type StatusCompromisso } from '@/lib/agenda';
import { useAuth } from '@/lib/auth';

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
  COM_TAREFA: 'Já virou tarefa', SEM_TAREFA: 'Sem tarefa na agenda',
};

const inputCls =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ' +
  'ring-offset-background focus-visible:ring-2 focus-visible:ring-ring';

export default function PublicacoesPage() {
  const [termo, setTermo] = useState('');
  const [busca, setBusca] = useState('');
  const [providencia, setProvidencia] = useState('');
  const [tribunal, setTribunal] = useState('');
  const [situacao, setSituacao] = useState<'' | 'COM_TAREFA' | 'SEM_TAREFA'>('');
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

  const filtro: FiltroPublicacoes = useMemo(
    () => ({
      q: busca || undefined,
      providencia: providencia || undefined,
      tribunal: tribunal || undefined,
      situacao: situacao || undefined,
      onde,
      meus: soMeus ? ('true' as const) : undefined,
      citaAdvogado: citaAdvogado || undefined,
      pagina,
    }),
    [busca, providencia, tribunal, situacao, onde, soMeus, citaAdvogado, pagina],
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
          QUATRO FILTROS, e o quarto é o que faltava: POR ADVOGADO CITADO.

          A busca livre já achava por nome ou OAB, mas exigia saber e digitar. A
          pergunta real — "o que intimou a Dra. Shérad?" — é de escolher, não de
          escrever. E é por CITAÇÃO, não por acervo: o prazo corre para quem foi
          intimado, e as duas listas divergem muito (a Dra. Jaqueline tinha 0
          pelo acervo e 4 que a citavam).

          Quatro colunas no desktop, uma no celular — select nativo, que no
          celular abre a roda do sistema e não um menu que ninguém consegue rolar.
        */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
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
              setSituacao(e.target.value as '' | 'COM_TAREFA' | 'SEM_TAREFA');
              setPagina(1);
            }}
            className={inputCls}
            aria-label="Filtrar por situação"
          >
            <option value="">Com ou sem tarefa</option>
            <option value="COM_TAREFA">Já virou tarefa</option>
            <option value="SEM_TAREFA">Sem tarefa na agenda</option>
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

      {isError ? (
        <Card className="p-2">
          <FalhaAoCarregar erro={error} oQue="as publicações" onTentarDeNovo={() => refetch()} />
        </Card>
      ) : isLoading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Carregando…</p>
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
