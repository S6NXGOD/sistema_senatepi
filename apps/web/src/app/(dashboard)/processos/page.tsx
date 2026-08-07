'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Gavel, Plus, Search, Loader2, ChevronLeft, ChevronRight, User, Landmark, FileWarning,
  AlertTriangle, Swords, FileCheck2, AlarmClock, Scale,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { ImportarProcessoDialog } from '@/components/processos/importar-processo-dialog';
import { ProcessoDetalheSheet } from '@/components/processos/processo-detalhe-sheet';
import { FormalizarRascunhoModal } from '@/components/processos/formalizar-rascunho-modal';
import { AudienciasAgendarPanel } from '@/components/processos/audiencias-agendar-panel';
import { useAuth } from '@/lib/auth';
import { podeEditar } from '@/lib/permissoes';
import {
  listarProcessos, formatNPU, ProcessoLista, StatusProcesso, FaseProcessual, FASE_LABEL,
  STATUS_PROCESSO_COR, STATUS_PROCESSO_LABEL, STATUS_PROCESSO_ORDEM, reavaliarInstancias,
} from '@/lib/processos';
import { rotuloGrau, siglaGrau } from '@/lib/movimentacoes';
import { dataBr, desde } from '@/lib/dossie';
import { useAbrirPorUrl, useFiltroPorUrl } from '@/lib/use-abrir-por-url';

const inputCls = 'h-12 rounded-md border border-input bg-background px-3 text-base md:h-10 md:text-sm';

function StatusBadge({ status }: { status: StatusProcesso }) {
  return (
    <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium', STATUS_PROCESSO_COR[status])}>
      {STATUS_PROCESSO_LABEL[status]}
    </span>
  );
}

/**
 * `useSearchParams` obriga a um limite de Suspense — sem ele o build do Next
 * falha ao pré-renderizar a rota. Mesmo padrão do wizard de cobranças.
 */
export default function ProcessosPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-senatepi-800 dark:text-senatepi-400" /></div>}>
      <ListaProcessos />
    </Suspense>
  );
}

function ListaProcessos() {
  const qc = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  // O painel age nos dois módulos (resolve o alerta e cria o evento na agenda).
  const podeRadar =
    podeEditar(user?.role, user?.permissoes, 'processos') &&
    podeEditar(user?.role, user?.permissoes, 'agenda');
  const [busca, setBusca] = useState('');
  const [buscaDeb, setBuscaDeb] = useState('');
  const [status, setStatus] = useState<'' | StatusProcesso>('');
  /**
   * Fase processual. Separada do status de propósito: status é a nossa leitura
   * interna ("Ativo", "Encerrado"), fase é o que o tribunal está fazendo com o
   * processo. Misturar os dois num seletor só foi o que fez "encerrado" parecer
   * sinônimo de "arquivado" — e um processo em execução ser dado como morto.
   */
  const [fase, setFase] = useState<'' | FaseProcessual>('');
  /** Filtro rápido da tabela (chips). */
  const [rapido, setRapido] = useState<
    'todos' | 'meus' | 'rascunhos' | 'semFiliado' | 'semReu' | 'recentes'
  >('todos');
  /**
   * Janela do filtro "com movimentação recente".
   *
   * 7 dias é a semana de trabalho — o que andou desde a última vez que alguém
   * olhou. 15 dias existe porque processo trabalhista costuma andar em blocos:
   * numa semana morta, o filtro de 7 devolve lista vazia e passa a impressão
   * errada de que nada acontece.
   */
  const [janelaRecente, setJanelaRecente] = useState<'7' | '15'>('7');
  const [page, setPage] = useState(1);

  const [importOpen, setImportOpen] = useState(false);
  const [detalheId, setDetalheId] = useState<string | null>(null);
  /** Rascunho escolhido para formalizar (vindo de um desfecho da agenda). */
  const [formalizar, setFormalizar] = useState<ProcessoLista | null>(null);

  /**
   * `?processo=<id>` abre a ficha direto.
   *
   * É o que faz um link de fora desta tela chegar em algum lugar: o aviso de
   * recusa do CNJ, na home, apontava para `/processos` puro e o clique não
   * mudava nada na tela — a pessoa caía na lista inteira e tinha que procurar
   * o processo na mão. O parâmetro sai da URL assim que a ficha abre, para
   * que fechar a ficha não deixe a URL mentindo sobre o que está aberto.
   */
  useAbrirPorUrl('processo', setDetalheId, '/processos');

  /**
   * `?rascunhos=1` aplica o filtro rápido.
   *
   * O sistema JÁ gerava este link — o aviso "rascunho criado", ao concluir uma
   * atividade, oferece "Abrir Processos" e manda para cá com o parâmetro. A
   * tela o ignorava e mostrava a lista completa: o atalho parecia funcionar e
   * não fazia nada, que é pior que não existir, porque ninguém desconfia.
   */
  useFiltroPorUrl('rascunhos', () => setRapido('rascunhos'), '/processos');

  useEffect(() => {
    const t = setTimeout(() => {
      setBuscaDeb(busca.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [busca]);

  /**
   * RELEITURA DAS INSTÂNCIAS, uma vez por sessão.
   *
   * O parser que enxerga todos os graus é novo; o acervo já cadastrado foi lido
   * pelo antigo e mostraria um grau só até a varredura das 02:00. Abrir a lista
   * dispara a releitura do que falta e, ao terminar, as badges se atualizam
   * sozinhas.
   *
   * TRÊS FREIOS, porque isto conversa com o CNJ:
   *  · a API só relê processo SEM carimbo — cada um é lido uma vez, nunca mais;
   *  · uma vez por sessão do navegador, mesmo com a lista sendo reaberta;
   *  · só para quem pode editar (a rota exige permissão de escrita; para os
   *    demais a chamada voltaria 403 e viraria um erro sem sentido na tela).
   */
  const [reavaliando, setReavaliando] = useState(false);
  useEffect(() => {
    if (!podeRadar || typeof window === 'undefined') return;
    /**
     * O freio de sessão vale só para a parte CARA (falar com o CNJ). O
     * alinhamento de status é banco puro e roda toda vez que a lista abre —
     * antes, ele ficava atrás do mesmo freio, e um processo corrigido por
     * migração seguia exibindo "Ativo" ao lado de "Arquivado" porque a sessão
     * já tinha gasto sua releitura.
     */
    const jaReleu = !!window.sessionStorage.getItem('senatepi:instancias-reavaliadas');
    window.sessionStorage.setItem('senatepi:instancias-reavaliadas', '1');

    let vivo = true;
    if (!jaReleu) setReavaliando(true);
    reavaliarInstancias(jaReleu ? 0 : 10)
      .then((r) => {
        if (!vivo) return;
        // Só invalida se algo mudou — recarregar a lista à toa é piscada de tela.
        if (r.reavaliados > 0 || r.desalinhados > 0) qc.invalidateQueries({ queryKey: ['processos'] });
      })
      // Silêncio no erro de propósito: isto é melhoria de fundo. A lista já está
      // na tela com o que havia, e a varredura noturna cobre o que falhar —
      // avisar sobre uma tarefa que ninguém pediu só assusta.
      .catch(() => undefined)
      .finally(() => { if (vivo) setReavaliando(false); });
    return () => { vivo = false; };
  }, [podeRadar, qc]);

  const filtro = useMemo(
    () => ({
      busca: buscaDeb || undefined,
      statusInterno: status || undefined,
      // Filtros rápidos (mutuamente exclusivos).
      ...(rapido === 'meus' ? { meus: 'true' as const } : {}),
      ...(rapido === 'rascunhos' ? { statusInterno: 'RASCUNHO' as const } : {}),
      ...(rapido === 'semFiliado' ? { semFiliado: 'true' as const } : {}),
      ...(rapido === 'semReu' ? { semParteContraria: 'true' as const } : {}),
      ...(rapido === 'recentes' ? { movimentacaoRecente: janelaRecente } : {}),
      ...(fase ? { fase } : {}),
      page,
      pageSize: 20,
    }),
    [buscaDeb, status, fase, rapido, janelaRecente, page],
  );

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['processos', buscaDeb, status, fase, rapido, janelaRecente, page],
    queryFn: () => listarProcessos(filtro),
  });
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPaginas = data?.totalPaginas ?? 1;

  const invalidar = () => qc.invalidateQueries({ queryKey: ['processos'] });

  function abrirDetalhe(id: string) {
    setDetalheId(id);
  }

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-senatepi-50 dark:bg-senatepi-900/30">
            <Gavel className="h-5 w-5 text-senatepi-800 dark:text-senatepi-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">Processos</h2>
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              Acompanhamento processual · DATAJUD (CNJ)
              {reavaliando && (
                <span className="inline-flex items-center gap-1 text-xs text-senatepi-800 dark:text-senatepi-400">
                  <Loader2 className="h-3 w-3 animate-spin" /> atualizando instâncias…
                </span>
              )}
            </p>
          </div>
        </div>
        <Button onClick={() => setImportOpen(true)}>
          <Plus className="h-4 w-4" /> Importar Processo
        </Button>
      </div>

      {/* Audiências detectadas no DataJud que ainda não estão na agenda */}
      {podeRadar && <AudienciasAgendarPanel onVerProcesso={(id) => abrirDetalhe(id)} />}

      {/* Filtros rápidos */}
      <div className="flex flex-wrap gap-1.5">
        {([
          { k: 'todos', label: 'Todos' },
          { k: 'meus', label: 'Meus processos' },
          // Fila de formalização: os rascunhos abertos por desfechos da agenda.
          { k: 'rascunhos', label: 'Rascunhos a formalizar' },
          { k: 'semFiliado', label: 'Sem filiado vinculado' },
          // Fila de trabalho: o DataJud nunca preenche o réu, então esta lista
          // é a única forma de fechar o cadastro das partes.
          { k: 'semReu', label: 'Sem réu cadastrado' },
          { k: 'recentes', label: 'Com movimentação recente' },
        ] as const).map((f) => (
          <button
            key={f.k}
            type="button"
            onClick={() => { setRapido(f.k); setPage(1); }}
            className={cn(
              'rounded-full px-3 py-1.5 text-sm font-medium transition',
              rapido === f.k
                ? 'bg-senatepi-800 text-white shadow-sm'
                : 'bg-muted text-muted-foreground hover:text-foreground',
            )}
          >
            {f.label}
          </button>
        ))}
        {/* A janela só aparece com o filtro ligado: fora dele, dois botões de
            "7/15 dias" soltos na barra não significam nada. */}
        {rapido === 'recentes' && (
          <span className="flex items-center gap-1 rounded-full bg-muted px-1 py-1">
            {(['7', '15'] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => { setJanelaRecente(d); setPage(1); }}
                className={cn(
                  'rounded-full px-2.5 py-0.5 text-xs font-semibold transition',
                  janelaRecente === d
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {d} dias
              </button>
            ))}
          </span>
        )}
      </div>

      {/* Filtros */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por NPU, filiado, classe…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          {isFetching && (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>
        <select
          className={cn(inputCls, 'sm:w-48')}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as '' | StatusProcesso);
            setPage(1);
          }}
        >
          <option value="">Todos os status</option>
          {STATUS_PROCESSO_ORDEM.map((s) => (
            <option key={s} value={s}>
              {STATUS_PROCESSO_LABEL[s]}
            </option>
          ))}
        </select>
        <select
          className={cn(inputCls, 'sm:w-48')}
          value={fase}
          onChange={(e) => {
            setFase(e.target.value as '' | FaseProcessual);
            setPage(1);
          }}
        >
          <option value="">Todas as fases</option>
          {(['CONHECIMENTO', 'EXECUCAO', 'RECURSAL', 'ARQUIVADO'] as const).map((f) => (
            <option key={f} value={f}>
              {FASE_LABEL[f]}
            </option>
          ))}
        </select>
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 py-16 text-center">
          <FileWarning className="h-8 w-8 text-muted-foreground opacity-60" />
          <div>
            <p className="font-medium">Nenhum processo encontrado</p>
            <p className="text-sm text-muted-foreground">
              Importe um processo pelo número (NPU) para começar o acompanhamento.
            </p>
          </div>
          <Button onClick={() => setImportOpen(true)}>
            <Plus className="h-4 w-4" /> Importar Processo
          </Button>
        </Card>
      ) : (
        <>
          {/* Mobile: cards */}
          <div className="space-y-3 md:hidden">
            {items.map((p) => (
              <ProcessoCard key={p.id} p={p} onClick={() => abrirDetalhe(p.id)} />
            ))}
          </div>

          {/* Desktop: tabela */}
          <Card className="hidden overflow-hidden p-0 md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Processo (NPU)</th>
                    {/* Quem processou quem — a informação que se procura primeiro */}
                    <th className="px-4 py-3 font-medium">Partes</th>
                    <th className="px-4 py-3 font-medium">Classe</th>
                    <th className="px-4 py-3 font-medium">Tribunal / Instâncias</th>
                    {/* A contagem de movimentações ("203") não dizia nada sobre
                        o processo: o que se quer saber, batendo o olho, é se ele
                        andou, quando, e o quê. */}
                    <th className="px-4 py-3 font-medium">Última movimentação</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map((p) => (
                    <tr
                      key={p.id}
                      onClick={() => abrirDetalhe(p.id)}
                      className="cursor-pointer transition-colors hover:bg-muted/40"
                    >
                      <td className="px-4 py-3">
                        {p.numeroCNJ ? (
                          <span className="font-mono text-[13px] font-medium">{formatNPU(p.numeroCNJ)}</span>
                        ) : (
                          // Rascunho ainda não tem número: mostra o rótulo e o
                          // convite para formalizar, em vez de uma linha vazia.
                          <span className="flex flex-col gap-1">
                            <span className="text-[13px] font-medium">{p.titulo || 'Rascunho sem título'}</span>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setFormalizar(p); }}
                              className="inline-flex w-fit items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700 transition hover:bg-violet-200 dark:bg-violet-900/40 dark:text-violet-300"
                            >
                              <FileCheck2 className="h-3 w-3" /> Formalizar
                            </button>
                          </span>
                        )}
                        <Etiquetas lista={p.etiquetas} fase={p.fase} />
                      </td>
                      <td className="max-w-[280px] px-4 py-3"><CelulaPartes p={p} /></td>
                      <td className="max-w-[220px] truncate px-4 py-3" title={p.classeProcessual ?? ''}>
                        {p.classeProcessual ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[13px]">{p.tribunal ?? '—'}</span>
                        <TagsInstancias instancias={p.instancias} />
                      </td>
                      <td className="max-w-[260px] px-4 py-3"><CelulaUltimaMov p={p} /></td>
                      <td className="px-4 py-3">
                        <StatusBadge status={p.statusInterno} />
                        <BadgeFase fase={p.fase} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Paginação */}
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {total} processo{total === 1 ? '' : 's'}
            </span>
            {totalPaginas > 1 && (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="tabular-nums">
                  {page} / {totalPaginas}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPaginas, p + 1))}
                  disabled={page >= totalPaginas}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Modal de importação */}
      <ImportarProcessoDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={(p) => {
          invalidar();
          abrirDetalhe(p.id);
        }}
      />

      {/* Gaveta de detalhes */}
      <ProcessoDetalheSheet
        processoId={detalheId}
        open={!!detalheId}
        onClose={() => setDetalheId(null)}
        onChanged={invalidar}
      />

      {/* Formalizar rascunho: informa o NPU e (opcionalmente) puxa do DataJud */}
      <FormalizarRascunhoModal
        processo={formalizar}
        open={!!formalizar}
        onClose={() => setFormalizar(null)}
        onFormalizado={invalidar}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Partes na listagem
// ---------------------------------------------------------------------------

/**
 * "Autor × Réu" numa célula. É a pergunta que se faz primeiro ao bater o olho
 * numa lista de processos — e a que o DataJud nunca responde, porque a API
 * Pública do CNJ não devolve as partes.
 */
/**
 * Selo da ação coletiva. Fica junto das partes de propósito: é ali que o olho
 * procura "quem move a ação", e num processo institucional a resposta é o
 * próprio sindicato — não a ausência de um filiado.
 */
function BadgeInstitucional({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center gap-1 rounded-full bg-senatepi-50 px-2 py-0.5 text-[10px] font-semibold text-senatepi-800 dark:bg-senatepi-900/40 dark:text-senatepi-300',
        className,
      )}
      title="Ação coletiva movida pelo SENATEPI em nome da categoria"
    >
      🏛️ Ação Institucional (SENATEPI)
    </span>
  );
}

/**
 * Uma etiqueta POR INSTÂNCIA, colorida pelo que importa: se aquele grau ainda
 * anda.
 *
 * O texto genérico anterior ("2 instâncias · 1 em andamento") obrigava a abrir a
 * ficha para saber QUAL delas anda — que é a única coisa que muda o trabalho do
 * dia. Verde = em andamento; cinza riscado = baixada. Com uma instância só, a
 * etiqueta aparece do mesmo jeito: é ela que diz se o processo está vivo, e a
 * linha ficaria muda justamente no caso mais comum.
 */
function TagsInstancias({ instancias }: { instancias?: ProcessoLista['instancias'] }) {
  if (!instancias?.length) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {instancias.map((i) => (
        <span
          key={`${i.tribunal}-${i.grau}`}
          title={`${rotuloGrau(i.grau)}${
            i.baixada
              ? ' — baixado (baixa definitiva ou trânsito em julgado, sem andamento posterior)'
              : ' — em andamento'
          }${i.principal ? ' · instância principal' : ''}`}
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
            i.baixada
              ? 'bg-muted text-muted-foreground line-through decoration-1'
              : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
          )}
        >
          {!i.baixada && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
          {siglaGrau(i.grau)}
        </span>
      ))}
    </span>
  );
}

/**
 * Fase processual, calculada pela API (instâncias vivas + atos de execução).
 *
 * Fica colada ao status porque as duas respondem coisas diferentes que sempre
 * se confundiram aqui: o status é a nossa leitura interna do processo; a fase é
 * o que o tribunal está de fato fazendo com ele.
 */
function BadgeFase({ fase }: { fase?: FaseProcessual }) {
  if (!fase) return null;
  const cor: Record<FaseProcessual, string> = {
    CONHECIMENTO: 'text-sky-700 dark:text-sky-400',
    EXECUCAO: 'text-emerald-700 dark:text-emerald-400',
    RECURSAL: 'text-violet-700 dark:text-violet-400',
    ARQUIVADO: 'text-muted-foreground',
  };
  return (
    <span className={cn('mt-1 block text-[10px] font-medium uppercase tracking-wide', cor[fase])}>
      {FASE_LABEL[fase]}
    </span>
  );
}

/**
 * Última movimentação: quando foi e o que foi.
 *
 * O alerta só aparece quando o ato AINDA NÃO virou tarefa na agenda — quem já
 * tem compromisso criado não precisa de aviso na lista, precisa de agenda. É a
 * API que classifica (dicionário de TPU conferido, `tpu.util.ts`); a tela só
 * pinta, para não existirem duas tabelas de códigos discordando com o tempo.
 */
function CelulaUltimaMov({ p }: { p: ProcessoLista }) {
  const ultima = p.movimentacoes?.[0];
  if (!ultima) {
    return <span className="text-xs text-muted-foreground">Sem movimentação</span>;
  }
  const texto = ultima.detalhe?.trim() || ultima.descricao;
  const alerta = p.alerta;
  return (
    <div className="min-w-0 leading-snug">
      <p className="flex items-center gap-1.5 text-[13px] font-medium tabular-nums">
        {dataBr(ultima.dataMovimento)}
        <span className="text-[11px] font-normal text-muted-foreground">{desde(ultima.dataMovimento)}</span>
      </p>
      <p className="truncate text-xs text-muted-foreground" title={texto}>
        {texto}
      </p>
      {alerta && (
        <span
          title={`${alerta.rotulo} — ainda sem tarefa na agenda`}
          className={cn(
            'mt-0.5 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
            alerta.nivel === 'PRAZO'
              ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
              : 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
          )}
        >
          {alerta.nivel === 'PRAZO' ? <AlarmClock className="h-3 w-3" /> : <Scale className="h-3 w-3" />}
          {alerta.nivel === 'PRAZO' ? 'Prazo sem tarefa' : 'Decisão a ler'}
        </span>
      )}
    </div>
  );
}

function CelulaPartes({ p }: { p: ProcessoLista }) {
  const { autor, reu, outrosAtivo, outrosPassivo } = p.confronto;
  const institucional = p.tipoAcao === 'INSTITUCIONAL';

  if (!autor && !reu) {
    return institucional ? (
      <BadgeInstitucional />
    ) : (
      <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
        <AlertTriangle className="h-3.5 w-3.5" /> Partes não cadastradas
      </span>
    );
  }
  return (
    <div className="min-w-0 text-sm leading-snug">
      {institucional && <BadgeInstitucional className="mb-0.5" />}
      <p className="truncate font-medium" title={autor?.nome}>
        {autor?.nome ?? <span className="font-normal text-muted-foreground">Autor não informado</span>}
        {outrosAtivo > 0 && <span className="text-xs font-normal text-muted-foreground"> +{outrosAtivo}</span>}
      </p>
      <p className="truncate text-xs text-muted-foreground" title={reu?.nome}>
        <span className="font-semibold uppercase tracking-wider">×</span>{' '}
        {reu ? (
          <>
            <span className="text-foreground">{reu.nome}</span>
            {outrosPassivo > 0 && ` +${outrosPassivo}`}
          </>
        ) : (
          <span className="text-amber-700 dark:text-amber-400">réu não cadastrado</span>
        )}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card (mobile)
// ---------------------------------------------------------------------------

function ProcessoCard({ p, onClick }: { p: ProcessoLista; onClick: () => void }) {
  return (
    <Card className="cursor-pointer p-4" onClick={onClick}>
      <div className="flex items-start justify-between gap-2">
        <p className={cn('text-sm font-semibold', p.numeroCNJ && 'font-mono')}>
          {p.numeroCNJ ? formatNPU(p.numeroCNJ) : p.titulo || 'Rascunho sem título'}
        </p>
        <Etiquetas lista={p.etiquetas} fase={p.fase} />
        <StatusBadge status={p.statusInterno} />
      </div>
      <div className="mt-2 space-y-1 text-sm">
        <div className="flex items-start gap-1.5 text-muted-foreground">
          <Swords className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <CelulaPartes p={p} />
        </div>
        {p.filiado && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <User className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{p.filiado.nomeCompleto}</span>
          </p>
        )}
        {p.classeProcessual && <p className="truncate text-muted-foreground">{p.classeProcessual}</p>}
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Landmark className="h-3.5 w-3.5" /> {p.tribunal ?? '—'}
          </span>
          <TagsInstancias instancias={p.instancias} />
        </p>
        {/* Mesma troca da tabela: a contagem de movimentações saiu, entrou a
            última — no celular, onde há menos espaço, ela vale ainda mais. */}
        <div className="border-t pt-1.5">
          <CelulaUltimaMov p={p} />
        </div>
      </div>
    </Card>
  );
}

/** Etiquetas internas do processo, compactas na listagem. */
/**
 * Etiqueta que CONTRADIZ o que o tribunal diz.
 *
 * "Fase de Execução" é rótulo escrito à mão (ou sugerido na importação) e não
 * envelhece sozinho: o processo é arquivado, sobe em recurso, e a etiqueta
 * continua ali. A fase da última coluna é derivada dos andamentos e se corrige
 * sozinha — então quando as duas discordam, é a etiqueta que está velha.
 *
 * Marcar em vez de esconder: a etiqueta é filtro do acervo, e quem procurar a
 * fila de execução precisa ver que aquele processo não pertence mais a ela — e
 * poder corrigir. Esconder deixaria o filtro mentindo em silêncio.
 */
function etiquetaConflitante(etiqueta: string, fase?: FaseProcessual): boolean {
  return etiqueta === 'Fase de Execução' && (fase === 'ARQUIVADO' || fase === 'RECURSAL');
}

function Etiquetas({ lista, fase }: { lista?: string[]; fase?: FaseProcessual }) {
  if (!lista?.length) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {lista.slice(0, 3).map((e) => (
        <span
          key={e}
          title={
            etiquetaConflitante(e, fase)
              ? `O processo está em fase ${FASE_LABEL[fase!].toLowerCase()} segundo os andamentos do tribunal — esta etiqueta ficou desatualizada.`
              : undefined
          }
          className={cn(
            'rounded-full px-1.5 py-0.5 text-[10px] font-medium',
            etiquetaConflitante(e, fase)
              ? 'bg-amber-100 text-amber-800 line-through decoration-amber-500 dark:bg-amber-900/40 dark:text-amber-300'
              : 'bg-senatepi-50 text-senatepi-800 dark:bg-senatepi-900/30 dark:text-senatepi-400',
          )}
        >
          {e}
        </span>
      ))}
      {lista.length > 3 && (
        <span className="text-[10px] text-muted-foreground">+{lista.length - 3}</span>
      )}
    </span>
  );
}
