'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  Newspaper, Search, Loader2, Inbox, ChevronLeft, ChevronRight, Bot, Gavel, X,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AbasDoAcervo } from '@/components/processos/abas-do-acervo';
import {
  buscarPublicacoes, facetasPublicacoes, statusDjen,
  PROVIDENCIA_LABEL, type FiltroPublicacoes,
} from '@/lib/djen';
import { agruparPublicacoes } from '@/lib/publicacoes-irmas';
import { PublicacaoDjenCard } from '@/components/processos/publicacao-djen-card';
import { formatNPU } from '@/lib/processos';
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

const inputCls =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ' +
  'ring-offset-background focus-visible:ring-2 focus-visible:ring-ring';

export default function PublicacoesPage() {
  const [termo, setTermo] = useState('');
  const [busca, setBusca] = useState('');
  const [providencia, setProvidencia] = useState('');
  const [tribunal, setTribunal] = useState('');
  const [situacao, setSituacao] = useState<'' | 'COM_TAREFA' | 'SEM_TAREFA'>('');
  const [pagina, setPagina] = useState(1);

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
      meus: soMeus ? ('true' as const) : undefined,
      pagina,
    }),
    [busca, providencia, tribunal, situacao, soMeus, pagina],
  );

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['djen-busca', filtro],
    queryFn: () => buscarPublicacoes(filtro),
    enabled: ligado,
    // Trocar de página sem piscar a lista inteira em branco.
    placeholderData: keepPreviousData,
  });

  const grupos = useMemo(() => agruparPublicacoes(data?.itens ?? []), [data]);
  const temFiltro = !!(busca || providencia || tribunal || situacao);

  function limpar() {
    setTermo('');
    setBusca('');
    setProvidencia('');
    setTribunal('');
    setSituacao('');
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

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
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
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {isLoading
              ? 'Procurando…'
              : `${(data?.total ?? 0).toLocaleString('pt-BR')} publicação(ões)`}
            {isFetching && !isLoading && <Loader2 className="ml-1.5 inline h-3 w-3 animate-spin" />}
          </span>
          {temFiltro && (
            <button
              type="button"
              onClick={limpar}
              className="font-medium text-brand-800 hover:underline dark:text-brand-300"
            >
              Limpar filtros
            </button>
          )}
        </div>
      </Card>

      {isLoading ? (
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
                    <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium">
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
