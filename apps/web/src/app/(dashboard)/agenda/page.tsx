'use client';

import { Suspense, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Loader2, Plus, Search, CalendarClock, CalendarDays, SlidersHorizontal, Trash2, ChevronUp,
  UserCheck, Flame, ListFilter, Clock, RotateCw, X, Columns3, List,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { Carregando } from '@/components/ui/esqueleto';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { nivelEfetivo, podeExcluir } from '@/lib/permissoes';
import { KanbanView, EsqueletoDoQuadro } from '@/components/agenda/kanban-view';
import {
  ListaPorDia, EsqueletoDaLista, SeletorDaJanela, RodapeDaPaginacao,
} from '@/components/agenda/lista-por-dia';
import { SeletorResponsaveis } from '@/components/agenda/seletor-responsaveis';
import { CalendarioView } from '@/components/agenda/calendario-view';
import { CompromissoFormModal } from '@/components/agenda/compromisso-form-modal';
import { CompromissoDrawer } from '@/components/agenda/compromisso-drawer';
import { TiposEventoModal } from '@/components/agenda/tipos-evento-modal';
import { ConcluirModal } from '@/components/agenda/concluir-modal';
import { CancelarModal } from '@/components/agenda/cancelar-modal';
import { ReabrirModal } from '@/components/agenda/reabrir-modal';
import { RemarcarModal } from '@/components/agenda/remarcar-modal';
import { useRefazerNaViradaDoDia } from './virada-do-dia';
import { AtendimentoDrawer } from '@/components/atendimentos/atendimento-drawer';
import { RegistrarDesfechoModal, type AtendimentoParaDesfecho } from '@/components/atendimentos/registrar-desfecho-modal';
import { useTiposEvento } from '@/lib/use-tipos-evento';
import { useAbrirPorUrl } from '@/lib/use-abrir-por-url';
import { useTelaLarga } from '@/lib/use-tela-larga';
import {
  listarCompromissos, buscarRecortes, getCompromisso, mudarStatusCompromisso, excluirCompromisso, estaFechado,
  listarResponsaveis, ehMinha, estaAtrasado, temHoraMarcada,
  filtroDoServidor, contarFiltrosAtivos, lerUrlDaAgenda, RECORTES, RECORTE_PADRAO,
  agruparPorDia, semRepetidas, proximoCursor, PAGINA_DA_AGENDA,
  opcoesDaLista, estadoDoRodape, quantasNoRecorte, totalDoGrupoParaTras, visaoDaAgenda,
  paginaDeCadaItem, celulaDoDiaBR, doDiaDeTeresina, ymdDoCalendario, diaBRDe,
  type Compromisso, type StatusCompromisso, type TipoCompromisso, type RecorteAgenda,
  type JanelaDaAgenda, type VisaoDaAgenda,
} from '@/lib/agenda';
import { chaveLocal } from '@/lib/armazenamento';
import { CHAVES_DEPOIS_DE_CONCLUIR } from '@/lib/dashboard';
import { avisoDeReaberta } from '@/lib/acao-rapida';

/** Lembra se o calendário fica aberto — a escolha vale por navegador. */
const CHAVE_CALENDARIO = chaveLocal('agenda', 'calendario-aberto');
/** Lembra a visão ESCOLHIDA (quadro ou lista). Sem escolha, decide a largura. */
const CHAVE_VISAO = chaveLocal('agenda', 'visao');
const inputCls = 'h-12 w-full rounded-md border border-input bg-background px-3 text-base sm:h-10 sm:w-auto sm:text-sm';

/**
 * Parâmetros que a agenda entende na URL (C11). O painel monta estes links, e
 * `lerUrlDaAgenda` é a tradução única das duas pontas.
 */
const CHAVES_DA_URL = [
  'aba', 'pessoa', 'reservaDe', 'responsavel', 'responsaveis', 'somenteResponsavel', 'tipo', 'urgentes', 'busca',
] as const;

function gradeDoMes(mes: Date) {
  const primeiro = new Date(mes.getFullYear(), mes.getMonth(), 1);
  const ini = new Date(primeiro);
  ini.setDate(1 - primeiro.getDay());
  const fim = new Date(ini);
  fim.setDate(ini.getDate() + 42);
  return { dataInicio: ini.toISOString(), dataFim: fim.toISOString() };
}

/** Escolheu o Quadro nesta sessão? Só aí Todas continua no quadro (ver `visaoDaAgenda`). */
const CHAVE_QUADRO_NA_SESSAO = chaveLocal('agenda', 'quadro-na-sessao');

/*
  AS PREFERÊNCIAS SÃO LIDAS ANTES DO PRIMEIRO DESENHO (15/09/2026).

  Eram lidas num useEffect, que roda depois de a tela aparecer: quem guardou a
  Lista via o quadro por um instante e depois a lista, e quem fechou o calendário
  o via abrir e fechar. Com useSyncExternalStore a navegação dentro do sistema já
  desenha a escolha certa; no servidor (e na hidratação) vale o padrão.

  A memória guarda o que foi escolhido mesmo quando o navegador recusa o
  armazenamento: a escolha vale na sessão, só não fica lembrada.
*/
type Armazem = 'local' | 'sessao';
const memoriaDasPreferencias = new Map<string, string>();
const avisosDasPreferencias = new Set<() => void>();

function armazemDe(tipo: Armazem): Storage | null {
  try {
    return tipo === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function lerPreferencia(chave: string, tipo: Armazem): string | null {
  if (typeof window === 'undefined') return null;
  const naMemoria = memoriaDasPreferencias.get(`${tipo}:${chave}`);
  if (naMemoria !== undefined) return naMemoria;
  try {
    return armazemDe(tipo)?.getItem(chave) ?? null;
  } catch {
    return null;
  }
}

function gravarPreferencia(chave: string, valor: string, tipo: Armazem) {
  memoriaDasPreferencias.set(`${tipo}:${chave}`, valor);
  try { armazemDe(tipo)?.setItem(chave, valor); } catch { /* só não lembra */ }
  avisosDasPreferencias.forEach((avisar) => avisar());
}

function assinarPreferencias(avisar: () => void): () => void {
  // Outra aba mudou o localStorage: a memória desta aba deixa de valer para a chave.
  const deOutraAba = (e: StorageEvent) => {
    if (e.key) memoriaDasPreferencias.delete(`local:${e.key}`);
    avisar();
  };
  avisosDasPreferencias.add(avisar);
  window.addEventListener('storage', deOutraAba);
  return () => {
    avisosDasPreferencias.delete(avisar);
    window.removeEventListener('storage', deOutraAba);
  };
}

function usePreferencia(chave: string, tipo: Armazem): string | null {
  return useSyncExternalStore(
    assinarPreferencias,
    () => lerPreferencia(chave, tipo),
    () => null,
  );
}

/**
 * O DIA DE HOJE EM TERESINA, QUE VIRA SOZINHO (15/09/2026).
 *
 * Os grupos da lista calculavam "Hoje" e "Amanhã" com Date.now() dentro de um
 * memo sem o relógio nas dependências: com a agenda aberta de um dia para o
 * outro, o "Hoje" da tela continuava sendo ontem até alguém mexer num filtro.
 * Conferir a cada minuto basta; o estado só muda quando o dia muda.
 */
function useHojeBR(): string {
  const [hoje, setHoje] = useState(() => diaBRDe(Date.now()));
  useEffect(() => {
    const t = setInterval(() => {
      const agora = diaBRDe(Date.now());
      setHoje((antes) => (antes === agora ? antes : agora));
    }, 60_000);
    return () => clearInterval(t);
  }, []);
  return hoje;
}

/**
 * O QUE FICOU PARA TRÁS SOBE, E DEPOIS O QUE É MEU.
 *
 * A lista chega do servidor em ordem de início, então as atrasadas já vêm
 * primeiro; a ordenação só garante que "minhas primeiro" não as empurre para
 * baixo. "Minhas primeiro" vale só quando o quadro mostra o trabalho de mais
 * de uma pessoa — num quadro que já é de uma pessoa, não distingue nada.
 * A lista por dia reordena tudo pela hora (`agruparPorDia`) e ignora isto.
 */
function ordenarParaTrabalhar(cs: Compromisso[], meuId: string | undefined, aplicarMinhas: boolean): Compromisso[] {
  // Estável: dentro de cada grupo a ordem por data que veio da API se mantém.
  return [...cs].sort((a, b) => {
    const atraso = Number(estaAtrasado(b)) - Number(estaAtrasado(a));
    if (atraso !== 0) return atraso;
    if (!aplicarMinhas || !meuId) return 0;
    return Number(ehMinha(b, meuId)) - Number(ehMinha(a, meuId));
  });
}

/**
 * `useSearchParams` obriga a um limite de Suspense — sem ele o build do Next
 * falha ao pré-renderizar a rota. Mesmo padrão já usado em Processos.
 */
export default function AgendaPage() {
  return (
    <Suspense
      fallback={
        /*
          A forma pela largura, no CSS (15/09/2026): o celular abre na lista e
          via primeiro o esqueleto do quadro. O CSS responde antes de qualquer
          JavaScript, então não pisca.
        */
        <Carregando texto="Abrindo a agenda…">
          <div className="md:hidden"><EsqueletoDaLista /></div>
          <div className="hidden md:block"><EsqueletoDoQuadro /></div>
        </Carregando>
      }
    >
      <AgendaConteudo />
    </Suspense>
  );
}

function AgendaConteudo() {
  const qc = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const ehAdmin = podeExcluir(user?.role);
  const podeEditar = nivelEfetivo(user?.role, user?.permissoes, 'agenda') === 'EDITAR';
  const { tipos } = useTiposEvento();

  /** Aberto, a não ser que a pessoa o tenha fechado neste navegador. */
  const calendarioAberto = usePreferencia(CHAVE_CALENDARIO, 'local') !== '0';
  /** Dia clicado no calendário; filtra o quadro logo acima. */
  const [diaSelecionado, setDiaSelecionado] = useState<Date | null>(null);
  const [aba, setAba] = useState<RecorteAgenda>(RECORTE_PADRAO);
  const [busca, setBusca] = useState('');
  const [buscaDeb, setBuscaDeb] = useState('');
  const [tipo, setTipo] = useState<'' | TipoCompromisso>('');
  /** Vários responsáveis ao mesmo tempo — vazio significa "todos". */
  const [responsaveis, setResponsaveis] = useState<string[]>([]);
  /** Com responsáveis: só onde a pessoa RESPONDE (o "Esperando por" do painel). */
  const [somenteResponsavel, setSomenteResponsavel] = useState(false);
  /** Régua `daPessoa`: responde ou foi posta ali por gente — a reserva do robô fica fora. */
  const [pessoa, setPessoa] = useState<string | undefined>();
  /** Só onde a pessoa é reserva posta pelo robô. */
  const [reservaDe, setReservaDe] = useState<string | undefined>();
  const [soUrgentes, setSoUrgentes] = useState(false);
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [mes, setMes] = useState(() => new Date());
  const [tiposOpen, setTiposOpen] = useState(false);

  /*
    QUADRO OU LISTA (14/09/2026).

    No celular o quadro empilhava as quatro colunas e a ordem do tempo se perdia
    entre elas; abaixo de 768 px a agenda abre na LISTA POR DIA. No computador o
    quadro continua o padrão — as quatro colunas cabem e o arraste só existe com
    mouse — com a lista a um toque. Quem escolhe uma visão fica com ela
    (localStorage), como já acontece com o calendário e com a Escala.

    Uso medido em 30 dias: 11 de 370 ações da agenda vieram do celular, de duas
    pessoas. É pouco, e a lista entra assim mesmo por pedido do dono.
  */
  const telaLarga = useTelaLarga();
  const visaoGuardada = usePreferencia(CHAVE_VISAO, 'local');
  const visaoEscolhida: VisaoDaAgenda | null =
    visaoGuardada === 'quadro' || visaoGuardada === 'lista' ? visaoGuardada : null;
  const quadroNaSessao = usePreferencia(CHAVE_QUADRO_NA_SESSAO, 'sessao') === '1';
  /** Hoje em Teresina; muda à meia-noite e refaz os grupos. */
  const hoje = useHojeBR();
  // Os dados viram junto com o rótulo (15/09/2026): ver virada-do-dia.ts.
  useRefazerNaViradaDoDia(hoje, qc);
  /** A metade de "Todas" que a lista mostra. Trocar de aba volta para Próximas. */
  const [janela, setJanela] = useState<JanelaDaAgenda>('adiante');

  const [formOpen, setFormOpen] = useState(false);
  const [editar, setEditar] = useState<Compromisso | null>(null);
  const [detalheId, setDetalheId] = useState<string | null>(null);
  /**
   * Id que chegou pela URL e ainda não foi posicionado no quadro.
   *
   * Guardar o id à parte é o que permite reposicionar UMA vez, quando a lista
   * chega. Reagir a `detalheId` puro reposicionaria o quadro toda vez que
   * alguém abrisse um cartão com a mão, jogando a tela para longe do que a
   * pessoa estava lendo.
   */
  const [veioDeFora, setVeioDeFora] = useState<string | null>(null);
  /** Cartão apontado pela navegação — recebe um anel até a pessoa mexer. */
  const [destacado, setDestacado] = useState<string | null>(null);
  const [triagemId, setTriagemId] = useState<string | null>(null);
  /**
   * "Registrar desfecho" e "Marcar nova consulta" da gaveta do atendimento.
   * Sem o modal montado aqui, os dois sumiam da gaveta aberta pela agenda
   * enquanto Concluir e Cancelar apareciam (auditoria de 14/09/2026).
   */
  const [desfechoAlvo, setDesfechoAlvo] = useState<AtendimentoParaDesfecho | null>(null);
  const [excluir, setExcluir] = useState<Compromisso | null>(null);
  // Ações que exigem informação: cada uma tem o seu diálogo.
  const [concluir, setConcluir] = useState<Compromisso | null>(null);
  const [cancelar, setCancelar] = useState<Compromisso | null>(null);
  /** Categoria pré-escolhida quando o cancelamento vem de um atalho. */
  const [cancelarCategoria, setCancelarCategoria] = useState<string | undefined>();
  /**
   * REABRIR PASSA POR UM DIÁLOGO (21/09/2026). Guarda o cartão E o destino: o
   * mesmo diálogo serve para "voltar a pendente" e "voltar a em andamento", e
   * a frase do aviso muda com isso.
   */
  const [reabrir, setReabrir] = useState<{ c: Compromisso; destino: StatusCompromisso } | null>(null);
  const [remarcar, setRemarcar] = useState<Compromisso | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setBuscaDeb(busca.trim()), 350);
    return () => clearTimeout(t);
  }, [busca]);

  useEffect(() => {
    setJanela('adiante');
  }, [aba]);

  /**
   * `?compromisso=<id>` abre a atividade direto — é o que faz um atalho de
   * fora (painel, faixa de avisos, ficha do processo) chegar em algum lugar.
   */
  useAbrirPorUrl('compromisso', (id) => { setDetalheId(id); setVeioDeFora(id); }, '/agenda');

  /*
    A URL DO RECORTE (C11) — `?aba=atrasadas&pessoa=eu`, `?aba=atencao&responsavel=<id>&somenteResponsavel=1`…

    Guardada numa foto antes de limpar a URL, porque `pessoa=eu` precisa do id
    de quem está logado e a sessão pode chegar um instante depois. Sem a foto,
    a URL já limpa levaria o recorte embora e a pessoa veria a agenda da casa
    inteira achando que era a dela.
  */
  const [daUrl, setDaUrl] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    const foto: Record<string, string> = {};
    for (const k of CHAVES_DA_URL) {
      const v = searchParams.get(k);
      if (v) foto[k] = v;
    }
    if (Object.keys(foto).length === 0) return;
    setDaUrl(foto);
    router.replace('/agenda', { scroll: false });
  }, [searchParams, router]);

  useEffect(() => {
    if (!daUrl) return;
    const e = lerUrlDaAgenda({ get: (k) => daUrl[k] ?? null }, user?.id);
    if (e.aguardandoSessao) return;
    setDiaSelecionado(null);
    if (e.responsaveis && !daUrl.aba) {
      // Link antigo do painel ("Esperando por", sem aba): abre Em aberto, como sempre abriu.
      const v = e.responsaveis;
      setResponsaveis([v]); setAba('aberto');
    } else {
      setAba(e.aba);
      setResponsaveis(e.responsaveis ? e.responsaveis.split(',') : []);
    }
    setSomenteResponsavel(e.somenteResponsavel);
    setPessoa(e.pessoa);
    setReservaDe(e.reservaDe);
    setTipo(e.tipo ?? '');
    setSoUrgentes(e.urgentes);
    if (e.busca) { setBusca(e.busca); setBuscaDeb(e.busca); }
    setDaUrl(null);
  }, [daUrl, user?.id]);

  const consultaResponsaveis = useQuery({ queryKey: ['compromissos-responsaveis'], queryFn: listarResponsaveis });
  const responsaveisLista = consultaResponsaveis.data ?? [];
  const nomeDe = (id: string) => {
    const p = responsaveisLista.find((r) => r.id === id);
    return p ? p.nomeExibicao || p.nome : 'pessoa selecionada';
  };

  /*
    A VISÃO À VISTA. Todas vai para a lista (é ali que existem Próximas,
    Anteriores e "Carregar mais"), a não ser que a pessoa tenha tocado em Quadro
    nesta sessão. A escolha guardada continua valendo nas outras abas.
  */
  const visao: VisaoDaAgenda = visaoDaAgenda({ escolhida: visaoEscolhida, telaLarga, aba, quadroNaSessao });

  function escolherVisao(v: VisaoDaAgenda) {
    gravarPreferencia(CHAVE_VISAO, v, 'local');
    gravarPreferencia(CHAVE_QUADRO_NA_SESSAO, v === 'quadro' ? '1' : '0', 'sessao');
  }

  /*
    O MESMO FILTRO VAI PARA A LISTA E PARA OS CONTADORES — o número da aba é o
    count() do recorte que a aba abre, com os mesmos filtros. Ver
    `filtroDoServidor`.
  */
  const estadoDosFiltros = {
    pessoa,
    reservaDe,
    responsaveis: responsaveis.length ? responsaveis.join(',') : undefined,
    somenteResponsavel,
    tipo: tipo || undefined,
    urgentes: soUrgentes,
    busca: buscaDeb,
  };
  const filtro = filtroDoServidor(estadoDosFiltros);
  const rangeCal = useMemo(() => gradeDoMes(mes), [mes]);

  /**
   * "TODAS" NA LISTA É PAGINADA; NO QUADRO, NÃO.
   *
   * O quadro conta `itens.length` por coluna: paginado, diria "Concluído 7" com
   * 37 existentes. A lista divide Todas em Próximas e Anteriores e pede de 50 em
   * 50 por cursor. Com um dia escolhido no calendário, os dados vêm do mês.
   */
  const listaDeTodas = visao === 'lista' && aba === 'todos' && !diaSelecionado;

  /**
   * O QUADRO PEDE O RECORTE DA ABA AO SERVIDOR.
   *
   * Antes baixava a agenda inteira e recortava aqui — e a API corta em 500 pela
   * data mais antiga: no dia em que o acervo passasse do limite, "Hoje" ficaria
   * vazio em silêncio. O calendário continua com a própria janela do mês.
   *
   * Trocar de aba mantém o quadro anterior até o novo chegar: nada pisca.
   *
   * COM UM DIA ESCOLHIDO, NÃO PEDE (15/09/2026). Os cartões vêm do mês; pedir o
   * recorte da aba mesmo assim segurava a tela no esqueleto até uma resposta que
   * ninguém ia desenhar (dia escolhido com a aba Todas na lista). A exceção é o
   * atalho de fora, que precisa saber se a atividade cabe na aba.
   */
  const quadro = useQuery({
    queryKey: ['compromissos', 'quadro', aba, filtro],
    queryFn: () => listarCompromissos({ ...filtro, recorte: aba }),
    placeholderData: (anterior) => anterior,
    enabled: !listaDeTodas && (!diaSelecionado || !!veioDeFora),
  });
  /*
    A chave começa com 'compromissos': invalidar(), a gaveta e a conclusão pelo
    painel alcançam as páginas sem exceção nova, e o react-query refaz as já
    carregadas em sequência. O filtro está na chave — mudar a busca recomeça da
    primeira página. Cada página guarda a janela que a pediu, para a lista não
    agrupar os dados antigos pela regra da janela nova enquanto a troca carrega.
  */
  const todas = useInfiniteQuery({
    queryKey: ['compromissos', 'todas', janela, filtro],
    queryFn: async ({ pageParam }) => ({
      janela,
      itens: await listarCompromissos({
        ...filtro, recorte: 'todos', janela, limite: PAGINA_DA_AGENDA, cursor: pageParam,
      }),
    }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (ultima) => proximoCursor(ultima.itens, PAGINA_DA_AGENDA),
    placeholderData: keepPreviousData,
    enabled: listaDeTodas,
  });
  const contadores = useQuery({
    queryKey: ['compromissos', 'recortes', filtro],
    queryFn: () => buscarRecortes(filtro),
    placeholderData: (anterior) => anterior,
  });
  const contagem = contadores.data;
  const minhas = useQuery({
    queryKey: ['compromissos', 'recortes', 'minhas', user?.id],
    queryFn: () => buscarRecortes({ pessoa: user!.id }),
    enabled: !!user?.id,
  });
  const doMes = useQuery({
    queryKey: ['compromissos', 'mes', filtro, rangeCal.dataInicio],
    queryFn: () => listarCompromissos({ ...filtro, ...rangeCal }),
    enabled: calendarioAberto || !!diaSelecionado,
  });

  const compromissos = useMemo(() => quadro.data ?? [], [quadro.data]);
  const compromissosDoMes = doMes.data ?? [];
  const itensDeTodas = useMemo(
    () => semRepetidas((todas.data?.pages ?? []).map((p) => p.itens)),
    [todas.data],
  );
  /** A janela dos dados À VISTA — durante a troca, ainda é a anterior. */
  const janelaDosDados: JanelaDaAgenda = todas.data?.pages[0]?.janela ?? janela;

  /** O que a aba mostra agora, venha do quadro ou das páginas de Todas. */
  const listaDaAba = listaDeTodas ? itensDeTodas : compromissos;
  const listaDaAbaPronta = listaDeTodas
    ? todas.isSuccess && !todas.isPlaceholderData
    : quadro.isSuccess && !quadro.isPlaceholderData;

  /*
    Vindo de fora, a atividade pode não estar no recorte da aba. A gaveta já
    pede o detalhe; aqui a mesma consulta (mesma chave, mesmo cache) diz a data
    para levar o calendário ao mês certo.
  */
  const alvoDeFora = useQuery({
    queryKey: ['compromisso', veioDeFora],
    queryFn: () => getCompromisso(veioDeFora!),
    enabled: !!veioDeFora,
  });

  /**
   * POSICIONA A AGENDA NA ATIVIDADE QUE O ATALHO ABRIU.
   *
   * Quando a aba atual não contém a atividade ("onde ela está?"), a agenda
   * passa a mostrar o DIA dela; o CALENDÁRIO vai para o mês dela ("que dia é
   * hoje nisto?") e o CARTÃO ganha um anel ("o que eu cliquei?"). Roda uma vez
   * por chegada.
   *
   * Até 14/09/2026 a aba virava "Todas". Com Todas paginada na lista, a
   * atividade pode não estar na primeira página e o anel não acharia ninguém;
   * a consulta do mês garante o cartão na tela nas duas visões.
   */
  useEffect(() => {
    if (!veioDeFora || !listaDaAbaPronta) return;
    const alvo = listaDaAba.find((c) => c.id === veioDeFora) ?? alvoDeFora.data;
    if (!alvo) return;

    // A célula do dia de Teresina, o mesmo dia do grupo da lista (15/09/2026).
    const inicio = celulaDoDiaBR(alvo.inicio);
    // O recorte é do servidor: a atividade cabe na aba se veio na lista dela.
    const abaCabe = listaDaAba.some((c) => c.id === alvo.id);
    if (!abaCabe) setDiaSelecionado(new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate()));

    setMes(new Date(inicio.getFullYear(), inicio.getMonth(), 1));
    setDestacado(alvo.id);
    setVeioDeFora(null);
  }, [veioDeFora, listaDaAba, listaDaAbaPronta, alvoDeFora.data]);

  /**
   * O quadro mostra o trabalho de mais de uma pessoa? Só aí a ordenação por
   * "minhas" tem sentido — e só aí o cartão ganha a marca.
   */
  const quadroCompartilhado =
    !!user?.id && !pessoa && !reservaDe && !(responsaveis.length === 1 && responsaveis[0] === user.id);

  /**
   * Com um dia selecionado, o quadro mostra AQUELE dia e a aba é ignorada —
   * senão clicar em 20/ago com a aba "Hoje" ativa devolveria uma tela vazia.
   * Os dados vêm da consulta do mês, a única que garante ter o dia escolhido.
   */
  const filtrados = useMemo(() => {
    // O dia de Teresina, e não o do aparelho: o mesmo dos grupos da lista.
    const base = !diaSelecionado ? listaDaAba : doDiaDeTeresina(compromissosDoMes, ymdDoCalendario(diaSelecionado));
    return ordenarParaTrabalhar(base, user?.id, quadroCompartilhado);
    // `hoje` entra porque "ficou para trás" (estaAtrasado) muda quando o dia vira.
  }, [diaSelecionado, listaDaAba, compromissosDoMes, user?.id, quadroCompartilhado, hoje]);

  /*
    OS GRUPOS DA LISTA. As regras (Anteriores só em Todas; Hoje vazio só quando
    as páginas chegaram a hoje; nada de âmbar num dia escolhido; a página
    seguinte só acrescenta no fim) moram em `opcoesDaLista`, testada com linhas.
    A ordem que conta para "chegou a hoje" é a da API, antes de
    `ordenarParaTrabalhar`.
  */
  const paginasDeTodas = useMemo(
    () => paginaDeCadaItem((todas.data?.pages ?? []).map((p) => p.itens)),
    [todas.data],
  );
  const temProximaEmTodas = !!todas.hasNextPage;
  const grupos = useMemo(
    () =>
      visao !== 'lista'
        ? []
        : agruparPorDia(
            filtrados,
            opcoesDaLista({
              listaDeTodas,
              diaEscolhido: !!diaSelecionado,
              aba,
              janelaDosDados,
              itensNaOrdemDaApi: itensDeTodas,
              temProxima: temProximaEmTodas,
              agora: Date.now(),
              paginas: paginasDeTodas,
            }),
          ),
    // `hoje` refaz os rótulos Hoje/Amanhã quando o dia vira com a tela aberta.
    [visao, filtrados, listaDeTodas, diaSelecionado, aba, janelaDosDados, itensDeTodas, temProximaEmTodas, paginasDeTodas, hoje],
  );

  /** Quantas são minhas e estão em aberto — pela régua `daPessoa`, a mesma do painel. */
  const minhasEmAberto = minhas.data?.aberto ?? 0;
  const soAsMinhas = !!user?.id && pessoa === user.id;

  /**
   * Quantos filtros a pessoa LIGOU. A aba não conta: ela está sempre à vista,
   * destacada e com o próprio número — contá-la fazia a linha "1 filtro ativo"
   * aparecer em toda abertura da tela.
   */
  const filtrosAtivos = contarFiltrosAtivos(estadoDosFiltros);
  /** No celular a busca fica à vista; o botão "Filtros" conta o resto. */
  const filtrosNoBotao = filtrosAtivos - (buscaDeb ? 1 : 0);

  /**
   * QUANTAS O FILTRO ACHOU FORA DA ABA — o número que faltava dizer.
   *
   * Todo recorte cabe em "Todas", e os dois números vêm do mesmo count() com
   * os mesmos filtros. A diferença transforma um "0 resultados" que parece
   * defeito em "não é hoje, é em outro dia" — que é a resposta verdadeira.
   */
  const foraDaAba = useMemo(
    () => (aba === 'todos' || diaSelecionado || !contagem ? 0 : Math.max(0, contagem.todos - compromissos.length)),
    [contagem, compromissos.length, aba, diaSelecionado],
  );

  function limparFiltros() {
    setBusca('');
    setBuscaDeb('');
    setTipo('');
    setResponsaveis([]);
    setSomenteResponsavel(false);
    setPessoa(undefined);
    setReservaDe(undefined);
    setSoUrgentes(false);
    // A aba fica: ela não é um filtro escondido, está destacada no topo.
  }

  /*
    O ATENDIMENTO ENTRA NAS CHAVES (15/09/2026). Concluir a consulta fecha o
    atendimento de origem; reabrir, cancelar e remarcar mudam a fila dele. Sem
    as duas chaves, a lista de Atendimentos e a gaveta aberta continuavam
    dizendo "Aguardando a consulta" de um atendimento já concluído.
  */
  const invalidar = () => {
    for (const k of [['compromissos'], ['compromisso'], ['minhas-pendencias'], ['dashboard-resumo'], ['atendimentos'], ['atendimento']]) {
      qc.invalidateQueries({ queryKey: k });
    }
  };

  const status = useMutation({
    mutationFn: ({ id, status }: { id: string; status: StatusCompromisso }) => mudarStatusCompromisso(id, status),
    // Reabrir a consulta concluída devolve o atendimento que voltou a aguardar (15/09/2026): o aviso diz qual.
    onSuccess: (r: { atendimentoReaberto?: { id: string; numero: number } | null } | null | undefined) => {
      const aviso = avisoDeReaberta(r);
      if (aviso) toast.success(aviso);
      invalidar();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível mudar a situação da atividade.'),
  });
  const remover = useMutation({
    mutationFn: (id: string) => excluirCompromisso(id),
    onSuccess: () => { toast.success('Atividade excluída.'); setExcluir(null); invalidar(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível excluir.'),
  });

  const onEditar = (c: Compromisso) => { setDetalheId(null); setEditar(c); setFormOpen(true); };
  const onAbrir = (c: Compromisso) => setDetalheId(c.id);
  const onNovo = () => { setEditar(null); setFormOpen(true); };
  /**
   * SAIR DE UMA COLUNA FECHADA É REABRIR, e reabrir apaga o desfecho do cartão
   * — passa pelo diálogo. Iniciar e voltar para pendente a partir de uma
   * atividade ABERTA continuam num toque só: não apagam nada.
   */
  const onAcao = (id: string, s: StatusCompromisso) => {
    const c = compromissos.find((x) => x.id === id);
    if (c && estaFechado(c.status)) return onReabrir(c, s);
    status.mutate({ id, status: s });
  };
  const onReabrir = (c: Compromisso, destino: StatusCompromisso) => {
    setDetalheId(null);
    setReabrir({ c, destino });
  };
  // Fecham o detalhe antes de abrir o diálogo — dois modais empilhados confundem.
  const onConcluir = (c: Compromisso) => { setDetalheId(null); setConcluir(c); };
  const onCancelar = (c: Compromisso) => { setDetalheId(null); setCancelar(c); };
  const onRemarcar = (c: Compromisso) => { setDetalheId(null); setRemarcar(c); };

  function mudarMes(delta: number) {
    // Trocar de mês solta o dia selecionado: manter um filtro apontando para um
    // dia que saiu da tela deixaria o quadro vazio sem motivo visível.
    setDiaSelecionado(null);
    setMes((m) => (delta === 0 ? new Date() : new Date(m.getFullYear(), m.getMonth() + delta, 1)));
  }

  function alternarCalendario() {
    gravarPreferencia(CHAVE_CALENDARIO, calendarioAberto ? '0' : '1', 'local');
    // Fechar o calendário sem soltar o dia deixaria o quadro filtrado por um
    // controle que não está mais visível.
    if (calendarioAberto) setDiaSelecionado(null);
  }

  /*
    Recortes que chegam pela URL e não têm controle próprio na tela: cada um
    vira uma etiqueta que diz o que está valendo e sai num toque.
  */
  const etiquetas: { chave: string; rotulo: string; tirar: () => void }[] = [];
  if (pessoa && !soAsMinhas) {
    etiquetas.push({ chave: 'pessoa', rotulo: `De ${nomeDe(pessoa)}`, tirar: () => setPessoa(undefined) });
  }
  if (reservaDe) {
    etiquetas.push({
      chave: 'reserva',
      rotulo: reservaDe === user?.id ? 'Onde você é reserva' : `Onde ${nomeDe(reservaDe)} é reserva`,
      tirar: () => setReservaDe(undefined),
    });
  }
  if (somenteResponsavel && responsaveis.length > 0) {
    etiquetas.push({ chave: 'so-responsavel', rotulo: 'Só onde responde', tirar: () => setSomenteResponsavel(false) });
  }

  /*
    "MINHAS", TIPO, RESPONSÁVEIS E URGENTES — os mesmos controles em dois
    lugares: em linha a partir de sm e dentro do Sheet "Filtros" no celular,
    onde empilhados empurravam o primeiro cartão para depois de 500px.
  */
  const controles = (
    <>
      {/*
        "MINHAS" é a régua `daPessoa` — a mesma do painel e da faixa. Só aparece
        para quem tem alguma coisa: coordenação e administração costumam olhar
        o quadro dos outros, e um "Minhas 0" seria um convite a um lugar vazio.
      */}
      {!!user?.id && (soAsMinhas || minhasEmAberto > 0) && (
        <button
          type="button"
          onClick={() => setPessoa(soAsMinhas ? undefined : user.id)}
          aria-pressed={soAsMinhas}
          className={cn(
            'flex h-12 w-full items-center gap-2 rounded-md border px-3 text-sm font-medium transition sm:h-10 sm:w-auto',
            soAsMinhas
              ? 'border-brand-500 bg-brand-50 text-brand-900 dark:bg-brand-900/20 dark:text-brand-300'
              : 'border-input bg-background text-muted-foreground hover:bg-muted',
          )}
        >
          <UserCheck className="h-4 w-4" />
          Minhas
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
              soAsMinhas ? 'bg-brand-800 text-white' : 'bg-muted text-foreground',
            )}
            title="Em aberto, onde você responde ou foi posta(o) por alguém"
          >
            {minhasEmAberto}
          </span>
        </button>
      )}

      <select className={inputCls} value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Tipo">
        <option value="">Todos os tipos</option>
        {tipos.map((t) => <option key={t.id} value={t.slug}>{t.nome}</option>)}
      </select>

      <SeletorResponsaveis
        pessoas={responsaveisLista}
        selecionados={responsaveis}
        onChange={(ids) => { setResponsaveis(ids); if (ids.length === 0) setSomenteResponsavel(false); }}
        meuId={user?.id}
      />

      <button
        type="button"
        onClick={() => setSoUrgentes((v) => !v)}
        aria-pressed={soUrgentes}
        className={cn(
          'flex h-12 w-full items-center gap-2 rounded-md border px-3 text-sm font-medium transition sm:h-10 sm:w-auto',
          soUrgentes
            ? 'border-red-400 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300'
            : 'border-input bg-background text-muted-foreground hover:bg-muted',
        )}
      >
        <Flame className="h-4 w-4" /> Urgentes
        {!!contagem?.urgentes && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-foreground">
            {contagem.urgentes}
          </span>
        )}
      </button>
    </>
  );

  /*
    Na lista, o grupo "Ficaram para trás" já diz isto no topo, com a mesma
    saída. Mostrar a faixa também seria dizer o mesmo atraso duas vezes.
  */
  const atrasadasHoje = aba === 'hoje' && !diaSelecionado && visao === 'quadro' ? contagem?.atrasadas ?? 0 : 0;

  /*
    O estado da consulta que a tela está mostrando agora. Com um dia escolhido,
    é a do mês (15/09/2026): a do recorte nem é pedida.
  */
  const erroDaVez = diaSelecionado
    ? doMes.isError && !doMes.data
    : listaDeTodas ? todas.isError && !todas.data : quadro.isError && !quadro.data;
  const carregandoDaVez = diaSelecionado ? doMes.isLoading : listaDeTodas ? todas.isLoading : quadro.isLoading;
  const buscandoDaVez = diaSelecionado
    ? doMes.isFetching
    : listaDeTodas ? todas.isFetching && !todas.isFetchingNextPage : quadro.isFetching;
  /** Trocando de aba ou de Próximas para Anteriores: os cartões à vista ainda são os de antes. */
  const trocandoDaVez = !diaSelecionado && (listaDeTodas ? todas.isPlaceholderData : quadro.isPlaceholderData);
  const tentarDeNovo = () => (diaSelecionado ? doMes.refetch() : listaDeTodas ? todas.refetch() : quadro.refetch());

  const totalDaJanela = janelaDosDados === 'anteriores' ? contagem?.todosAnteriores : contagem?.todosAdiante;
  /** O número da linha de filtros e do botão do celular: o recorte, não as páginas. */
  const noRecorte = quantasNoRecorte({ listaDeTodas, carregadas: filtrados.length, totalDaJanela });
  const vazioDaLista = diaSelecionado
    ? 'Nenhuma atividade neste dia.'
    : aba === 'atrasadas'
      ? 'Nada ficou para trás.'
      : listaDeTodas && janelaDosDados === 'anteriores'
        ? 'Nenhuma atividade encerrada nos últimos 60 dias.'
        : 'Nenhuma atividade.';
  const vazioDeHoje =
    aba === 'atencao' ? 'Nada de hoje passou da hora.' : aba === 'aberto' ? 'Nada em aberto para hoje.' : 'Nenhuma atividade hoje.';

  const botaoVisao = (valor: VisaoDaAgenda, rotulo: string, Icone: typeof List) => (
    <button
      type="button"
      aria-pressed={visao === valor}
      onClick={() => escolherVisao(valor)}
      className={cn(
        'flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors sm:min-h-8 sm:flex-none',
        visao === valor ? 'bg-brand-800 text-white shadow-sm' : 'text-muted-foreground hover:bg-muted',
      )}
    >
      <Icone className="h-4 w-4" /> {rotulo}
    </button>
  );

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-900/30">
            <CalendarClock className="h-5 w-5 text-brand-800 dark:text-brand-400" />
          </div>
          <div className="min-w-0">
            <h2 className="text-2xl font-bold">Agenda e Prazos</h2>
            <p className="text-sm text-muted-foreground">Audiências, prazos e demais atividades</p>
          </div>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => setTiposOpen(true)}>
            <SlidersHorizontal className="h-4 w-4" /> Tipos
          </Button>
          {podeEditar && (
            <Button className="flex-1 sm:flex-none" onClick={onNovo}>
              <Plus className="h-4 w-4" /> Nova atividade
            </Button>
          )}
        </div>
      </div>

      {/* Abas (recortes do servidor) + visão + calendário */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
          {RECORTES.map((r) => {
            const n = contagem?.[r.chave];
            const ativa = aba === r.valor && !diaSelecionado;
            const pedeOlhar = (r.valor === 'atrasadas' || r.valor === 'atencao') && !!n;
            return (
              <button
                key={r.valor}
                type="button"
                title={r.ajuda}
                aria-pressed={ativa}
                onClick={() => { setAba(r.valor); setDiaSelecionado(null); }}
                className={cn(
                  'flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors sm:h-9',
                  ativa ? 'bg-brand-800 text-white shadow-sm' : 'text-muted-foreground hover:bg-muted',
                )}
              >
                {r.rotulo}
                {n !== undefined && (
                  <span
                    className={cn(
                      'rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
                      ativa
                        ? 'bg-white/20 text-white'
                        : pedeOlhar
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                          : 'bg-muted text-foreground',
                    )}
                  >
                    {n}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Quadro ou lista: a mesma agenda, dois jeitos de ler. */}
          <div role="group" aria-label="Visão" className="flex flex-1 rounded-lg border border-input bg-card p-1 sm:flex-none">
            {botaoVisao('quadro', 'Quadro', Columns3)}
            {botaoVisao('lista', 'Lista', List)}
          </div>
          {/* O calendário não é uma visão alternativa: o botão só o recolhe,
              para quem precisa da tela toda no celular. */}
          {/*
            No celular o texto é só "Calendário" (15/09/2026): "Ocultar
            calendário" quebrava em duas linhas ao lado de Quadro | Lista. A seta
            diz o estado, e o nome acessível continua completo.
          */}
          <button
            type="button"
            onClick={alternarCalendario}
            className="flex h-11 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-input bg-card px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted sm:h-9 sm:flex-none"
            aria-expanded={calendarioAberto}
            aria-label={calendarioAberto ? 'Ocultar calendário' : 'Mostrar calendário'}
          >
            <CalendarDays className="h-4 w-4" />
            <span className="sm:hidden">Calendário</span>
            <span className="hidden sm:inline">{calendarioAberto ? 'Ocultar calendário' : 'Mostrar calendário'}</span>
            <ChevronUp className={cn('h-3.5 w-3.5 transition', !calendarioAberto && 'rotate-180')} />
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="space-y-2">
        <div className="flex gap-2 sm:flex-wrap sm:items-center">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Título, filiado, NPU ou parte"
              aria-label="Buscar por título, filiado, número do processo ou parte"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
            {buscandoDaVez && (
              <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
          </div>

          {/* Celular: um botão só no lugar de quatro controles empilhados. */}
          <button
            type="button"
            onClick={() => setFiltrosAbertos(true)}
            className={cn(
              'flex h-12 shrink-0 items-center gap-2 rounded-md border px-3 text-sm font-medium sm:hidden',
              filtrosNoBotao > 0
                ? 'border-brand-500 bg-brand-50 text-brand-900 dark:bg-brand-900/20 dark:text-brand-300'
                : 'border-input bg-background text-muted-foreground',
            )}
          >
            <ListFilter className="h-4 w-4" />
            Filtros{filtrosNoBotao > 0 ? ` (${filtrosNoBotao})` : ''}
          </button>

          <div className="hidden sm:contents">{controles}</div>
        </div>

        {/*
          O RESUMO DO RECORTE só existe quando a pessoa ligou algum filtro. É ali
          que fica o botão de desfazer — quem se perde num filtro procura a saída
          perto do resultado, não no controle que usou.
        */}
        {(filtrosAtivos > 0 || etiquetas.length > 0) && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              {filtrosAtivos} filtro{filtrosAtivos === 1 ? '' : 's'} ativo{filtrosAtivos === 1 ? '' : 's'} ·{' '}
              <strong className="text-foreground">{noRecorte}</strong> atividade
              {noRecorte === 1 ? '' : 's'} encontrada{noRecorte === 1 ? '' : 's'}
            </span>
            {etiquetas.map((e) => (
              <button
                key={e.chave}
                type="button"
                onClick={e.tirar}
                className="inline-flex min-h-8 items-center gap-1 rounded-full border border-brand-300 bg-brand-50 px-2.5 font-medium text-brand-900 transition hover:bg-brand-100 dark:border-brand-800 dark:bg-brand-900/20 dark:text-brand-300"
                aria-label={`Tirar o filtro: ${e.rotulo}`}
              >
                {e.rotulo} <X className="h-3 w-3" />
              </button>
            ))}
            {/*
              A SAÍDA FICA ONDE O RESULTADO SUMIU. Um toque em "ver todas" resolve
              o caso comum (o que se procura existe, só não é nesta aba).
            */}
            {foraDaAba > 0 && filtrados.length === 0 && (
              <button
                type="button"
                onClick={() => setAba('todos')}
                className="inline-flex min-h-8 items-center rounded-full border border-brand-400 px-2.5 font-medium text-brand-800 transition hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-900/20"
              >
                {foraDaAba === 1 ? '1 em outra data' : `${foraDaAba} em outras datas`} — ver todas
              </button>
            )}
            <button
              type="button"
              onClick={limparFiltros}
              className="min-h-8 font-medium text-brand-800 hover:underline dark:text-brand-400"
            >
              Limpar filtros
            </button>
          </div>
        )}
      </div>

      {/*
        "HOJE" INCLUI O QUE FICOU PARA TRÁS. A faixa do topo acusava atrasadas e
        a agenda abria sem elas; agora elas vêm no quadro, no topo, com a data em
        âmbar — e esta linha diz isso uma vez, com a saída para vê-las sozinhas.
      */}
      {atrasadasHoje > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
          <span className="flex items-start gap-2">
            {/* O relógio, como no grupo âmbar da lista: ficou para trás não é perigo. */}
            <Clock className="mt-0.5 h-4 w-4 shrink-0" />
            {atrasadasHoje === 1
              ? '1 atividade de dias anteriores ficou para trás e está no topo, com a data em âmbar.'
              : `${atrasadasHoje} atividades de dias anteriores ficaram para trás e estão no topo, com a data em âmbar.`}
          </span>
          <button
            type="button"
            onClick={() => setAba('atrasadas')}
            className="min-h-9 font-medium underline-offset-2 hover:underline"
          >
            Ver só essas
          </button>
        </div>
      )}

      {/* Aviso do dia filtrado — acima do quadro, onde a lista encolheu. */}
      {diaSelecionado && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand-300 bg-brand-50 px-3 py-2 text-sm dark:border-brand-800 dark:bg-brand-900/20">
          <span className="flex items-center gap-1.5">
            <CalendarDays className="h-4 w-4 text-brand-800 dark:text-brand-400" />
            Mostrando <strong>{filtrados.length}</strong> atividade{filtrados.length === 1 ? '' : 's'} de{' '}
            <strong>{diaSelecionado.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' })}</strong>
          </span>
          <button
            type="button"
            onClick={() => setDiaSelecionado(null)}
            className="min-h-9 font-medium text-brand-800 hover:underline dark:text-brand-400"
          >
            Limpar filtro do dia
          </button>
        </div>
      )}

      {/* Próximas | Anteriores — só em Todas, na lista. */}
      {listaDeTodas && (
        <SeletorDaJanela
          janela={janela}
          onMudar={setJanela}
          adiante={contagem?.todosAdiante}
          anteriores={contagem?.todosAnteriores}
        />
      )}

      {/* Quadro ou lista */}
      {erroDaVez ? (
        <div
          role="alert"
          className="flex flex-col items-start gap-3 rounded-xl border border-dashed p-5 text-sm sm:flex-row sm:items-center sm:justify-between"
        >
          <span>Não deu para carregar a agenda. Confira a conexão e tente de novo.</span>
          <Button variant="outline" onClick={tentarDeNovo}>
            <RotateCw className="h-4 w-4" /> Tentar de novo
          </Button>
        </div>
      ) : carregandoDaVez ? (
        <Carregando texto="Carregando as atividades…">
          {visao === 'lista' ? <EsqueletoDaLista /> : <EsqueletoDoQuadro />}
        </Carregando>
      ) : visao === 'lista' ? (
        /*
          ENTRADA E TROCA (15/09/2026). O invólucro surge quando a primeira carga
          termina; enquanto Próximas vira Anteriores (ou a aba troca), os cartões
          antigos ficam esmaecidos, que é o sinal de que o toque foi ouvido. A
          opacidade mora no filho para a transição não disputar com a animação.
        */
        <div className="animate-surgir">
        <div
          className={cn('space-y-3 transition-opacity', trocandoDaVez && 'opacity-60')}
          aria-busy={trocandoDaVez || undefined}
        >
          <ListaPorDia
            grupos={grupos}
            vazio={vazioDaLista}
            vazioDeHoje={vazioDeHoje}
            onVerSoParaTras={aba !== 'atrasadas' ? () => setAba('atrasadas') : undefined}
            totalParaTras={totalDoGrupoParaTras({
              listaDeTodas, janelaDosDados, temProxima: temProximaEmTodas, atrasadas: contagem?.atrasadas,
            })}
            onAbrir={onAbrir}
            onEditar={onEditar}
            onVerTriagem={setTriagemId}
            onAcao={onAcao}
            onConcluir={onConcluir}
            onCancelar={onCancelar}
            onRemarcar={onRemarcar}
            onExcluir={setExcluir}
            podeExcluir={ehAdmin}
            podeEditar={podeEditar}
            apontado={destacado}
            meuId={quadroCompartilhado ? user?.id : undefined}
            onNovo={onNovo}
          />
          {listaDeTodas && (
            <RodapeDaPaginacao
              mostrando={itensDeTodas.length}
              total={totalDaJanela}
              {...estadoDoRodape(todas)}
              onCarregarMais={() => todas.fetchNextPage()}
            />
          )}
        </div>
        </div>
      ) : (
        <div className="animate-surgir">
        <div className={cn('transition-opacity', trocandoDaVez && 'opacity-60')} aria-busy={trocandoDaVez || undefined}>
        <KanbanView
          compromissos={filtrados}
          onAbrir={onAbrir}
          onEditar={onEditar}
          onVerTriagem={setTriagemId}
          onAcao={onAcao}
          onReabrir={onReabrir}
          onConcluir={onConcluir}
          onCancelar={onCancelar}
          onRemarcar={onRemarcar}
          onExcluir={setExcluir}
          podeExcluir={ehAdmin}
          podeEditar={podeEditar}
          apontado={destacado}
          /*
            A MARCA DE "É SUA" só vai quando o quadro é de mais gente — num
            quadro filtrado em mim, marcar tudo não distingue nada.
          */
          meuId={quadroCompartilhado ? user?.id : undefined}
          /*
            A COLUNA VAZIA DE "PENDENTE" OFERECE CRIAR — só a quem pode criar.
            Sem os contêineres à vista, o quadro deixa de ser um lugar onde
            trabalho cabe e vira um aviso de que não há trabalho.
          */
          onNovo={onNovo}
        />
        </div>
        </div>
      )}

      {/* CALENDÁRIO — abaixo do quadro. O trabalho do dia está nos cards; o
          calendário é consulta ("o que tem no dia 14?"). */}
      {calendarioAberto && (
        <div className="space-y-2">
          {doMes.isError && !doMes.data && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed px-3 py-2 text-sm">
              <span>Não deu para carregar os dias deste mês.</span>
              <button
                type="button"
                onClick={() => doMes.refetch()}
                className="min-h-9 font-medium text-brand-800 hover:underline dark:text-brand-400"
              >
                Tentar de novo
              </button>
            </div>
          )}
          <CalendarioView
            compromissos={compromissosDoMes}
            carregando={doMes.isLoading}
            mes={mes}
            onMudarMes={mudarMes}
            onSelecionar={onAbrir}
            diaSelecionado={diaSelecionado}
            onSelecionarDia={setDiaSelecionado}
          />
        </div>
      )}

      {/* Filtros no celular */}
      <Sheet open={filtrosAbertos} onClose={() => setFiltrosAbertos(false)} side="bottom" className="sm:hidden">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="font-semibold">Filtros</p>
          <button
            type="button"
            onClick={() => setFiltrosAbertos(false)}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
            aria-label="Fechar filtros"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">{controles}</div>
        <div className="flex gap-2 border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {filtrosAtivos > 0 && (
            <Button variant="outline" className="flex-1" onClick={limparFiltros}>
              Limpar
            </Button>
          )}
          <Button className="flex-1" onClick={() => setFiltrosAbertos(false)}>
            Ver {noRecorte} atividade{noRecorte === 1 ? '' : 's'}
          </Button>
        </div>
      </Sheet>

      {/* Modal criar/editar */}
      <CompromissoFormModal open={formOpen} onClose={() => setFormOpen(false)} onSalvo={invalidar} editar={editar} />

      {/* Gaveta de DETALHE (clique no card) */}
      <CompromissoDrawer
        compromissoId={detalheId}
        open={!!detalheId}
        onClose={() => setDetalheId(null)}
        onEditar={onEditar}
        onConcluir={onConcluir}
        onCancelar={onCancelar}
        onRemarcar={onRemarcar}
        onAcao={onAcao}
        onExcluir={(c) => { setDetalheId(null); setExcluir(c); }}
        onVerTriagem={(id) => { setDetalheId(null); setTriagemId(id); }}
        podeExcluir={ehAdmin}
      />

      {/* Concluir com desfecho — pode abrir um caso pré-processual */}
      <ConcluirModal
        compromisso={concluir}
        open={!!concluir}
        onClose={() => setConcluir(null)}
        /*
          "Não compareceu?" só faz sentido quando alguém era esperado: há um
          filiado e a atividade tem hora marcada. Num prazo do robô, a pergunta
          não tem resposta. Quem não compareceu não realizou a atividade: o
          atalho leva ao cancelamento, já com a categoria certa.
        */
        onNaoCompareceu={
          concluir?.filiado && temHoraMarcada(concluir.tipo)
            ? () => { setCancelarCategoria('NAO_COMPARECEU'); setCancelar(concluir); }
            : undefined
        }
        onConcluido={(caso) => {
          // As mesmas chaves do painel: lista de Processos E a ficha aberta (13/09/2026).
          for (const k of CHAVES_DEPOIS_DE_CONCLUIR) qc.invalidateQueries({ queryKey: k });
          for (const k of [['atendimentos'], ['atendimento']]) qc.invalidateQueries({ queryKey: k });
          // A consulta concluída fecha o atendimento de origem (15/09/2026): a lista e a gaveta dele mudam junto.
          if (caso) {
            toast.success('Caso aberto em fase pré-processual.', {
              description: 'Fica na aba Pré-processuais até ser ajuizado.',
              action: { label: 'Abrir', onClick: () => router.push('/processos?preProcessuais=1') },
            });
          }
        }}
      />

      {/* Cancelar — categoria obrigatória */}
      <ReabrirModal
        compromisso={reabrir?.c ?? null}
        destino={reabrir?.destino ?? 'PENDENTE'}
        open={!!reabrir}
        onClose={() => setReabrir(null)}
        onPronto={invalidar}
      />
      <CancelarModal
        compromisso={cancelar}
        open={!!cancelar}
        categoriaInicial={cancelarCategoria}
        onClose={() => { setCancelar(null); setCancelarCategoria(undefined); }}
        onCancelado={invalidar}
      />

      {/* Remarcar — só data/hora e o porquê */}
      <RemarcarModal
        compromisso={remarcar}
        open={!!remarcar}
        onClose={() => setRemarcar(null)}
        onRemarcado={invalidar}
      />

      {/* Tipos de atividade (cadastro) */}
      <TiposEventoModal
        open={tiposOpen}
        onClose={() => setTiposOpen(false)}
        podeEditar={podeEditar}
        podeExcluir={ehAdmin}
        onChanged={() => qc.invalidateQueries({ queryKey: ['compromissos'] })}
      />

      {/* Ponte com a triagem */}
      <AtendimentoDrawer
        atendimentoId={triagemId}
        open={!!triagemId}
        onClose={() => setTriagemId(null)}
        onMudou={invalidar}
        onRegistrarDesfecho={(a) => { setTriagemId(null); setDesfechoAlvo(a); }}
      />
      {/*
        O MESMO MODAL DA TELA DE ATENDIMENTOS (15/09/2026). Ao fechar, a gaveta
        do atendimento volta: é de onde a pessoa veio, e é ali que "Concluir
        atendimento" aparece para o resolvido no ato, sem um segundo "Concluir
        agora?" escrito aqui.
      */}
      <RegistrarDesfechoModal
        open={!!desfechoAlvo}
        atendimento={desfechoAlvo}
        onClose={() => { const voltar = desfechoAlvo?.id ?? null; setDesfechoAlvo(null); setTriagemId(voltar); }}
        onRegistrado={invalidar}
      />

      {/* Excluir */}
      <ConfirmDialog
        open={!!excluir}
        variant="destructive"
        title="Excluir atividade"
        icon={<Trash2 className="h-6 w-6" />}
        description={<>Excluir a atividade <strong>{excluir?.titulo}</strong> da agenda? Esta ação é irreversível.</>}
        confirmLabel="Excluir atividade"
        loading={remover.isPending}
        onConfirm={() => excluir && remover.mutate(excluir.id)}
        onClose={() => setExcluir(null)}
      />
    </div>
  );
}
