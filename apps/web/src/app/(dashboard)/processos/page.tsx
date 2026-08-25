'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Gavel, Plus, Search, Loader2, ChevronLeft, ChevronRight, User, Landmark, FileWarning,
  AlertTriangle, Swords, AlarmClock, Scale, Zap, CheckCircle2, Filter, Siren, Hourglass,
  ArrowUpDown,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { ImportarProcessoDialog } from '@/components/processos/importar-processo-dialog';
import { ProcessoDetalheSheet } from '@/components/processos/processo-detalhe-sheet';
import { AjuizarCasoModal } from '@/components/processos/ajuizar-caso-modal';
import { SeloUrgente } from '@/components/ui/selo-urgente';
import { SeloPreProcessual } from '@/components/ui/selo-pre-processual';
import { EquipeAvatares } from '@/components/ui/avatar-pessoa';
import { FiltroParteContraria } from '@/components/processos/filtro-parte-contraria';
import {
  BotaoFiltros, FichasDeFiltro, FILTROS_VAZIOS, PainelDeFiltros, contarFiltros,
  type FiltrosProcesso,
} from '@/components/processos/painel-de-filtros';
import type { ParteExterna } from '@/lib/partes';
import { AudienciasAgendarPanel } from '@/components/processos/audiencias-agendar-panel';
import { useAuth } from '@/lib/auth';
import { podeEditar } from '@/lib/permissoes';
import {
  listarProcessos, formatNPU, ProcessoLista, StatusProcesso, FaseProcessual, FASE_LABEL,
  STATUS_PROCESSO_COR, STATUS_PROCESSO_LABEL, STATUS_PROCESSO_ORDEM, reavaliarInstancias,
  contadoresProcessos, ORDENS_LABEL, type OrdemProcesso,
} from '@/lib/processos';
import { rotuloGrau, siglaGrau } from '@/lib/movimentacoes';
import { dataBr, desde } from '@/lib/dossie';
import { useAbrirPorUrl, useFiltroPorUrl } from '@/lib/use-abrir-por-url';
import { tenant } from '@/tenant.config';
import { V } from '@/lib/vocabulario';
import { chaveLocal } from '@/lib/armazenamento';

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
    <Suspense fallback={<div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-800 dark:text-brand-400" /></div>}>
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
  /**
   * Os filtros do painel, num objeto só.
   *
   * Eram quatro `useState` soltos, e cada filtro novo somava mais um `useState`,
   * mais uma entrada na `queryKey` e mais uma linha no "limpar". Como objeto, o
   * conjunto inteiro é uma dependência só — e limpar é atribuir `FILTROS_VAZIOS`.
   */
  const [filtros, setFiltros] = useState<FiltrosProcesso>(FILTROS_VAZIOS);
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  /**
   * A ORDEM. Padrão "movimentação recente" — ver `ordenacao.util.ts` no back,
   * onde está por que a ordem anterior (`ultimaSincronizacao`) era ruído.
   */
  const [ordem, setOrdem] = useState<OrdemProcesso>('movimentacao');
  /**
   * Fase processual. Separada do status de propósito: status é a nossa leitura
   * interna ("Ativo", "Encerrado"), fase é o que o tribunal está fazendo com o
   * processo. Misturar os dois num seletor só foi o que fez "encerrado" parecer
   * sinônimo de "arquivado" — e um processo em execução ser dado como morto.
   */

  /** Filtro rápido da tabela (chips). */
  /**
   * Parte contrária escolhida no cadastro. Guardo o OBJETO, não só o id: o
   * filtro precisa mostrar o nome de quem está filtrando, e buscar de novo só
   * para descobrir o nome de algo que a pessoa acabou de escolher seria uma
   * chamada a mais para nada.
   */
  const [parte, setParte] = useState<ParteExterna | null>(null);
  const [rapido, setRapido] = useState<
    'todos' | 'preProcessuais' | 'meus' | 'semFiliado' | 'semReu' | 'recentes'
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
  /** Caso pré-processual escolhido para ajuizar (vindo de um desfecho da agenda). */
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
   * `?rascunhos=1` (nome antigo do link) aplica o filtro rápido.
   *
   * O sistema JÁ gerava este link — o aviso ao concluir uma
   * atividade, oferece "Abrir Processos" e manda para cá com o parâmetro. A
   * tela o ignorava e mostrava a lista completa: o atalho parecia funcionar e
   * não fazia nada, que é pior que não existir, porque ninguém desconfia.
   */
  // O parâmetro continua sendo `rascunhos` porque é o link que a agenda já
  // manda e que pode estar salvo em favoritos; o que ele liga hoje é a aba
  // pré-processual. Trocar o nome do parâmetro quebraria links existentes sem
  // ganhar nada.
  useFiltroPorUrl('rascunhos', () => setRapido('preProcessuais'), '/processos');
  useFiltroPorUrl('preProcessuais', () => setRapido('preProcessuais'), '/processos');
  // Os atalhos do painel apontam para cá. Sem estas linhas o link levaria à
  // lista completa e a pessoa não desconfiaria — o pior tipo de atalho quebrado.
  useFiltroPorUrl('meus', () => setRapido('meus'), '/processos');
  useFiltroPorUrl('semReu', () => setRapido('semReu'), '/processos');
  useFiltroPorUrl('semFiliado', () => setRapido('semFiliado'), '/processos');

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
    const jaReleu = !!window.sessionStorage.getItem(chaveLocal('instancias-reavaliadas'));
    window.sessionStorage.setItem(chaveLocal('instancias-reavaliadas'), '1');

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
      statusInterno: filtros.status || undefined,
      // Filtros rápidos (mutuamente exclusivos).
      ...(parte ? { parteExternaId: parte.id } : {}),
      ...(rapido === 'meus' ? { meus: 'true' as const } : {}),
      ...(rapido === 'preProcessuais' ? { statusInterno: 'PRE_PROCESSUAL' as const } : {}),
      ...(rapido === 'semFiliado' ? { semFiliado: 'true' as const } : {}),
      ...(rapido === 'semReu' ? { semParteContraria: 'true' as const } : {}),
      ...(rapido === 'recentes' ? { movimentacaoRecente: janelaRecente } : {}),
      ...(filtros.fase ? { fase: filtros.fase } : {}),
      ...(filtros.advogadoId ? { advogadoId: filtros.advogadoId } : {}),
      ...(filtros.categoria ? { categoria: filtros.categoria } : {}),
      ordem,
      page,
      pageSize: 20,
    }),
    [buscaDeb, filtros, rapido, janelaRecente, page, parte, ordem],
  );

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['processos', buscaDeb, filtros, rapido, janelaRecente, page, parte?.id, ordem],
    queryFn: () => listarProcessos(filtro),
  });
  const items = data?.items ?? [];
  /**
   * OS NÚMEROS DAS ABAS.
   *
   * `staleTime` alto e chave sem os filtros: eles não dependem da busca nem da
   * página, e reconsultar a cada tecla seria sete `count` por caractere.
   * `invalidateQueries(['processos'])` continua atualizando ambos quando algo
   * muda de verdade — formalizar um caso, importar, mudar status.
   */
  const { data: contagem } = useQuery({
    queryKey: ['processos', 'contadores'],
    queryFn: contadoresProcessos,
    staleTime: 60_000,
  });

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
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-900/30">
            <Gavel className="h-5 w-5 text-brand-800 dark:text-brand-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">Processos</h2>
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              Acompanhamento processual · DATAJUD (CNJ)
              {reavaliando && (
                <span className="inline-flex items-center gap-1 text-xs text-brand-800 dark:text-brand-400">
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

      {/*
        FILTROS RÁPIDOS — com contagem, e o porquê.

        O pedido foi "fica meio apagado até pra saber aonde está os rascunhos".
        Eram dois problemas somados, e o segundo é o grave:

        1. Aba não selecionada era `bg-muted text-muted-foreground` — cinza sobre
           cinza. Passou a ter borda e texto de corpo: continua discreta, mas
           agora se lê como controle, não como legenda.

        2. NÃO DAVA PARA SABER SE HAVIA ALGO LÁ DENTRO. A fila pré-processual é
           escondida da lista padrão de propósito, então a única forma de
           descobrir que existia um caso era clicar na aba e torcer. Um caso real
           ficou invisível assim. O contador resolve: o trabalho escondido passa
           a se anunciar de onde está.

        A aba pré-processual ganha destaque violeta QUANDO TEM ALGO — e só então.
        Destaque permanente vira paisagem em uma semana; o que chama atenção é a
        mudança, não a cor. Mesmo violeta do selo, para a pessoa ligar as duas
        coisas sem precisar aprender.
      */}
      {/*
        NO CELULAR OS CHIPS ROLAM NA HORIZONTAL, em vez de quebrar.
        Eram seis com contador; num aparelho de 360px viravam três linhas de
        botões — quase 120px gastos antes do primeiro processo. Rolando, ocupam
        uma linha só, e a borda cortada é o próprio aviso de que há mais ao lado.
        `-mx-1 px-1` dá respiro ao anel de foco, que sumiria no overflow.
      */}
      <div className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible sm:pb-0 [&::-webkit-scrollbar]:hidden">
        {([
          { k: 'todos', label: 'Todos', n: contagem?.todos },
          { k: 'meus', label: 'Meus processos', n: contagem?.meus },
          // FILA PRÉ-PROCESSUAL — os casos abertos por desfechos da agenda e
          // ainda não ajuizados. Aba própria porque a lista padrão passou a
          // escondê-los: são duas filas de trabalho diferentes, e misturadas o
          // caso sem NPU entra como linha quase vazia empurrando para baixo o
          // processo que a pessoa foi procurar.
          { k: 'preProcessuais', label: 'Pré-processuais', n: contagem?.preProcessuais, destaque: true },
          { k: 'semFiliado', label: `Sem ${V.filiado} vinculado`, n: contagem?.semFiliado },
          // Fila de trabalho: o DataJud nunca preenche o réu, então esta lista
          // é a única forma de fechar o cadastro das partes.
          { k: 'semReu', label: 'Sem réu cadastrado', n: contagem?.semReu },
          { k: 'recentes', label: 'Com movimentação recente', n: contagem?.recentes },
        ] as const).map((f) => {
          const ativo = rapido === f.k;
          const chama = 'destaque' in f && f.destaque && !!f.n && !ativo;
          return (
            <button
              key={f.k}
              type="button"
              onClick={() => { setRapido(f.k); setPage(1); }}
              aria-pressed={ativo}
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition',
                ativo
                  ? 'border-brand-800 bg-brand-800 text-white shadow-sm'
                  : chama
                    ? 'border-violet-300 bg-violet-50 text-violet-800 hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300'
                    : 'border-border bg-background text-foreground hover:bg-muted',
              )}
            >
              {f.label}
              {/*
                O zero aparece, e é de propósito: "Sem réu cadastrado 0" informa
                que a fila está limpa. Esconder faria a ausência de número
                significar duas coisas — vazio e ainda carregando.
              */}
              {f.n !== undefined && (
                <span
                  className={cn(
                    'rounded-full px-1.5 text-xs font-bold tabular-nums',
                    ativo
                      ? 'bg-white/20 text-white'
                      : chama
                        ? 'bg-violet-600 text-white'
                        : f.n === 0
                          ? 'text-muted-foreground'
                          : 'bg-muted text-foreground',
                  )}
                >
                  {f.n}
                </span>
              )}
            </button>
          );
        })}
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

      {/*
        A BARRA: busca sempre visível, o resto atrás de um botão.

        Antes eram quatro controles em coluna no celular (busca, parte, situação,
        fase), 48px cada. Com os chips acima, davam mais de 200px de enfeite
        antes do primeiro processo — metade de um aparelho de 360px gasta com
        coisas que quase nunca mudam. Agora a busca (o que se usa toda hora)
        divide a linha com o botão de filtros (o que se usa às vezes).
      */}
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              // A busca SEMPRE cobriu o nome das partes; o placeholder é que não dizia,
              // e ninguém procura o que não sabe que existe.
              placeholder={`NPU, ${V.filiado}, parte contrária, classe…`}
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
            {isFetching && (
              <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
          </div>
          <BotaoFiltros
            aberto={filtrosAbertos}
            onToggle={() => setFiltrosAbertos((v) => !v)}
            quantos={contarFiltros(filtros, !!parte)}
          />
        </div>

        {filtrosAbertos && (
          <div className="space-y-2">
            {/*
              FILTRO POR PARTE fica no painel, junto dos demais, mas em linha
              própria: é uma busca com sugestões, não um seletor, e espremê-lo
              numa célula da grade cortaria a lista de resultados.

              É outra pergunta que a busca livre: a busca procura o nome ESCRITO
              em cada processo (que muda de grafia a cada autos); este procura
              pela LIGAÇÃO com o cadastro, e por isso pega todas as grafias.
            */}
            <FiltroParteContraria
              valor={parte}
              onChange={(p) => { setParte(p); setPage(1); }}
              className="w-full"
            />
            <PainelDeFiltros
              valor={filtros}
              onChange={(f) => { setFiltros(f); setPage(1); }}
            />
          </div>
        )}

        {/*
          O QUE ESTÁ FILTRANDO, mesmo com o painel fechado.
          Sem esta fila, "só aparecem 3 processos" viraria mistério: o filtro
          estaria ligado dentro de um painel que ninguém vê. Cada ficha remove
          só a si mesma — é raro querer limpar tudo.
        */}
        <FichasDeFiltro
          filtros={filtros}
          parte={parte ? { id: parte.id, nome: parte.nome } : null}
          busca={buscaDeb}
          onLimparCampo={(campo) => {
            setPage(1);
            if (campo === 'busca') { setBusca(''); setBuscaDeb(''); return; }
            if (campo === 'parte') { setParte(null); return; }
            setFiltros((f) => ({ ...f, [campo]: '' }));
          }}
          onLimparTudo={() => {
            setBusca(''); setBuscaDeb(''); setParte(null);
            setFiltros(FILTROS_VAZIOS); setPage(1);
          }}
        />
      </div>

      {/*
        TOTAL E ORDEM na mesma linha, logo acima da lista.

        A ordem fica FORA do painel de filtros de propósito: ordenar não é
        filtrar. Filtro muda QUAIS processos aparecem e é raro; ordem muda a
        prioridade da leitura e se troca várias vezes na mesma sessão — esconder
        atrás de um botão custaria dois toques toda vez.
      */}
      {/*
        QUEBRA EM VEZ DE CORTAR. Num aparelho de 360px, "41 processos · +4
        pré-processuais" ao lado de um seletor de 150px não cabe — e com
        `truncate` o que sumia era justamente o botão do aviso, que é clicável.
        Deixar a linha quebrar custa 22px numa tela estreita e não esconde nada.
      */}
      {!isLoading && total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <span className="text-sm text-muted-foreground">
            <span className="tabular-nums">{total} processo{total === 1 ? '' : 's'}</span>
            {/*
              O AVISO DE QUE ALGO FICOU DE FORA.

              A lista padrão esconde a fila pré-processual — decisão certa, mas
              que sem aviso vira "sumiu". Ficava no rodapé, junto da paginação;
              subiu para cá quando o total subiu, porque os dois são a mesma
              frase e separá-los faria a pessoa ler "41 processos" no topo e
              descobrir a ressalva só depois de rolar a lista inteira.

              Só na aba "Todos" e só com algo escondido: fora disso seria ruído
              permanente, e ruído permanente ninguém lê.
            */}
            {rapido === 'todos' && !!contagem?.preProcessuais && (
              <>
                {' · '}
                <button
                  type="button"
                  onClick={() => { setRapido('preProcessuais'); setPage(1); }}
                  className="font-medium text-violet-700 underline-offset-2 hover:underline dark:text-violet-400"
                >
                  +{contagem.preProcessuais} pré-processua{contagem.preProcessuais === 1 ? 'l' : 'is'}
                </button>
              </>
            )}
          </span>
          <label className="flex items-center gap-1.5">
            <ArrowUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="sr-only">Ordenar por</span>
            <select
              className="h-9 max-w-[13rem] rounded-md border border-input bg-background px-2 text-sm"
              value={ordem}
              onChange={(e) => { setOrdem(e.target.value as OrdemProcesso); setPage(1); }}
            >
              {(Object.keys(ORDENS_LABEL) as OrdemProcesso[]).map((o) => (
                <option key={o} value={o}>{ORDENS_LABEL[o]}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      {/* Lista */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <VazioContextual
          rapido={rapido}
          filtrando={!!buscaDeb || !!parte || contarFiltros(filtros, false) > 0}
          onLimpar={() => {
            setBusca(''); setBuscaDeb(''); setFiltros(FILTROS_VAZIOS);
            setRapido('todos'); setParte(null); setPage(1);
          }}
          onImportar={() => setImportOpen(true)}
        />
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
                    {/* QUEM RESPONDE. Fica antes do status porque a pergunta que
                        se faz varrendo a lista é "isto é meu?" — e a resposta é
                        um rosto, não um rótulo. */}
                    <th className="px-4 py-3 font-medium">Responsável</th>
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
                        {/*
                          O SELO VEM PRIMEIRO, antes do número.

                          Numa tabela densa a varredura é vertical, pela borda
                          esquerda: pôr o selo depois do NPU (que é monoespaçado
                          e largo) empurraria a marca para posições diferentes em
                          cada linha, e o olho perderia justamente a coluna que
                          ele está usando para achar o urgente.
                        */}
                        {p.urgente && (
                          <SeloUrgente
                            motivo={p.urgenteMotivo}
                            desde={p.urgenteEm}
                            tamanho="sm"
                            className="mb-1"
                          />
                        )}
                        {p.numeroCNJ ? (
                          <span className="block font-mono text-[13px] font-medium">{formatNPU(p.numeroCNJ)}</span>
                        ) : (
                          // Pré-processual ainda não tem número: mostra o rótulo e o
                          // convite para formalizar, em vez de uma linha vazia.
                          <span className="flex flex-col gap-1">
                            <span className="text-[13px] font-medium">{p.titulo || 'Caso sem título'}</span>
                            <SeloPreProcessual onAjuizar={() => setFormalizar(p)} />
                          </span>
                        )}
                        <Etiquetas lista={p.etiquetas} automaticas={p.etiquetasAutomaticas} />
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
                        <EquipeAvatares pessoas={equipeDoProcesso(p)} mostrarNome />
                      </td>
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

          {/*
            SÓ A PAGINAÇÃO.

            O total morava aqui e passou a aparecer TAMBÉM no topo, junto do
            seletor de ordem — dois lugares com o mesmo número, que é como
            começam as divergências desta base. Ficou o de cima: é onde a pessoa
            decide o que fazer, e antes de rolar.
          */}
          <div className="flex items-center justify-end text-sm text-muted-foreground">
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

      {/* Ajuizar o caso: informa o NPU e (opcionalmente) puxa do DataJud */}
      <AjuizarCasoModal
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
        'inline-flex w-fit items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-800 dark:bg-brand-900/40 dark:text-brand-300',
        className,
      )}
      title={`Ação coletiva movida pelo ${tenant.sigla} em nome da categoria`}
    >
      🏛️ Ação Institucional ({tenant.sigla})
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
          title={`${rotuloGrau(i.grau, i.tribunal)}${
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
          {siglaGrau(i.grau, i.tribunal)}
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
/**
 * O VAZIO DIZ O QUE ACONTECEU — e não a mesma frase sempre.
 *
 * A tela mostrava "Importe um processo pelo número (NPU)" em TODA lista vazia,
 * inclusive nas filas de trabalho. Só que fila de trabalho vazia é BOA notícia:
 * "Sem réu cadastrado: 0" quer dizer que o cadastro está fechado, e mandar
 * importar um processo ali é um conselho sem relação com o que a pessoa foi
 * fazer. Pior: some a informação que importa, que é "acabou, não há pendência".
 *
 * Três situações, três respostas:
 *  · fila de trabalho vazia  -> parabeniza e oferece a volta
 *  · filtro sem resultado    -> oferece limpar o filtro
 *  · base realmente vazia    -> aí sim, importar
 */
function VazioContextual({
  rapido,
  filtrando,
  onLimpar,
  onImportar,
}: {
  rapido: string;
  filtrando: boolean;
  onLimpar: () => void;
  onImportar: () => void;
}) {
  const FILAS: Record<string, { titulo: string; ajuda: string }> = {
    preProcessuais: {
      titulo: 'Nenhum caso em fase pré-processual',
      ajuda: 'Casos abertos pelo desfecho "Virou processo novo" da agenda aparecem aqui até serem ajuizados.',
    },
    semFiliado: {
      titulo: `Todo processo individual tem ${V.filiado} vinculado`,
      ajuda: `Ação institucional não entra nesta conta: nela o sindicato atua pela categoria, e não há ${V.filiado} "dono".`,
    },
    semReu: {
      titulo: 'Todo processo tem parte contrária cadastrada',
      ajuda: 'O DataJud não preenche o réu — esta fila existe para pescar o que ficou em branco.',
    },
    meus: { titulo: 'Nenhum processo na sua carteira', ajuda: 'Aparecem aqui os processos em que você consta como advogado.' },
    recentes: { titulo: 'Nenhuma movimentação na janela', ajuda: 'Amplie para 15 dias ou volte para a lista completa.' },
  };
  const fila = rapido !== 'todos' && !filtrando ? FILAS[rapido] : undefined;

  if (fila) {
    return (
      <Card className="flex flex-col items-center gap-3 py-16 text-center">
        <CheckCircle2 className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
        <div className="max-w-md">
          <p className="font-medium">{fila.titulo}</p>
          <p className="text-sm text-muted-foreground">{fila.ajuda}</p>
        </div>
        <Button variant="outline" onClick={onLimpar}>Ver todos os processos</Button>
      </Card>
    );
  }

  if (filtrando || rapido !== 'todos') {
    return (
      <Card className="flex flex-col items-center gap-3 py-16 text-center">
        <Filter className="h-8 w-8 text-muted-foreground opacity-60" />
        <div className="max-w-md">
          <p className="font-medium">Nenhum processo para este filtro</p>
          <p className="text-sm text-muted-foreground">
            Nada casa com a combinação atual de busca, status e fase.
          </p>
        </div>
        <Button variant="outline" onClick={onLimpar}>Limpar filtros</Button>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col items-center gap-3 py-16 text-center">
      <FileWarning className="h-8 w-8 text-muted-foreground opacity-60" />
      <div>
        <p className="font-medium">Nenhum processo cadastrado</p>
        <p className="text-sm text-muted-foreground">
          Importe um processo pelo número (NPU) para começar o acompanhamento.
        </p>
      </div>
      <Button onClick={onImportar}>
        <Plus className="h-4 w-4" /> Importar Processo
      </Button>
    </Card>
  );
}

function BadgeFase({ fase }: { fase?: FaseProcessual }) {
  if (!fase) return null;
  const cor: Record<FaseProcessual, string> = {
    // A única fase que NÃO é do tribunal: o caso ainda nem foi ajuizado.
    PRE_PROCESSUAL: 'text-violet-700 dark:text-violet-400',
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
      {alerta && <SeloDeAlerta alerta={alerta} />}
    </div>
  );
}

/**
 * O SELO DA LINHA — um aviso por processo, com peso proporcional ao que pede.
 *
 * O QUE ISTO CONSERTA. Antes havia dois selos, "Prazo sem tarefa" e "Decisão a
 * ler", e o primeiro era uma mentira medida: em 25/08/2026, com 41 processos na
 * produção, a lista mostrava ONZE selos de prazo — nenhum com menos de quinze
 * dias, dez com mais de trinta, o mais velho com 252. Nenhum era prazo. Um
 * aviso que só acende para coisa velha ensina a equipe a não olhar para ele.
 *
 * Agora o nível vem inteiro do back (`alertaDaLinha` → `tpu.util.ts`), que
 * aplica dicionário, validade, complemento e dispensa num lugar só. Aqui é só
 * aparência — e a aparência é DESIGUAL de propósito:
 *
 *  · URGENTE  vermelho, com o ícone que mais chama — tutela muda o que se pode
 *             fazer hoje, e é o único nível que merece interromper alguém;
 *  · PRAZO    âmbar — o robô devia ter aberto tarefa e não abriu;
 *  · DECISÃO  azul — há o que ler, sem relógio correndo;
 *  · PARADO   cinza, sem cor de alarme. É informação, não cobrança: o processo
 *             não se mexe há meses e ninguém tinha como perceber olhando a
 *             lista. Dar-lhe cor de urgência recriaria o problema que os outros
 *             três acabaram de resolver.
 */
function SeloDeAlerta({ alerta }: { alerta: NonNullable<ProcessoLista['alerta']> }) {
  const APARENCIA = {
    URGENTE: {
      classe: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
      Icone: Siren,
      titulo: 'Ação imediata — o ato muda o que pode ser feito hoje',
    },
    PRAZO: {
      classe: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
      Icone: AlarmClock,
      titulo: 'Ato recente que abre prazo e ainda não virou tarefa na agenda',
    },
    DECISAO: {
      classe: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
      Icone: Scale,
      titulo: 'Decisão dos últimos 90 dias que ninguém marcou como lida',
    },
    PARADO: {
      classe: 'bg-muted text-muted-foreground',
      Icone: Hourglass,
      titulo: 'Processo vivo sem nenhum andamento novo — pode estar esperando algo nosso',
    },
  } as const;

  const { classe, Icone, titulo } = APARENCIA[alerta.nivel];
  return (
    <span
      title={titulo}
      className={cn(
        'mt-0.5 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
        classe,
      )}
    >
      <Icone className="h-3 w-3" />
      {alerta.rotulo}
    </span>
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
      {p.urgente && (
        <SeloUrgente motivo={p.urgenteMotivo} desde={p.urgenteEm} tamanho="sm" className="mb-1.5" />
      )}
      <div className="flex items-start justify-between gap-2">
        <p className={cn('text-sm font-semibold', p.numeroCNJ && 'font-mono')}>
          {p.numeroCNJ ? formatNPU(p.numeroCNJ) : p.titulo || 'Caso sem título'}
        </p>
        <Etiquetas lista={p.etiquetas} automaticas={p.etiquetasAutomaticas} />
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
        {/*
          NO CELULAR o rosto fica no RODAPÉ, ao lado da última movimentação, e
          não no topo: lá em cima disputaria espaço com o número do processo e
          com o status, que são o que identifica a linha. Aqui ele responde a
          outra pergunta — "isto é meu?" — no exato lugar onde o olho para antes
          de rolar para o próximo card.
        */}
        <div className="flex items-center justify-between gap-3 border-t pt-1.5">
          <CelulaUltimaMov p={p} />
          <EquipeAvatares pessoas={equipeDoProcesso(p)} limite={2} tamanho="xs" className="shrink-0" />
        </div>
      </div>
    </Card>
  );
}

/**
 * A EQUIPE DO PROCESSO na ordem certa: o responsável primeiro.
 *
 * A API devolve `advogados` (a tabela N:N, com `principal`) e `advogado` (o
 * atalho, que é o principal). Ler só o atalho mostraria UMA pessoa num processo
 * de cinco — foi exatamente o erro que fez o painel da Dra. Shérad dizer
 * "A ajuizar: 0" com o caso na tela dela. Aqui a tabela manda, e o atalho só
 * entra quando a tabela está vazia (cadastro antigo, importação).
 */
function equipeDoProcesso(p: ProcessoLista) {
  const daTabela = [...(p.advogados ?? [])]
    .sort((a, b) => Number(b.principal) - Number(a.principal))
    .map((a) => ({
      id: a.advogado.id,
      nome: a.advogado.nomeExibicao || a.advogado.nome,
      avatarUrl: a.advogado.avatarUrl,
    }));
  if (daTabela.length) return daTabela;
  return p.advogado
    ? [{
        id: p.advogado.id,
        nome: p.advogado.nomeExibicao || p.advogado.nome,
        avatarUrl: p.advogado.avatarUrl,
      }]
    : [];
}

/** Etiquetas internas do processo, compactas na listagem. */
/**
 * Etiquetas da linha: as do SISTEMA primeiro (⚡), depois as escritas à mão.
 *
 * A marcação de "etiqueta contraditória" que existia aqui foi embora junto com
 * a causa: "Fase de Execução" e "Recurso" deixaram de ser texto guardado — a
 * coluna de fase já diz isso e se corrige sozinha. O que sobra como automática
 * (Coletiva, Perícia) é derivado a cada leitura e, por construção, não tem como
 * contradizer nada.
 */
function Etiquetas({ lista, automaticas }: { lista?: string[]; automaticas?: string[] }) {
  const auto = automaticas ?? [];
  const manuais = (lista ?? []).filter((e) => !auto.includes(e));
  if (!auto.length && !manuais.length) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {auto.map((e) => (
        <span
          key={`a-${e}`}
          title="Mantida pelo sistema a partir dos dados do processo"
          className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
        >
          <Zap className="h-2.5 w-2.5 fill-current" />
          {e}
        </span>
      ))}
      {manuais.slice(0, 3).map((e) => (
        <span
          key={e}
          className="rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-800 dark:bg-brand-900/30 dark:text-brand-400"
        >
          {e}
        </span>
      ))}
      {manuais.length > 3 && (
        <span className="text-[10px] text-muted-foreground">+{manuais.length - 3}</span>
      )}
    </span>
  );
}
