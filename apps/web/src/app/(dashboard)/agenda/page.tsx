'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Loader2, Plus, Search, CalendarClock, CalendarDays, SlidersHorizontal, Trash2, ChevronUp,
  UserCheck, Flame,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { nivelEfetivo, podeExcluir } from '@/lib/permissoes';
import { KanbanView } from '@/components/agenda/kanban-view';
import { SeletorResponsaveis } from '@/components/agenda/seletor-responsaveis';
import { CalendarioView } from '@/components/agenda/calendario-view';
import { CompromissoFormModal } from '@/components/agenda/compromisso-form-modal';
import { CompromissoDrawer } from '@/components/agenda/compromisso-drawer';
import { TiposEventoModal } from '@/components/agenda/tipos-evento-modal';
import { AlertasBar } from '@/components/agenda/alertas-bar';
import { ConcluirModal } from '@/components/agenda/concluir-modal';
import { CancelarModal } from '@/components/agenda/cancelar-modal';
import { RemarcarModal } from '@/components/agenda/remarcar-modal';
import { AtendimentoDrawer } from '@/components/atendimentos/atendimento-drawer';
import { useTiposEvento } from '@/lib/use-tipos-evento';
import { useAbrirPorUrl, useFiltroPorUrl } from '@/lib/use-abrir-por-url';
import {
  listarCompromissos, mudarStatusCompromisso, excluirCompromisso, listarResponsaveis, ehMinha,
  Compromisso, StatusCompromisso, TipoCompromisso,
} from '@/lib/agenda';
import { chaveLocal } from '@/lib/armazenamento';

type Aba = 'todos' | 'aberto' | 'hoje' | '7dias' | 'urgentes';
/** Lembra se o calendário fica aberto — a escolha vale por navegador. */
const CHAVE_CALENDARIO = chaveLocal('agenda', 'calendario-aberto');
const inputCls = 'h-12 rounded-md border border-input bg-background px-3 text-base sm:h-10 sm:text-sm';

const ABAS: { key: Aba; label: string }[] = [
  { key: 'todos', label: 'Todos' },
  { key: 'aberto', label: 'Em aberto' },
  { key: 'hoje', label: 'Hoje' },
  { key: '7dias', label: '7 dias' },
  { key: 'urgentes', label: 'Urgentes' },
];

function gradeDoMes(mes: Date) {
  const primeiro = new Date(mes.getFullYear(), mes.getMonth(), 1);
  const ini = new Date(primeiro);
  ini.setDate(1 - primeiro.getDay());
  const fim = new Date(ini);
  fim.setDate(ini.getDate() + 42);
  return { dataInicio: ini.toISOString(), dataFim: fim.toISOString() };
}

/**
 * O QUE É MEU SOBE — e só quando o quadro mostra o de mais gente.
 *
 * Abrir a agenda e ver primeiro o trabalho dos outros é o atrito diário de
 * quem usa isto: são oito pessoas no quadro, e a pergunta que se faz ao
 * chegar é "o que É MEU hoje?". Ordenar resolve sem esconder nada de ninguém
 * — nenhuma atividade sai da tela, elas só mudam de lugar dentro da coluna.
 *
 * FILTRADO EM UMA PESSOA SÓ, NÃO FAZ NADA. Se o quadro já é só meu, "meu
 * primeiro" não significa coisa alguma — e a marca visual no cartão viraria
 * um enfeite repetido em todas as linhas.
 */
function minhasPrimeiro(cs: Compromisso[], meuId: string | undefined, aplicar: boolean): Compromisso[] {
  if (!aplicar || !meuId) return cs;
  // Estável: dentro de cada grupo a ordem por data que veio da API se mantém.
  return [...cs].sort((a, b) => Number(ehMinha(b, meuId)) - Number(ehMinha(a, meuId)));
}

/** Filtro por aba (client-side, sobre os compromissos carregados). */
function aplicarAba(cs: Compromisso[], aba: Aba): Compromisso[] {
  if (aba === 'todos') return cs;
  const agora = new Date();
  if (aba === 'aberto') return cs.filter((c) => c.status === 'PENDENTE' || c.status === 'EM_ANDAMENTO');
  if (aba === 'urgentes') return cs.filter((c) => c.urgente);
  if (aba === 'hoje') {
    return cs.filter((c) => {
      const d = new Date(c.inicio);
      return d.getFullYear() === agora.getFullYear() && d.getMonth() === agora.getMonth() && d.getDate() === agora.getDate();
    });
  }
  if (aba === '7dias') {
    const lim = new Date(agora.getTime() + 7 * 86400_000);
    return cs.filter((c) => { const d = new Date(c.inicio); return d >= new Date(agora.toDateString()) && d <= lim; });
  }
  return cs;
}

/**
 * `useSearchParams` obriga a um limite de Suspense — sem ele o build do Next
 * falha ao pré-renderizar a rota. Mesmo padrão já usado em Processos.
 */
export default function AgendaPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-brand-800 dark:text-brand-400" />
        </div>
      }
    >
      <AgendaConteudo />
    </Suspense>
  );
}

function AgendaConteudo() {
  const qc = useQueryClient();
  const router = useRouter();
  const { user } = useAuth();
  const ehAdmin = podeExcluir(user?.role);
  const podeEditar = nivelEfetivo(user?.role, user?.permissoes, 'agenda') === 'EDITAR';
  const { tipos } = useTiposEvento();

  const [calendarioAberto, setCalendarioAberto] = useState(true);
  /** Dia clicado no calendário; filtra o quadro logo abaixo. */
  const [diaSelecionado, setDiaSelecionado] = useState<Date | null>(null);
  const [aba, setAba] = useState<Aba>('hoje');
  const [busca, setBusca] = useState('');
  const [buscaDeb, setBuscaDeb] = useState('');
  const [tipo, setTipo] = useState<'' | TipoCompromisso>('');
  /** Vários responsáveis ao mesmo tempo — vazio significa "todos". */
  const [responsaveis, setResponsaveis] = useState<string[]>([]);
  const [soUrgentes, setSoUrgentes] = useState(false);
  const [mes, setMes] = useState(() => new Date());
  const [tiposOpen, setTiposOpen] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editar, setEditar] = useState<Compromisso | null>(null);
  const [detalheId, setDetalheId] = useState<string | null>(null);
  /**
   * Id que chegou pela URL e ainda não foi posicionado no quadro.
   *
   * O ATALHO ABRIA A GAVETA E DEIXAVA O FUNDO ERRADO. Clicando numa publicação
   * do painel, a pessoa caía em `/agenda` na aba padrão ("Hoje"), via as três
   * colunas escritas "Sem atividades" — e por cima, uma gaveta com uma tarefa
   * do dia 10. Nada na tela ligava as duas coisas: não dava para saber em que
   * dia se estava nem de onde aquilo tinha vindo.
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
  const [excluir, setExcluir] = useState<Compromisso | null>(null);
  // Ações que exigem informação: cada uma tem o seu diálogo.
  const [concluir, setConcluir] = useState<Compromisso | null>(null);
  const [cancelar, setCancelar] = useState<Compromisso | null>(null);
  /** Categoria pré-escolhida quando o cancelamento vem de um atalho. */
  const [cancelarCategoria, setCancelarCategoria] = useState<string | undefined>();
  const [remarcar, setRemarcar] = useState<Compromisso | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setBuscaDeb(busca.trim()), 350);
    return () => clearTimeout(t);
  }, [busca]);

  /**
   * `?compromisso=<id>` abre a atividade direto.
   *
   * É o que faz um atalho de fora chegar em algum lugar: o painel, os alertas e
   * a aba Agenda do processo apontavam para `/agenda` puro, e o clique só
   * trocava de tela — a pessoa caía no quadro inteiro e procurava a atividade
   * na mão.
   */
  useAbrirPorUrl('compromisso', (id) => { setDetalheId(id); setVeioDeFora(id); }, '/agenda');
  // Atalhos do painel: `?aba=urgentes`, `?aba=hoje`… Só abas conhecidas passam,
  // senão um link velho deixaria a tela num estado que não existe mais.
  useFiltroPorUrl(
    'aba',
    (v) => { if (ABAS.some((a) => a.key === v)) setAba(v as Aba); },
    '/agenda',
  );

  const consultaResponsaveis = useQuery({ queryKey: ['compromissos-responsaveis'], queryFn: listarResponsaveis });
  const responsaveisLista = consultaResponsaveis.data ?? [];

  // Preferência do calendário só existe no navegador — lida depois da montagem
  // para não divergir do HTML renderizado no servidor.
  useEffect(() => {
    if (localStorage.getItem(CHAVE_CALENDARIO) === '0') setCalendarioAberto(false);
  }, []);

  const rangeCal = useMemo(() => gradeDoMes(mes), [mes]);
  const filtroBase = {
    busca: buscaDeb || undefined,
    tipo: tipo || undefined,
    responsaveis: responsaveis.length ? responsaveis.join(',') : undefined,
    urgente: soUrgentes ? 'true' : undefined,
  };

  /**
   * DUAS consultas, de propósito.
   *
   * O quadro pede tudo e recorta por aba; o calendário pede a janela do mês.
   * Reaproveitar uma só quebraria um dos dois: a listagem da API devolve no
   * máximo 500 registros ordenados por data crescente, então uma consulta sem
   * intervalo entrega os 500 MAIS ANTIGOS — e o mês visível poderia nem estar
   * neles. Com o calendário agora sempre na tela, ele precisa da própria janela.
   */
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['compromissos', 'quadro', buscaDeb, tipo, responsaveis.join(','), soUrgentes],
    queryFn: () => listarCompromissos(filtroBase),
  });
  const doMes = useQuery({
    queryKey: ['compromissos', 'mes', buscaDeb, tipo, responsaveis.join(','), soUrgentes, rangeCal.dataInicio],
    queryFn: () => listarCompromissos({ ...filtroBase, ...rangeCal }),
  });

  const compromissos = data ?? [];

  /**
   * POSICIONA O QUADRO NA ATIVIDADE QUE O ATALHO ABRIU.
   *
   * Três coisas, e cada uma responde a uma pergunta que a tela deixava sem
   * resposta: a ABA passa a "Todos" quando a atual não contém a atividade
   * ("onde ela está?"), o CALENDÁRIO vai para o mês dela ("que dia é hoje
   * nisto?") e o CARTÃO ganha um anel ("o que eu cliquei?").
   *
   * Roda uma vez por chegada: `veioDeFora` é zerado no fim.
   */
  useEffect(() => {
    if (!veioDeFora || compromissos.length === 0) return;
    const alvo = compromissos.find((c) => c.id === veioDeFora);
    if (!alvo) return;

    const inicio = new Date(alvo.inicio);
    const hoje = new Date();
    const mesmoDia = inicio.toDateString() === hoje.toDateString();
    // "Hoje" e "7 dias" mentem sobre uma atividade que não cabe neles.
    const abaCabe =
      aba === 'todos' ||
      (aba === 'hoje' && mesmoDia) ||
      (aba === '7dias' && inicio.getTime() - hoje.getTime() < 7 * 86_400_000) ||
      (aba === 'aberto' && (alvo.status === 'PENDENTE' || alvo.status === 'EM_ANDAMENTO'));
    if (!abaCabe) setAba('todos');

    setMes(new Date(inicio.getFullYear(), inicio.getMonth(), 1));
    setDestacado(alvo.id);
    setVeioDeFora(null);
  }, [veioDeFora, compromissos, aba]);
  const compromissosDoMes = doMes.data ?? [];

  /**
   * Com um dia selecionado, o quadro mostra AQUELE dia e a aba é ignorada —
   * senão clicar em 20/ago com a aba "Hoje" ativa devolveria uma tela vazia,
   * sem explicar por quê. Os dados vêm da consulta do mês, que é a única que
   * garante ter o dia escolhido.
   */
  /**
   * O quadro mostra o trabalho de mais de uma pessoa? Só aí a ordenação por
   * "minhas" tem sentido — e só aí o cartão ganha a marca.
   */
  const quadroCompartilhado =
    !!user?.id && !(responsaveis.length === 1 && responsaveis[0] === user.id);

  const filtrados = useMemo(() => {
    const base = !diaSelecionado
      ? aplicarAba(compromissos, aba)
      : compromissosDoMes.filter((c) => {
          const d = new Date(c.inicio);
          return (
            d.getFullYear() === diaSelecionado.getFullYear() &&
            d.getMonth() === diaSelecionado.getMonth() &&
            d.getDate() === diaSelecionado.getDate()
          );
        });
    return minhasPrimeiro(base, user?.id, quadroCompartilhado);
  }, [diaSelecionado, compromissos, compromissosDoMes, aba, user?.id, quadroCompartilhado]);

  /** Quantas são minhas e ainda estão em aberto — o número do atalho "Minhas". */
  const minhasEmAberto = useMemo(
    () =>
      compromissos.filter(
        (c) => ehMinha(c, user?.id) && (c.status === 'PENDENTE' || c.status === 'EM_ANDAMENTO'),
      ).length,
    [compromissos, user?.id],
  );

  /** Quantos recortes estão valendo agora — alimenta a barra de resumo. */
  const filtrosAtivos =
    (buscaDeb ? 1 : 0) + (tipo ? 1 : 0) + (responsaveis.length ? 1 : 0) + (soUrgentes ? 1 : 0);

  function limparFiltros() {
    setBusca('');
    setTipo('');
    setResponsaveis([]);
    setSoUrgentes(false);
  }

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['compromissos'] });
    qc.invalidateQueries({ queryKey: ['compromisso'] });
    qc.invalidateQueries({ queryKey: ['agenda-alertas'] });
  };

  const status = useMutation({
    mutationFn: ({ id, status }: { id: string; status: StatusCompromisso }) => mudarStatusCompromisso(id, status),
    onSuccess: () => invalidar(),
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível mudar o status.'),
  });
  const remover = useMutation({
    mutationFn: (id: string) => excluirCompromisso(id),
    onSuccess: () => { toast.success('Evento excluído.'); setExcluir(null); invalidar(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível excluir.'),
  });

  const onEditar = (c: Compromisso) => { setDetalheId(null); setEditar(c); setFormOpen(true); };
  const onAbrir = (c: Compromisso) => setDetalheId(c.id);
  const onNovo = () => { setEditar(null); setFormOpen(true); };
  const onAcao = (id: string, s: StatusCompromisso) => status.mutate({ id, status: s });
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
    setCalendarioAberto((v) => {
      localStorage.setItem(CHAVE_CALENDARIO, v ? '0' : '1');
      // Fechar o calendário sem soltar o dia deixaria o quadro filtrado por um
      // controle que não está mais visível.
      if (v) setDiaSelecionado(null);
      return !v;
    });
  }

  return (
    <div className="space-y-5">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-900/30">
            <CalendarClock className="h-5 w-5 text-brand-800 dark:text-brand-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">Agenda e Prazos</h2>
            <p className="text-sm text-muted-foreground">Audiências, prazos e compromissos jurídicos</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setTiposOpen(true)}><SlidersHorizontal className="h-4 w-4" /> Tipos</Button>
          <Button onClick={onNovo}><Plus className="h-4 w-4" /> Novo Evento</Button>
        </div>
      </div>

      {/* Alertas */}
      <AlertasBar onAbrir={onAbrir} />

      {/* Abas + toggle de visão */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {ABAS.map((a) => (
            <button
              key={a.key}
              onClick={() => setAba(a.key)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                aba === a.key ? 'bg-brand-800 text-white shadow-sm' : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {a.label}
            </button>
          ))}
        </div>
        {/* O calendário deixou de ser uma visão alternativa: ele fica no topo e
            o botão apenas o recolhe, para quem precisa da tela toda no celular. */}
        <button
          onClick={alternarCalendario}
          className="flex items-center gap-1.5 rounded-lg border border-input bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
          aria-expanded={calendarioAberto}
        >
          <CalendarDays className="h-4 w-4" />
          {calendarioAberto ? 'Ocultar calendário' : 'Mostrar calendário'}
          <ChevronUp className={cn('h-3.5 w-3.5 transition', !calendarioAberto && 'rotate-180')} />
        </button>
      </div>

      {/* Filtros */}
      <div className="space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Buscar por nome…" value={busca} onChange={(e) => setBusca(e.target.value)} />
            {isFetching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
          </div>

          {/*
            "MINHAS" É O PRIMEIRO CONTROLE porque é a primeira pergunta de quem
            abre esta tela. Ele não esconde nada de ninguém: é um filtro que se
            liga e desliga num toque, e com ele desligado o que é meu continua
            aparecendo primeiro dentro de cada coluna.

            SÓ APARECE PARA QUEM TEM AGENDA. Coordenação e administração
            costumam olhar o quadro dos outros — um botão "Minhas" que devolve
            zero seria um convite a um lugar vazio.
          */}
          {!!user?.id && minhasEmAberto > 0 && (
            <button
              type="button"
              onClick={() =>
                setResponsaveis((atual) =>
                  atual.length === 1 && atual[0] === user.id ? [] : [user.id],
                )
              }
              aria-pressed={!quadroCompartilhado}
              className={cn(
                'flex h-12 items-center gap-2 rounded-md border px-3 text-sm font-medium transition sm:h-10',
                !quadroCompartilhado
                  ? 'border-brand-500 bg-brand-50 text-brand-900 dark:bg-brand-900/20 dark:text-brand-300'
                  : 'border-input bg-background text-muted-foreground hover:bg-muted',
              )}
            >
              <UserCheck className="h-4 w-4" />
              Minhas
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 text-[11px] font-semibold',
                  !quadroCompartilhado ? 'bg-brand-800 text-white' : 'bg-muted text-foreground',
                )}
              >
                {minhasEmAberto}
              </span>
            </button>
          )}

          <select className={inputCls} value={tipo} onChange={(e) => setTipo(e.target.value as any)} aria-label="Tipo">
            <option value="">Todos os tipos</option>
            {tipos.map((t) => <option key={t.id} value={t.slug}>{t.nome}</option>)}
          </select>

          <SeletorResponsaveis
            pessoas={responsaveisLista}
            selecionados={responsaveis}
            onChange={setResponsaveis}
            meuId={user?.id}
          />

          <button
            type="button"
            onClick={() => setSoUrgentes((v) => !v)}
            aria-pressed={soUrgentes}
            className={cn(
              'flex h-12 items-center gap-2 rounded-md border px-3 text-sm font-medium transition sm:h-10',
              soUrgentes
                ? 'border-red-400 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300'
                : 'border-input bg-background text-muted-foreground hover:bg-muted',
            )}
          >
            <Flame className="h-4 w-4" /> Urgentes
          </button>
        </div>

        {/*
          O RESUMO DO RECORTE só existe quando há recorte. Uma linha permanente
          dizendo "nenhum filtro" seria mais uma coisa para ler todo dia; a
          barra aparece quando a lista deixou de ser o todo, e é ali que fica o
          botão de desfazer — quem se perde num filtro procura a saída perto do
          resultado, não no controle que usou.
        */}
        {filtrosAtivos > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              {filtrosAtivos} filtro{filtrosAtivos === 1 ? '' : 's'} ativo{filtrosAtivos === 1 ? '' : 's'} ·{' '}
              <strong className="text-foreground">{filtrados.length}</strong> atividade
              {filtrados.length === 1 ? '' : 's'} à vista
            </span>
            <button
              type="button"
              onClick={limparFiltros}
              className="font-medium text-brand-800 hover:underline dark:text-brand-400"
            >
              Limpar filtros
            </button>
          </div>
        )}
      </div>

      {/* Aviso do dia filtrado. Fica ACIMA do quadro, e não junto do calendário:
          quem clicou num dia rola de volta para cima para ver os cards, e é lá
          que precisa entender por que a lista encolheu — e como desfazer. */}
      {diaSelecionado && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand-300 bg-brand-50 px-3 py-2 text-sm dark:border-brand-800 dark:bg-brand-900/20">
          <span className="flex items-center gap-1.5">
            <CalendarDays className="h-4 w-4 text-brand-800 dark:text-brand-400" />
            Mostrando <strong>{filtrados.length}</strong> atividade{filtrados.length === 1 ? '' : 's'} de{' '}
            <strong>{diaSelecionado.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' })}</strong>
          </span>
          <button
            onClick={() => setDiaSelecionado(null)}
            className="font-medium text-brand-800 hover:underline dark:text-brand-400"
          >
            Limpar filtro do dia
          </button>
        </div>
      )}

      {/* Quadro */}
      {isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-800 dark:text-brand-400" /></div>
      ) : (
        <KanbanView
          compromissos={filtrados}
          onAbrir={onAbrir}
          onEditar={onEditar}
          onVerTriagem={setTriagemId}
          onAcao={onAcao}
          onConcluir={onConcluir}
          onCancelar={onCancelar}
          onRemarcar={onRemarcar}
          onExcluir={setExcluir}
          podeExcluir={ehAdmin}
          apontado={destacado}
          /*
            A MARCA DE "É SEU" só vai quando o quadro é de mais gente — num
            quadro filtrado em mim, marcar tudo não distingue nada.
          */
          meuId={quadroCompartilhado ? user?.id : undefined}
          /*
            A COLUNA VAZIA DE "PENDENTE" OFERECE CRIAR.

            Eu tinha trocado as quatro colunas vazias por uma mensagem central,
            e estava errado: sem os contêineres à vista, o quadro deixa de ser
            um lugar onde trabalho cabe e vira um aviso de que não há trabalho.
            Num acervo em que quatro dos nove advogados têm zero atividades e
            mais de oitenta processos, isso confirma a crença errada.
          */
          onNovo={onNovo}
        />
      )}

      {/* CALENDÁRIO — abaixo do quadro. O trabalho do dia está nos cards; o
          calendário é consulta ("o que tem no dia 14?"). Clicar num dia filtra
          o quadro acima, então a rolagem sobe para o resultado. */}
      {calendarioAberto && (
        <CalendarioView
          compromissos={compromissosDoMes}
          mes={mes}
          onMudarMes={mudarMes}
          onSelecionar={onAbrir}
          diaSelecionado={diaSelecionado}
          onSelecionarDia={setDiaSelecionado}
        />
      )}

      {/* Modal criar/editar */}
      <CompromissoFormModal open={formOpen} onClose={() => setFormOpen(false)} onSalvo={invalidar} editar={editar} />

      {/* Drawer de DETALHE (clique no card) — lápis edita, lixeira exclui */}
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
        // Quem não compareceu não realizou a atividade: o atalho leva ao
        // cancelamento, já com a categoria certa.
        onNaoCompareceu={() => { setCancelarCategoria('NAO_COMPARECEU'); setCancelar(concluir); }}
        onConcluido={(caso) => {
          invalidar();
          qc.invalidateQueries({ queryKey: ['processos'] });
          if (caso) {
            toast.success('Caso aberto em fase pré-processual.', {
              description: 'Fica na aba Pré-processuais até ser ajuizado.',
              action: { label: 'Abrir', onClick: () => router.push('/processos?preProcessuais=1') },
            });
          }
        }}
      />

      {/* Cancelar — motivo obrigatório */}
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

      {/* Gerenciador de tipos de evento (CRUD) */}
      <TiposEventoModal
        open={tiposOpen}
        onClose={() => setTiposOpen(false)}
        podeEditar={podeEditar}
        podeExcluir={ehAdmin}
        onChanged={() => qc.invalidateQueries({ queryKey: ['compromissos'] })}
      />

      {/* Ponte com a triagem */}
      <AtendimentoDrawer atendimentoId={triagemId} open={!!triagemId} onClose={() => setTriagemId(null)} />

      {/* Excluir */}
      <ConfirmDialog
        open={!!excluir}
        variant="destructive"
        title="Excluir evento"
        icon={<Trash2 className="h-6 w-6" />}
        description={<>Excluir o evento <strong>{excluir?.titulo}</strong> da agenda? Esta ação é irreversível.</>}
        confirmLabel="Excluir evento"
        loading={remover.isPending}
        onConfirm={() => excluir && remover.mutate(excluir.id)}
        onClose={() => setExcluir(null)}
      />
    </div>
  );
}
