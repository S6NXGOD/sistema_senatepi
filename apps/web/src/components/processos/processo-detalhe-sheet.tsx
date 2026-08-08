'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  X, RefreshCw, Loader2, Landmark, FileText, CalendarDays, ShieldCheck, Trash2,
  Clock, History, Users, Search, Lock, Paperclip, Download, ArrowRight, ExternalLink,
  BadgeCheck, Gavel, Phone, Mail, GraduationCap, User as UserIcon, ScrollText,
  AlertTriangle, Plus, Tag, Bot, Newspaper, Layers, Inbox, Check, ChevronRight, PenLine,
  Archive, Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn, mascararCpf } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { nivelEfetivo, podeExcluir } from '@/lib/permissoes';
import { AnexosSection } from '@/components/anexos/anexos-section';
import { RegistrarMovimentacaoForm } from './registrar-movimentacao-form';
import {
  sincronizarProcesso, excluirProcesso, atualizarProcesso, formatNPU, formatData, formatDataHora,
  formatMoeda, STATUS_PROCESSO_COR, STATUS_PROCESSO_LABEL,
} from '@/lib/processos';
import { registrarMovimentacao } from '@/lib/movimentacoes';
import { corDesfecho, rotuloDesfecho, CATEGORIA_CANCELAMENTO_LABEL } from '@/lib/agenda';
import { EtiquetasInput } from './etiquetas-input';
import { PartesPanel } from './partes-panel';
import { VincularFiliadoModal } from './vincular-filiado-modal';
import {
  getDossie, excluirMovimentacao, listarTiposMovimentacao,
  rotuloTipoMov, corTipoMov, rotuloComplemento,
  categoriaMovimento, CATEGORIA_LABEL, CATEGORIA_COR,
  ehTituloGenerico, complementoPrincipal, rotuloGrau, urlConsultaTribunal, ATENCAO_COR, ATENCAO_LABEL,
  type ItemTimeline, type InstanciaProcesso, type CategoriaMovimento,
} from '@/lib/movimentacoes';
import {
  listarPublicacoes, sincronizarPublicacoes, statusDjen,
  PROVIDENCIA_LABEL, type PublicacaoDjen,
} from '@/lib/djen';
import { classesCor } from '@/lib/paleta-cores';
import { tenant } from '@/tenant.config';
import { V } from '@/lib/vocabulario';
import { chaveLocal } from '@/lib/armazenamento';

type Aba = 'timeline' | 'publicacoes' | 'notas' | 'documentos' | 'agenda' | 'partes' | 'auditoria';

const ABAS: { key: Aba; label: string; icon: any }[] = [
  { key: 'timeline', label: 'Linha do Tempo', icon: Clock },
  // Publicações fica ao lado da linha do tempo de propósito: é a mesma
  // pergunta ("o que aconteceu?") respondida com o teor, e não com o rótulo.
  { key: 'publicacoes', label: 'Publicações', icon: Newspaper },
  { key: 'notas', label: 'Notas Internas', icon: Lock },
  { key: 'documentos', label: 'Documentos', icon: FileText },
  { key: 'agenda', label: 'Agenda', icon: CalendarDays },
  // Antes era "Filiados". Virou "Partes" porque um processo tem dois lados: o
  // filiado é uma das partes, não a única coisa que a aba precisa mostrar.
  { key: 'partes', label: 'Partes', icon: Users },
  { key: 'auditoria', label: 'Auditoria', icon: History },
];

function CampoDossie({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-words text-sm font-medium">{children}</p>
    </div>
  );
}

/**
 * Por onde o processo passou — recolhido, mostrando só onde ele está AGORA.
 *
 * A lista inteira ocupava metade da ficha antes de qualquer coisa útil
 * aparecer, e ela responde a uma pergunta que raramente se faz ("por quais
 * varas isto já passou?"). A pergunta do dia a dia — "onde ele está?" — é
 * respondida pela primeira linha, que continua visível fechada. O resto abre
 * num clique.
 */
function TramiteOrgaos({
  historico,
}: {
  historico: { orgao: string; de: string; ate: string; atos: number }[];
}) {
  const [aberto, setAberto] = useState(false);
  const atual = historico[0];
  const periodo = (h: { de: string; ate: string; atos: number }) =>
    `${formatData(h.de)}${h.de !== h.ate ? ` — ${formatData(h.ate)}` : ''} · ${h.atos} ato${h.atos === 1 ? '' : 's'}`;

  return (
    <div className="mt-3 border-t pt-2">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="flex w-full items-center gap-1.5 rounded-md py-0.5 text-left transition hover:bg-muted/50"
      >
        <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', aberto && 'rotate-90')} />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Trâmite entre órgãos
        </span>
        <span className="rounded-full bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground">
          {historico.length}
        </span>
        {/* Fechado, a linha ainda diz o essencial: onde o processo está hoje. */}
        {!aberto && atual && (
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">{atual.orgao}</span>
            <span className="ml-1.5 rounded-full bg-brand-50 px-1.5 text-[9px] font-semibold text-brand-800 dark:bg-brand-900/40 dark:text-brand-400">
              atual
            </span>
          </span>
        )}
      </button>
      {aberto && (
        <ol className="mt-1.5 space-y-1 pl-5">
          {historico.map((h, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
              <span className={cn('font-medium', i === 0 && 'text-foreground')}>{h.orgao}</span>
              <span className="text-muted-foreground">{periodo(h)}</span>
              {i === 0 && (
                <span className="rounded-full bg-brand-50 px-1.5 text-[9px] font-semibold text-brand-800 dark:bg-brand-900/40 dark:text-brand-400">
                  atual
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * Valor da causa — o único campo do dossiê que alguém precisa digitar.
 *
 * A API pública do CNJ NÃO publica este campo: conferido com
 * `exists: valorCausa` nos índices do TRT22 e do TJPI, zero documentos o
 * trazem. Ou seja, "—" era o que TODO processo mostrava, para sempre. Agora
 * quem sabe o valor escreve, e a sincronização noturna não apaga mais (só
 * sobrescreve se o tribunal um dia passar a informar).
 */
function ValorCausaEditavel({
  processoId, valor, podeEditar, onSalvo,
}: {
  processoId: string;
  valor: string | number | null;
  podeEditar: boolean;
  onSalvo: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState('');

  const salvar = useMutation({
    mutationFn: () => {
      // Aceita "12.345,67" e "12345.67" — ninguém deveria pensar em separador
      // decimal para registrar um valor que leu no processo.
      const limpo = texto.trim().replace(/[^\d,.-]/g, '');
      const numero = limpo
        ? Number(limpo.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'))
        : null;
      if (numero !== null && (!Number.isFinite(numero) || numero < 0)) {
        throw new Error('Valor inválido.');
      }
      return atualizarProcesso(processoId, { valorCausa: numero });
    },
    onSuccess: () => { toast.success('Valor da causa atualizado.'); setEditando(false); onSalvo(); },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message ?? e?.message ?? 'Não foi possível salvar o valor.'),
  });

  if (editando) {
    return (
      <span className="flex items-center gap-1">
        <input
          autoFocus
          inputMode="decimal"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); salvar.mutate(); }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditando(false); }
          }}
          placeholder="R$ 0,00"
          className="h-8 w-28 rounded border border-input bg-background px-2 text-sm outline-none focus:border-brand-500"
        />
        <button
          type="button"
          onClick={() => salvar.mutate()}
          disabled={salvar.isPending}
          title="Salvar"
          className="rounded p-1 text-brand-800 hover:bg-muted dark:text-brand-400"
        >
          {salvar.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => setEditando(false)}
          title="Cancelar"
          className="rounded p-1 text-muted-foreground hover:bg-muted"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </span>
    );
  }

  const temValor = valor !== null && valor !== undefined && valor !== '';
  return (
    <span className="inline-flex items-center gap-1.5">
      {temValor ? formatMoeda(valor) : <span className="font-normal text-muted-foreground">Não informado</span>}
      {podeEditar && (
        <button
          type="button"
          onClick={() => { setTexto(temValor ? String(valor) : ''); setEditando(true); }}
          title={temValor ? 'Editar valor da causa' : 'Informar valor da causa (o CNJ não publica este dado)'}
          className="rounded p-0.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <PenLine className="h-3.5 w-3.5" />
        </button>
      )}
    </span>
  );
}

export function ProcessoDetalheSheet({
  processoId, open, onClose, onChanged,
}: {
  processoId: string | null;
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const ehAdmin = podeExcluir(user?.role);
  const podeEditar = nivelEfetivo(user?.role, user?.permissoes, 'processos') === 'EDITAR';

  const [aba, setAba] = useState<Aba>('timeline');
  /**
   * Dossiê do CNJ aberto ou recolhido — preferência guardada na SESSÃO.
   *
   * `sessionStorage`, e não `localStorage`, de propósito: é preferência de
   * trabalho ("hoje estou olhando andamento, não metadado"), não configuração
   * permanente. Na sessão seguinte volta aberto, que é o padrão descoberto.
   */
  const [dossieAberto, setDossieAberto] = useState(true);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setDossieAberto(window.sessionStorage.getItem(chaveLocal('dossie-datajud')) !== 'recolhido');
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(chaveLocal('dossie-datajud'), dossieAberto ? 'aberto' : 'recolhido');
  }, [dossieAberto]);
  const [busca, setBusca] = useState('');
  const [filtroOrigem, setFiltroOrigem] = useState<'todas' | 'INTERNA' | 'DATAJUD'>('todas');
  /**
   * Instâncias escolhidas na linha do tempo. Conjunto VAZIO = todas.
   *
   * Multi-seleção porque a pergunta real do advogado raramente é "só um grau":
   * é "1º e 2º juntos, sem o juizado", ou "só a turma recursal". O filtro é
   * client-side sobre dados já carregados — marcar e desmarcar não custa nada
   * ao servidor.
   */
  const [filtroInstancias, setFiltroInstancias] = useState<Set<string>>(new Set());
  /**
   * Categoria do ato na linha do tempo. '' = todas.
   *
   * A cor por categoria já existia; o que faltava era poder ISOLAR uma. Num
   * processo com 257 andamentos, "onde está a última decisão?" era rolagem no
   * olho — e a busca textual não ajuda, porque o tribunal chama decisão de
   * "Documento", "Ato ordinatório" e mais uma dúzia de nomes.
   */
  const [filtroCategoria, setFiltroCategoria] = useState<CategoriaMovimento | ''>('');
  const [confirmarExcluir, setConfirmarExcluir] = useState(false);
  const [movParaExcluir, setMovParaExcluir] = useState<string | null>(null);
  const [registrando, setRegistrando] = useState(false);
  const [editandoEtiquetas, setEditandoEtiquetas] = useState(false);
  const [etiquetasEdit, setEtiquetasEdit] = useState<string[]>([]);
  const [vinculando, setVinculando] = useState(false);

  const { data: p, isLoading } = useQuery({
    queryKey: ['processo-dossie', processoId],
    queryFn: () => getDossie(processoId as string),
    enabled: open && !!processoId,
  });
  const { data: tipos = [] } = useQuery({
    queryKey: ['tipos-movimentacao', false],
    queryFn: () => listarTiposMovimentacao(false),
    enabled: open,
  });

  /**
   * Estado da integração com o DJEN, perguntado à API em runtime.
   *
   * Não vem de `NEXT_PUBLIC_*` porque aquelas são resolvidas no build:
   * desligar a integração exigiria rebuildar o front. `retry: false` porque
   * esta é a única rota que responde com o DJEN desligado — insistir não muda
   * a resposta.
   */
  const { data: djen } = useQuery({
    queryKey: ['djen-status'],
    queryFn: statusDjen,
    enabled: open,
    retry: false,
    staleTime: 5 * 60_000,
  });

  const { data: publicacoes = [], isLoading: carregandoPublicacoes } = useQuery({
    queryKey: ['djen-publicacoes', processoId],
    queryFn: () => listarPublicacoes(processoId as string),
    enabled: open && !!processoId && !!djen?.ativo,
  });

  const buscarPublicacoes = useMutation({
    mutationFn: () => sincronizarPublicacoes(processoId as string),
    onSuccess: (r) => {
      toast.success(
        r.ingeridas > 0
          ? `${r.ingeridas} publicação(ões) nova(s).`
          : 'Nenhuma publicação nova no DJEN.',
      );
      qc.invalidateQueries({ queryKey: ['djen-publicacoes', processoId] });
      recarregar();
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message ?? 'Não foi possível consultar o DJEN.'),
  });

  useEffect(() => {
    if (open) { setAba('timeline'); setBusca(''); setFiltroOrigem('todas'); setFiltroInstancias(new Set()); setFiltroCategoria(''); }
  }, [open, processoId]);

  const recarregar = () => {
    qc.invalidateQueries({ queryKey: ['processo-dossie', processoId] });
    onChanged?.();
  };

  const sincronizar = useMutation({
    mutationFn: () => sincronizarProcesso(processoId as string),
    onSuccess: (resp: any) => {
      const n = resp.novasMovimentacoes ?? 0;
      toast.success(n > 0 ? `${n} nova(s) movimentação(ões) encontrada(s).` : 'Processo já estava atualizado.');
      recarregar();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível sincronizar com o DATAJUD.'),
  });

  /**
   * RELEITURA AO ABRIR A FICHA — só do processo aberto, e só uma vez.
   *
   * Complementa a releitura em lote da lista: quem chega por link direto
   * (`?processo=<id>`), pela agenda ou pelo dossiê do filiado não passa pela
   * lista, e veria os graus do parser antigo até as 02:00.
   *
   * As MESMAS travas: só age quando `instanciasLidasEm` é nulo — depois da
   * primeira leitura o carimbo existe e nada mais é disparado —, e o `ref`
   * impede uma segunda chamada enquanto a primeira responde (a ficha
   * re-renderiza várias vezes enquanto carrega).
   */
  const jaPediuReleitura = useRef<string | null>(null);
  useEffect(() => {
    if (!p || !podeEditar) return;
    if (p.instanciasLidasEm) return;
    if (jaPediuReleitura.current === p.id) return;
    jaPediuReleitura.current = p.id;
    // Silencioso: a pessoa abriu a ficha para ler o processo, não para
    // acompanhar uma manutenção interna. Falhando, a varredura noturna cobre.
    sincronizarProcesso(p.id).then(() => recarregar()).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p?.id, p?.instanciasLidasEm, podeEditar]);

  const excluir = useMutation({
    mutationFn: () => excluirProcesso(processoId as string),
    onSuccess: () => { toast.success('Processo excluído.'); setConfirmarExcluir(false); onChanged?.(); onClose(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível excluir o processo.'),
  });

  const salvarEtiquetas = useMutation({
    mutationFn: () => atualizarProcesso(processoId as string, { etiquetas: etiquetasEdit }),
    onSuccess: () => { toast.success('Etiquetas atualizadas.'); setEditandoEtiquetas(false); recarregar(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível salvar as etiquetas.'),
  });

  const removerMov = useMutation({
    mutationFn: (id: string) => excluirMovimentacao(id),
    onSuccess: () => { toast.success('Movimentação removida.'); setMovParaExcluir(null); recarregar(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível remover.'),
  });

  // Filtro da linha do tempo (busca textual + origem + instância).
  const timeline = useMemo(() => {
    const itens = p?.linhaDoTempo ?? [];
    const termo = busca.trim().toLowerCase();
    return itens.filter((i) => {
      if (filtroOrigem !== 'todas' && i.origem !== filtroOrigem) return false;
      // Filtro por grau só se aplica ao que VEIO do tribunal: andamento interno
      // da equipe é do processo, não de uma instância. Escondê-lo ao filtrar um
      // grau apagaria da tela justamente as anotações da própria casa.
      if (
        filtroInstancias.size > 0 &&
        i.origem === 'DATAJUD' &&
        (!i.instanciaId || !filtroInstancias.has(i.instanciaId))
      ) {
        return false;
      }
      // Categoria só existe para o que veio do tribunal; andamento interno da
      // equipe não é classificado pela TPU e não deve sumir ao filtrar.
      if (filtroCategoria && i.origem === 'DATAJUD') {
        if (categoriaMovimento(i.codigoMovimento, i.descricao) !== filtroCategoria) return false;
      }
      if (filtroCategoria && i.origem !== 'DATAJUD') return false;
      if (!termo) return true;
      return i.descricao.toLowerCase().includes(termo);
    });
  }, [p?.linhaDoTempo, busca, filtroOrigem, filtroInstancias, filtroCategoria]);

  /** Quantos itens há por categoria — o filtro mostra o número antes do clique. */
  const contagemCategoria = useMemo(() => {
    const conta = new Map<CategoriaMovimento, number>();
    for (const i of p?.linhaDoTempo ?? []) {
      if (i.origem !== 'DATAJUD') continue;
      const c = categoriaMovimento(i.codigoMovimento, i.descricao);
      conta.set(c, (conta.get(c) ?? 0) + 1);
    }
    return conta;
  }, [p?.linhaDoTempo]);

  /**
   * Instância cujos dados o dossiê mostra.
   *
   * Com um grau selecionado, é ele — o bloco acompanha o que se está lendo.
   * Sem seleção (ou com vários), é a principal, e o bloco diz qual. O que não
   * pode é mostrar campos de um grau sem dizer de qual, que era o comportamento
   * anterior.
   */
  const instanciaExibida = useMemo(() => {
    const lista = p?.instancias ?? [];
    if (!lista.length) return null;
    if (filtroInstancias.size === 1) {
      const [id] = [...filtroInstancias];
      return lista.find((i) => i.id === id) ?? null;
    }
    return lista.find((i) => i.principal) ?? lista[0];
  }, [p?.instancias, filtroInstancias]);

  const origem = p?.atendimentos?.[0];

  /** Notas internas: as movimentações da equipe marcadas como internas. */
  const notasInternas = useMemo(
    () =>
      (p?.linhaDoTempo ?? []).filter(
        (i): i is Extract<ItemTimeline, { origem: 'INTERNA' }> =>
          i.origem === 'INTERNA' && i.notaInterna,
      ),
    [p?.linhaDoTempo],
  );

  if (!open) return null;

  return (
    <>
      {/* Modal centralizado (antes era um painel lateral) */}
      <div
        className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center"
        onClick={onClose}
      >
      <div
        // 3xl (768px) apertava: sete abas não cabiam numa linha e o dossiê
        // ficava em duas colunas espremidas. 5xl usa a tela que já existe no
        // desktop sem virar uma página inteira; no celular continua ocupando a
        // largura toda, como antes.
        className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho rico */}
        {/* Cabeçalho ENXUTO: identidade e ações. Todo bloco de contexto que
            entrou aqui saiu para a área que rola — somados, eles comiam a
            altura da janela e sobrava uma faixa de conteúdo ilegível. */}
        <div className="shrink-0 border-b px-5 pb-3 pt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-900/30">
                <Gavel className="h-5 w-5 text-brand-800 dark:text-brand-400" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-lg font-bold">
                    {p?.classeProcessual ?? 'Processo'}
                  </h3>
                  {p && (
                    <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', STATUS_PROCESSO_COR[p.statusInterno])}>
                      {STATUS_PROCESSO_LABEL[p.statusInterno]}
                    </span>
                  )}
                  {/* Ação coletiva: o autor é o próprio sindicato. */}
                  {p?.tipoAcao === 'INSTITUCIONAL' && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-800 dark:bg-brand-900/40 dark:text-brand-300"
                      title={`Ação coletiva movida pelo ${tenant.sigla} em nome da categoria`}
                    >
                      🏛️ Ação Institucional ({tenant.sigla})
                    </span>
                  )}
                  {/* Bandeiras de atenção vindas do CNJ */}
                  {p?.segredoJustica && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-300"
                      title={`Nível de sigilo ${p.nivelSigilo ?? '—'} — acesso restrito`}>
                      <Lock className="h-3 w-3" /> Segredo de Justiça
                    </span>
                  )}
                  {(p?.prioridades ?? []).map((tag) => (
                    <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                      <AlertTriangle className="h-3 w-3" /> {tag}
                    </span>
                  ))}
                </div>
                <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                  Nº {p ? formatNPU(p.numeroCNJ) : '—'}
                </p>

                {/* CONFRONTO — "quem processou quem" na primeira olhada, sem
                    precisar abrir a aba Partes. Sem réu cadastrado, vira o
                    convite para cadastrá-lo (o DataJud não preenche isso). */}
                {p && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <span className="font-semibold text-foreground">
                      {p.polos.confronto.autor?.nome ?? 'Autor não informado'}
                    </span>
                    {p.polos.confronto.outrosAtivo > 0 && (
                      <span className="text-xs text-muted-foreground">+{p.polos.confronto.outrosAtivo}</span>
                    )}
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">×</span>
                    {p.polos.confronto.reu ? (
                      <>
                        <span className="font-semibold text-foreground">{p.polos.confronto.reu.nome}</span>
                        {p.polos.confronto.outrosPassivo > 0 && (
                          <span className="text-xs text-muted-foreground">+{p.polos.confronto.outrosPassivo}</span>
                        )}
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setAba('partes')}
                        disabled={!podeEditar}
                        className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700 transition hover:bg-amber-200 disabled:pointer-events-none dark:bg-amber-900/40 dark:text-amber-300"
                      >
                        <AlertTriangle className="h-3 w-3" />
                        {podeEditar ? 'Cadastrar réu' : 'Réu não informado'}
                      </button>
                    )}
                  </div>
                )}

                {p && (
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {/* Atalho para a equipe. "Gerenciar equipe" existe desde
                        sempre, mas dentro da aba Partes — longe de onde o nome
                        do responsável aparece, que é onde se pensa nele. */}
                    <button
                      type="button"
                      onClick={() => setAba('partes')}
                      className="group inline-flex items-center gap-1 hover:text-foreground"
                      title="Ver e gerenciar os advogados do processo"
                    >
                      {p.advogado ? (
                        <>
                          Responsável:{' '}
                          <strong className="text-foreground group-hover:underline">
                            {p.advogado.nomeExibicao || p.advogado.nome}
                          </strong>
                          {p.totais.advogados > 1 && ` +${p.totais.advogados - 1}`}
                        </>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                          <AlertTriangle className="h-3 w-3" /> Sem advogado
                        </span>
                      )}
                      <Users className="h-3 w-3 opacity-0 transition group-hover:opacity-60" />
                    </button>
                    {/* FILIADO — alarme só quando é mesmo um problema.
                        O aviso amarelo aparecia em TODO processo sem filiado,
                        inclusive na ação institucional (sindicato × empresa), em
                        que não existe filiado "dono" e o polo ativo está
                        corretamente cadastrado. Alarme que soa quando está tudo
                        certo ensina a equipe a ignorar alarme. Agora só acusa
                        quando NINGUÉM representa o polo ativo — aí sim não se
                        sabe por quem se litiga. */}
                    {p.filiado ? (
                      <span>
                        Filiado: <strong className="text-foreground">{p.filiado.nomeCompleto}</strong>
                        {p.totais.filiados > 1 && ` +${p.totais.filiados - 1}`}
                      </span>
                    ) : !p.polos?.ativo?.length ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                          <AlertTriangle className="h-3 w-3" /> Polo ativo não cadastrado
                        </span>
                        {podeEditar && (
                          <button
                            type="button"
                            onClick={() => { setAba('partes'); setVinculando(true); }}
                            className="font-medium text-brand-800 hover:underline dark:text-brand-400"
                          >
                            Cadastrar
                          </button>
                        )}
                      </span>
                    ) : podeEditar && p.tipoAcao !== 'INSTITUCIONAL' ? (
                      // Polo ativo cadastrado, mas sem filiado da base: é uma
                      // possibilidade legítima (parte externa, herdado), então
                      // fica só o atalho, sem cor de alerta.
                      <button
                        type="button"
                        onClick={() => { setAba('partes'); setVinculando(true); }}
                        className="font-medium text-brand-800 hover:underline dark:text-brand-400"
                      >
                        Vincular filiado
                      </button>
                    ) : null}
                    {p.orgaoJulgador && <span>· {p.orgaoJulgador}</span>}
                    {p.dataDistribuicao && <span>· Distribuição: {formatData(p.dataDistribuicao)}</span>}
                  </div>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="outline" size="sm"
                onClick={() => sincronizar.mutate()}
                disabled={sincronizar.isPending || !p}
                title="Buscar novas movimentações no DATAJUD"
              >
                {sincronizar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                <span className="hidden sm:inline">Sincronizar</span>
              </Button>
              {/* ABRIR NO TRIBUNAL.
                  Copia o número e abre a consulta pública do tribunal certo.
                  Não é link direto para o processo de propósito: os tribunais
                  que usam PJe exigem sessão ou captcha para abrir um processo
                  específico, e um link montado por nós levaria a uma tela de
                  erro em boa parte dos casos. Com o número já na área de
                  transferência, é um Ctrl+V na consulta. */}
              {p?.numeroCNJ && (
                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(formatNPU(p.numeroCNJ));
                      toast.success('Número copiado — cole na consulta do tribunal.');
                    } catch {
                      /* sem permissão de área de transferência: abre assim mesmo */
                    }
                    window.open(urlConsultaTribunal(p.tribunal), '_blank', 'noopener');
                  }}
                  title={`Abrir a consulta pública do ${p.tribunal ?? 'tribunal'} com o número copiado`}
                >
                  <ExternalLink className="h-4 w-4" />
                  <span className="hidden sm:inline">Abrir no tribunal</span>
                </Button>
              )}
              {ehAdmin && (
                <button type="button" onClick={() => setConfirmarExcluir(true)} disabled={!p} title="Excluir processo"
                  className="rounded-lg p-2 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
              <button type="button" onClick={onClose} title="Fechar" className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Etiquetas internas — edição inline */}
          {p && (
            <div className="mt-2">
              {editandoEtiquetas ? (
                <div className="space-y-2 rounded-lg border p-3">
                  <EtiquetasInput valor={etiquetasEdit} onChange={setEtiquetasEdit} />
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    Aqui ficam só as etiquetas que dependem de julgamento seu. Fase de execução,
                    recurso, ação coletiva e perícia o sistema deduz sozinho dos dados do processo —
                    aparecem com <Zap className="inline h-3 w-3 fill-current text-emerald-600" /> e se
                    corrigem sem ninguém mexer.
                  </p>
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditandoEtiquetas(false)}>Cancelar</Button>
                    <Button size="sm" onClick={() => salvarEtiquetas.mutate()} disabled={salvarEtiquetas.isPending}>
                      {salvarEtiquetas.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Salvar etiquetas
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-1.5">
                  {/* AUTOMÁTICAS: derivadas a cada leitura, não editáveis — não
                      há o que corrigir numa etiqueta que se recalcula sozinha. */}
                  {(p.etiquetasAutomaticas ?? []).map((e) => (
                    <span
                      key={`auto-${e}`}
                      title="Mantida pelo sistema a partir dos dados do processo — não precisa ser gerenciada à mão"
                      className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                    >
                      <Zap className="h-3 w-3 fill-current" />
                      {e}
                    </span>
                  ))}
                  {(p.etiquetas ?? [])
                    .filter((e) => !(p.etiquetasAutomaticas ?? []).includes(e))
                    .map((e) => (
                      <span key={e} className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-800 dark:bg-brand-900/30 dark:text-brand-400">
                        {e}
                      </span>
                    ))}
                  {/* ASSUNTO na MESMA linha das etiquetas, e não numa própria:
                      são dois rótulos curtos, e cada linha extra no cabeçalho
                      sai direto da área de leitura. Só o principal — os demais
                      ficam no dossiê, com o código da TPU. */}
                  {p.assuntos?.filter((a) => a.principal).slice(0, 1).map((a, i) => (
                    <span key={`as-${i}`} className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground" title="Assunto principal (TPU/CNJ)">
                      {a.nome}
                    </span>
                  ))}
                  {podeEditar && (
                    <button
                      type="button"
                      onClick={() => { setEtiquetasEdit(p.etiquetas ?? []); setEditandoEtiquetas(true); }}
                      className="inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-[11px] text-muted-foreground transition hover:border-brand-400 hover:text-foreground"
                    >
                      <Tag className="h-3 w-3" /> {(p.etiquetas?.length ?? 0) > 0 ? 'Editar etiquetas' : 'Adicionar etiqueta'}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Origem: triagem que gerou o processo */}
          {origem && (
            <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50/50 p-3 dark:border-sky-900/40 dark:bg-sky-950/10">
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-sky-800 dark:text-sky-300">
                <ArrowRight className="h-3.5 w-3.5" /> Originado de atendimento
              </p>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-card px-3 py-2">
                <span className="text-sm">
                  <strong>Atendimento #{origem.numero}</strong>
                  <span className="ml-2 text-xs uppercase text-muted-foreground">{origem.canal}</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatData(origem.createdAt)} · triagem por {origem.atendente.nomeExibicao || origem.atendente.nome}
                </span>
              </div>
            </div>
          )}

          {/* Abas */}
          {/* `flex-1` só a partir de sm: no celular as abas rolam na
              horizontal (é o certo com sete delas); no desktop elas se dividem
              e a barra de rolagem desaparece, que era o que dava a sensação de
              aperto mesmo sobrando espaço. */}
          <div className="mt-3 flex gap-1 overflow-x-auto rounded-lg border bg-muted/30 p-1 [scrollbar-width:thin]">
            {ABAS.map((a) => {
              const Icon = a.icon;
              const n =
                a.key === 'documentos' ? p?.totais.anexos
                : a.key === 'agenda' ? p?.totais.compromissos
                : a.key === 'partes' ? p?.totais.partes
                : a.key === 'timeline' ? (p?.linhaDoTempo.length ?? 0)
                : a.key === 'publicacoes' ? publicacoes.length
                : undefined;
              return (
                <button
                  key={a.key}
                  onClick={() => setAba(a.key)}
                  className={cn(
                    // `shrink-0` no celular impede o texto de ser espremido a
                    // ponto de virar reticências; `sm:flex-1` no desktop faz as
                    // abas dividirem a largura e sumirem com a rolagem.
                    'flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition sm:flex-1',
                    aba === a.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" /> {a.label}
                  {n !== undefined && n > 0 && (
                    <span className="rounded-full bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground">{n}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* `min-h-0` é o que permite ao filho de um flex encolher e rolar; sem
            ele o contêiner cresce e a rolagem interna nunca acontece. */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          {/* ATENÇÃO REQUERIDA e INSTÂNCIAS ficam AQUI, na área que rola — não no
              cabeçalho fixo.

              Eu tinha empilhado os dois lá em cima junto com assuntos,
              etiquetas, partes e responsável. Somados, comiam a altura inteira
              da janela: sobrava uma faixa de conteúdo de ~150px, e a ficha
              virava ilegível mesmo com a tela a 80% de zoom. Cabeçalho carrega
              IDENTIDADE (o que é este processo) e ações; contexto rola junto
              com o resto.

              ATENÇÃO REQUERIDA.
              Só aparece quando há ato crítico recente SEM atividade criada — é o
              que o robô de prazos não pegou. Marcar todo processo movimentado
              faria a etiqueta perder o sentido em uma semana. */}
          {!!p?.atencao?.total && p.atencao.nivel && (
            <div
              className={cn(
                'mt-3 rounded-xl border border-l-4 bg-muted/30 p-3',
                classesCor(ATENCAO_COR[p.atencao.nivel]).borda,
              )}
            >
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold">
                <span className={cn('rounded-full px-2 py-0.5', classesCor(ATENCAO_COR[p.atencao.nivel]).badge)}>
                  <AlertTriangle className="mr-1 inline h-3 w-3" />
                  {ATENCAO_LABEL[p.atencao.nivel]}
                </span>
                Atenção requerida — {p.atencao.total} ato
                {p.atencao.total === 1 ? '' : 's'} sem tarefa na agenda
              </p>
              <ul className="space-y-0.5">
                {p.atencao.itens.map((a, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
                    <strong>{a.rotulo}</strong>
                    <span className="text-muted-foreground">{a.descricao}</span>
                    <span className="text-muted-foreground/70">{formatData(a.data)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Instâncias — só quando há mais de uma, senão é ruído */}
          <ResumoInstancias instancias={p?.instancias ?? []} />

          {/* POR QUE ESTE PROCESSO ESTÁ ARQUIVADO */}
          {p?.fase === 'ARQUIVADO' && <MarcosDoEncerramento marcos={p.marcosDoEncerramento ?? []} />}

          {isLoading || !p ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <>
              {/* ---------------- LINHA DO TEMPO ---------------- */}
              {aba === 'timeline' && (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Landmark className="h-3.5 w-3.5" />
                      DataJud: {p.ultimaSincronizacao ? `última sincronização em ${formatDataHora(p.ultimaSincronizacao)}` : 'ainda não sincronizado'}
                    </span>
                    {/* SEMPRE SECUNDÁRIO. Em verde sólido, ao lado da linha que
                        fala do DataJud, o botão parecia a ação principal — "é
                        assim que eu atualizo o processo?". Não é: o que traz o
                        andamento do tribunal é o Sincronizar, no topo. Aqui se
                        registra um ato INTERNO (ligação, reunião, protocolo
                        feito na mão), que é o caso menos frequente. */}
                    {podeEditar && (
                      <Button size="sm" variant="outline" onClick={() => setRegistrando((v) => !v)}>
                        {registrando ? <><X className="h-4 w-4" /> Fechar</> : <><Plus className="h-4 w-4" /> Registrar movimentação</>}
                      </Button>
                    )}
                  </div>

                  {/* Formulário no TOPO quando aberto */}
                  {podeEditar && registrando && (
                    <RegistrarMovimentacaoForm
                      processoId={p.id}
                      statusAtual={p.statusInterno}
                      podeGerenciarTipos={podeEditar}
                      onRegistrado={() => { recarregar(); setRegistrando(false); }}
                    />
                  )}

                  {/* Dossiê DataJud — dos dados DA INSTÂNCIA exibida.
                      Tribunal, órgão, grau, classe e distribuição são de UM
                      grau, não do processo: numa ação que subiu em recurso, a
                      classe muda ("Ação Trabalhista" vira "Recurso Ordinário")
                      e o órgão também. Mostrar um número só, sem dizer de qual
                      instância, fazia o bloco parecer errado — era a pergunta
                      "por que diz G1 se tem dois graus?". */}
                  <section className="rounded-xl border bg-card p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setDossieAberto((v) => !v)}
                        aria-expanded={dossieAberto}
                        className="flex min-w-0 flex-1 items-center gap-2 rounded text-left text-sm font-semibold"
                      >
                        <ChevronRight className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', dossieAberto && 'rotate-90')} />
                        <Landmark className="h-4 w-4 shrink-0 text-brand-800 dark:text-brand-400" />
                        Dossiê DataJud
                        {instanciaExibida && (p.instancias?.length ?? 0) > 1 && (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {rotuloGrau(instanciaExibida.grau, instanciaExibida.tribunal)}
                            {instanciaExibida.principal && filtroInstancias.size === 0 ? ' · principal' : ''}
                          </span>
                        )}
                      </button>
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Dados oficiais do CNJ</span>
                    </div>
                    {/* RECOLHIDO: uma linha com o que identifica o processo.
                        Os nove campos do dossiê são consultados uma vez e depois
                        empurram para baixo o que se olha todo dia — a linha do
                        tempo. Fechado, sobra a identificação; a preferência fica
                        gravada e vale para as próximas fichas abertas. */}
                    {!dossieAberto && (
                      <p className="mt-1.5 pl-6 text-xs text-muted-foreground">
                        {[
                          instanciaExibida?.tribunal ?? p.tribunal,
                          rotuloGrau(instanciaExibida?.grau ?? p.grau, instanciaExibida?.tribunal) || null,
                          instanciaExibida?.classeProcessual ?? p.classeProcessual,
                          (instanciaExibida?.dataDistribuicao ?? p.dataDistribuicao)
                            ? `Distribuição: ${formatData(instanciaExibida?.dataDistribuicao ?? p.dataDistribuicao)}`
                            : null,
                        ].filter(Boolean).join(' · ') || 'Sem dados do CNJ'}
                      </p>
                    )}
                    {dossieAberto && (
                    <div className="mt-3">
                    {(p.instancias?.length ?? 0) > 1 && filtroInstancias.size === 0 && (
                      <p className="mb-3 rounded-md bg-muted/50 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
                        Este processo corre em {p.instancias!.length} instâncias. Os campos abaixo são
                        da instância <strong>{rotuloGrau(instanciaExibida?.grau, instanciaExibida?.tribunal)}</strong> — use o
                        seletor acima para ver os dados de outro grau.
                      </p>
                    )}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                      <CampoDossie label="Tribunal">{instanciaExibida?.tribunal ?? p.tribunal ?? '—'}</CampoDossie>
                      <CampoDossie label="Órgão Julgador">{instanciaExibida?.orgaoJulgador ?? p.orgaoJulgador ?? '—'}</CampoDossie>
                      <CampoDossie label="Grau">{rotuloGrau(instanciaExibida?.grau ?? p.grau, instanciaExibida?.tribunal) || '—'}</CampoDossie>
                      <CampoDossie label="Classe">{instanciaExibida?.classeProcessual ?? p.classeProcessual ?? '—'}</CampoDossie>
                      <CampoDossie label="Distribuição">{formatData(instanciaExibida?.dataDistribuicao ?? p.dataDistribuicao)}</CampoDossie>
                      <CampoDossie label="Valor da causa">
                        <ValorCausaEditavel
                          processoId={p.id}
                          valor={p.valorCausa}
                          podeEditar={podeEditar}
                          onSalvo={recarregar}
                        />
                      </CampoDossie>
                      <CampoDossie label="Formato">{p.formato ?? '—'}</CampoDossie>
                      <CampoDossie label="Sistema">{p.sistema ?? '—'}</CampoDossie>
                      <CampoDossie label="Movimentações">
                        {instanciaExibida && (p.instancias?.length ?? 0) > 1
                          ? <>{instanciaExibida._count?.movimentacoes ?? 0} <span className="font-normal text-muted-foreground">nesta instância · {p.totais.datajud} no total</span></>
                          : <>{p.totais.datajud} <span className="font-normal text-muted-foreground">do CNJ · {p.totais.internas} internas</span></>}
                      </CampoDossie>
                    </div>
                    {/* Assuntos completos (o principal em destaque) */}
                    {(p.assuntos?.length ? p.assuntos : p.assuntoPrincipal ? [{ nome: p.assuntoPrincipal, codigo: null, principal: true }] : []).length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {(p.assuntos?.length ? p.assuntos : [{ nome: p.assuntoPrincipal, codigo: null, principal: true }]).map((a, i) => (
                          <span key={i} className={cn(
                            'inline-flex rounded-full px-2.5 py-0.5 text-xs',
                            a.principal ? 'bg-brand-50 font-medium text-brand-800 dark:bg-brand-900/30 dark:text-brand-400' : 'bg-muted text-muted-foreground',
                          )}>
                            {a.nome}{a.principal ? ' · principal' : ''}
                          </span>
                        ))}
                      </div>
                    )}
                    {/* SINCRONIZAÇÃO — duas datas diferentes, e a confusão entre
                        elas já custou dúvida: `atualizadoNoCnjEm` é quando o
                        TRIBUNAL alimentou a base do CNJ; `ultimaSincronizacao` é
                        quando NÓS lemos de lá. Um processo pode estar sincronizado
                        há minutos e o tribunal não publicar nada há meses. */}
                    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t pt-2 text-[11px] text-muted-foreground">
                      {p.ultimaSincronizacao && (
                        <span className="inline-flex items-center gap-1.5">
                          <RefreshCw className="h-3 w-3" />
                          Sincronizado com o CNJ em{' '}
                          <strong className="font-medium text-foreground">
                            {formatDataHora(p.ultimaSincronizacao)}
                          </strong>
                        </span>
                      )}
                      {p.atualizadoNoCnjEm && (
                        <span className="inline-flex items-center gap-1.5">
                          <Landmark className="h-3 w-3" />
                          Tribunal atualizou a base em{' '}
                          <strong className="font-medium text-foreground">
                            {formatDataHora(p.atualizadoNoCnjEm)}
                          </strong>
                        </span>
                      )}
                    </div>

                    {/* POR ONDE O PROCESSO PASSOU.
                        Derivado dos andamentos — cada um guarda o órgão que o
                        praticou, então a redistribuição aparece sozinha como
                        troca de órgão. Só é exibido quando houve mudança: com um
                        órgão só, o dado já está no campo acima. */}
                    {(p.historicoOrgaos?.length ?? 0) > 1 && (
                      <TramiteOrgaos historico={p.historicoOrgaos!} />
                    )}
                    </div>
                    )}
                  </section>

                  {/* As partes do processo NÃO vêm mais daqui: a API Pública do
                      DataJud não as devolve (verificado em TJPI, TRT22, TJSP e
                      TRF1). Elas são cadastradas pela equipe e vivem na aba
                      "Partes" — que é a fonte única de quem processou quem. */}

                  {/* SELETOR DE INSTÂNCIA — só quando o processo corre em mais
                      de um grau. Com uma instância só, um seletor de um item é
                      ruído. É o filtro que o advogado usa para ler o 1º grau sem
                      o recurso no meio, e vice-versa. */}
                  {(p.instancias?.length ?? 0) > 1 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Instância
                      </span>
                      <button
                        type="button"
                        onClick={() => setFiltroInstancias(new Set())}
                        className={cn(
                          'rounded-full px-3 py-1 text-xs font-medium transition',
                          filtroInstancias.size === 0
                            ? 'bg-brand-800 text-white shadow-sm'
                            : 'bg-muted text-muted-foreground hover:text-foreground',
                        )}
                      >
                        Todas
                      </button>
                      {p.instancias.map((i) => {
                        const marcada = filtroInstancias.has(i.id);
                        return (
                          <button
                            key={i.id}
                            type="button"
                            // Alterna: dá para ver 1º+2º juntos, só o 2º, ou
                            // qualquer combinação. Desmarcar a última volta a
                            // "Todas" — nunca se chega a uma tela vazia por
                            // acidente de clique.
                            onClick={() =>
                              setFiltroInstancias((atual) => {
                                const proximo = new Set(atual);
                                if (proximo.has(i.id)) proximo.delete(i.id);
                                else proximo.add(i.id);
                                return proximo;
                              })
                            }
                            title={[i.orgaoJulgador, i.baixada ? 'baixado' : 'ativo'].filter(Boolean).join(' · ')}
                            className={cn(
                              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition',
                              marcada
                                ? 'bg-brand-800 text-white shadow-sm'
                                : 'bg-muted text-muted-foreground hover:text-foreground',
                            )}
                          >
                            {marcada && <Check className="h-3 w-3" />}
                            {rotuloGrau(i.grau, i.tribunal)}
                            <span className={cn('opacity-70', marcada && 'opacity-90')}>
                              {i._count?.movimentacoes ?? 0}
                            </span>
                            {/* Grau baixado continua visível: o histórico dele é o
                                que explica de onde o processo veio. */}
                            {i.baixada && (
                              <span
                                className={cn(
                                  'h-1.5 w-1.5 rounded-full',
                                  marcada ? 'bg-white/70' : 'bg-muted-foreground/50',
                                )}
                              />
                            )}
                          </button>
                        );
                      })}
                      {filtroInstancias.size > 0 && (
                        <span className="text-[11px] text-muted-foreground">
                          {filtroInstancias.size === 1 ? '1 grau selecionado' : `${filtroInstancias.size} graus selecionados`}
                        </span>
                      )}
                    </div>
                  )}

                  {/* FILTRO POR CATEGORIA DO ATO.
                      A cor por categoria já existia em cada linha; o que faltava
                      era isolar uma. Num processo com centenas de andamentos,
                      "onde está a última decisão?" virava rolagem — e a busca
                      textual não resolve, porque o tribunal chama decisão de
                      "Documento", "Ato ordinatório" e mais uma dúzia de nomes.
                      Só aparecem as categorias que EXISTEM neste processo. */}
                  {contagemCategoria.size > 1 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Tipo de ato
                      </span>
                      <button
                        type="button"
                        onClick={() => setFiltroCategoria('')}
                        className={cn(
                          'rounded-full px-3 py-1 text-xs font-medium transition',
                          !filtroCategoria
                            ? 'bg-brand-800 text-white shadow-sm'
                            : 'bg-muted text-muted-foreground hover:text-foreground',
                        )}
                      >
                        Todos
                      </button>
                      {[...contagemCategoria.entries()]
                        .sort((a, b) => b[1] - a[1])
                        .map(([cat, n]) => {
                          const ativo = filtroCategoria === cat;
                          const cor = classesCor(CATEGORIA_COR[cat]);
                          return (
                            <button
                              key={cat}
                              type="button"
                              onClick={() => setFiltroCategoria(ativo ? '' : cat)}
                              className={cn(
                                'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition',
                                ativo ? 'bg-brand-800 text-white shadow-sm' : cor.badge,
                              )}
                            >
                              {CATEGORIA_LABEL[cat]}
                              <span className="opacity-70">{n}</span>
                            </button>
                          );
                        })}
                    </div>
                  )}

                  {/* Busca + filtro */}
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <div className="relative flex-1">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input className="pl-9" placeholder="Buscar movimentação…" value={busca} onChange={(e) => setBusca(e.target.value)} />
                    </div>
                    <select
                      className="h-11 rounded-md border border-input bg-background px-3 text-sm md:h-10"
                      value={filtroOrigem}
                      onChange={(e) => setFiltroOrigem(e.target.value as any)}
                    >
                      <option value="todas">Todas as movimentações</option>
                      <option value="INTERNA">Só internas (equipe)</option>
                      <option value="DATAJUD">Só do DataJud</option>
                    </select>
                  </div>

                  {/* Timeline unificada */}
                  {timeline.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma movimentação encontrada.</p>
                  ) : (
                    <ul className="space-y-2">
                      {timeline.map((item) => (
                        <ItemLinhaTempo
                          key={`${item.origem}-${item.id}`}
                          item={item}
                          tipos={tipos}
                          podeExcluir={ehAdmin}
                          onExcluir={() => setMovParaExcluir(item.id)}
                        />
                      ))}
                    </ul>
                  )}

                  <p className="text-[11px] leading-snug text-muted-foreground">
                    Dados processuais obtidos da API Pública do DataJud (CNJ) e tratados em conformidade com a
                    LGPD (Lei nº 13.709/2018), para uso exclusivo na defesa dos interesses dos filiados.
                  </p>

                </>
              )}

              {/* ---------------- PUBLICAÇÕES (DJEN) ---------------- */}
              {aba === 'publicacoes' && (
                <AbaPublicacoes
                  ativo={!!djen?.ativo}
                  bloqueadoNaOrigem={!!djen?.bloqueadoNaOrigem}
                  carregando={carregandoPublicacoes}
                  publicacoes={publicacoes}
                  buscando={buscarPublicacoes.isPending}
                  onBuscar={() => buscarPublicacoes.mutate()}
                />
              )}

              {/* ---------------- NOTAS INTERNAS ---------------- */}
              {aba === 'notas' && (
                <>
                  <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
                    <p className="flex items-center gap-1.5 font-semibold">
                      <Lock className="h-3.5 w-3.5" /> Observações da equipe
                    </p>
                    <p className="mt-0.5">
                      Recados e histórico de atendimento ao filiado. Ficam marcados como internos e
                      não devem sair em extratos entregues ao filiado.
                    </p>
                  </div>

                  {podeEditar && (
                    <NotaInternaRapida processoId={p.id} onRegistrada={recarregar} />
                  )}

                  {notasInternas.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      Nenhuma nota interna registrada ainda.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {notasInternas.map((n) => (
                        <li key={n.id}>
                          <ItemLinhaTempo
                            item={n}
                            tipos={tipos}
                            podeExcluir={ehAdmin}
                            onExcluir={() => setMovParaExcluir(n.id)}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}

              {/* ---------------- DOCUMENTOS ---------------- */}
              {aba === 'documentos' && <AnexosSection processoId={p.id} filiadoId={p.filiado?.id} />}

              {/* ---------------- AGENDA ---------------- */}
              {aba === 'agenda' && (
                p.compromissos.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Nenhum compromisso vinculado a este processo.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {p.compromissos.map((c) => (
                      <li key={c.id}>
                        {/* Abre a atividade, não a agenda inteira. */}
                        <Link href={`/agenda?compromisso=${c.id}`} className="flex items-center gap-3 rounded-lg border bg-card p-3 transition hover:bg-muted/40">
                          <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg bg-muted">
                            <span className="text-[10px] font-semibold uppercase leading-none text-muted-foreground">
                              {new Date(c.inicio).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}
                            </span>
                            <span className="text-base font-bold leading-tight">{new Date(c.inicio).getDate()}</span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                              <span className="truncate">{c.titulo}</span>
                              {c.origemAutomatica && (
                                <span
                                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
                                  title="Gerado a partir de uma movimentação do DataJud"
                                >
                                  <Bot className="h-3 w-3" /> Criado pelo Sistema
                                </span>
                              )}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {formatDataHora(c.inicio)}{c.local ? ` · ${c.local}` : ''} · {c.responsavel.nomeExibicao || c.responsavel.nome}
                            </p>
                            {/* O RESULTADO, e não só o status: "Concluído" não
                                diz se houve acordo ou se o prazo foi perdido. */}
                            {c.desfecho && (
                              <p className="mt-1 flex flex-wrap items-center gap-1.5">
                                <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', corDesfecho(c.desfecho))}>
                                  {rotuloDesfecho(c.desfecho)}
                                </span>
                                {c.desfechoObs && (
                                  <span className="min-w-0 truncate text-xs text-muted-foreground">{c.desfechoObs}</span>
                                )}
                              </p>
                            )}
                            {(c.canceladoCategoria || c.canceladoMotivo) && (
                              <p className="mt-1 truncate text-xs text-muted-foreground">
                                <span className="font-medium text-amber-700 dark:text-amber-400">
                                  {c.canceladoCategoria
                                    ? CATEGORIA_CANCELAMENTO_LABEL[c.canceladoCategoria] ?? 'Cancelada'
                                    : 'Cancelada'}
                                </span>
                                {c.canceladoMotivo ? ` — ${c.canceladoMotivo}` : ''}
                              </p>
                            )}
                          </div>
                          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                            {c.status}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )
              )}

              {/* ---------------- PARTES ---------------- */}
              {aba === 'partes' && (
                <>
                  {/* SEM FILIADO — a mesma regra do cabeçalho.
                      O aviso era amarelo e dizia, no próprio texto, que "o
                      processo pode ficar assim": um alerta que explica não ser
                      um problema não devia ter cor de problema. Na ação
                      institucional ele era simplesmente falso.
                      Agora: vermelho-âmbar só quando o polo ativo está vazio;
                      nos demais casos, uma faixa neutra com o atalho. */}
                  {!p.filiado && (
                    !p.polos?.ativo?.length ? (
                      <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
                        <p className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
                          <AlertTriangle className="h-4 w-4" /> Polo ativo não cadastrado
                        </p>
                        <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-300/80">
                          Não há ninguém registrado do lado de quem move a ação — nem filiado, nem o
                          sindicato, nem parte externa. O DataJud não devolve as partes, então esse
                          cadastro só existe se a equipe fizer.
                        </p>
                        {podeEditar && (
                          <div className="mt-3">
                            <Button size="sm" variant="outline" onClick={() => setVinculando(true)}>
                              <UserIcon className="h-4 w-4" /> Vincular ou cadastrar filiado
                            </Button>
                          </div>
                        )}
                      </div>
                    ) : p.tipoAcao !== 'INSTITUCIONAL' && podeEditar ? (
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted/40 px-4 py-3">
                        <p className="text-xs text-muted-foreground">
                          Nenhum filiado da base está vinculado a este processo. O vínculo é
                          opcional — serve para o processo aparecer no dossiê da pessoa.
                        </p>
                        <Button size="sm" variant="outline" onClick={() => setVinculando(true)}>
                          <UserIcon className="h-4 w-4" /> Vincular filiado
                        </Button>
                      </div>
                    ) : null
                  )}

                  <PartesPanel
                    processoId={p.id}
                    polos={p.polos}
                    advogados={p.advogados}
                    podeEditar={podeEditar}
                    ehAdmin={ehAdmin}
                    onChanged={recarregar}
                  />

                  {/* Dossiê do filiado principal — o atalho para o cadastro dele */}
                  {p.filiado && (
                    <div className="mt-5 rounded-xl border bg-card p-4">
                      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Filiado principal
                        {p.totais.filiados > 1 && ` · +${p.totais.filiados - 1} outro(s) neste processo`}
                      </p>
                      <div className="flex items-start gap-3">
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-400 text-lg font-bold text-brand-900">
                          {p.filiado.nomeCompleto.charAt(0)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold">{p.filiado.nomeCompleto}</p>
                          <p className="text-xs text-muted-foreground">
                            Matrícula {p.filiado.matricula} · {p.filiado.situacao}
                          </p>
                          <div className="mt-2 grid grid-cols-1 gap-1.5 text-sm text-muted-foreground sm:grid-cols-2">
                            <span className="flex items-center gap-2"><UserIcon className="h-3.5 w-3.5" /> {mascararCpf(p.filiado.cpf ?? '')}</span>
                            <span className="flex items-center gap-2"><Phone className="h-3.5 w-3.5" /> {p.filiado.telefonePrincipal || 'sem telefone'}</span>
                            {p.filiado.email && <span className="flex items-center gap-2"><Mail className="h-3.5 w-3.5" /> {p.filiado.email}</span>}
                            {p.filiado.formacao && <span className="flex items-center gap-2"><GraduationCap className="h-3.5 w-3.5" /> {p.filiado.formacao}</span>}
                          </div>
                          <Link href={`/filiados/${p.filiado.id}`} className="mt-3 inline-block">
                            <Button size="sm" variant="outline"><ExternalLink className="h-4 w-4" /> Ver dossiê</Button>
                          </Link>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ---------------- AUDITORIA ---------------- */}
              {aba === 'auditoria' && (
                p.auditoria.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">Sem registros de auditoria.</p>
                ) : (
                  <ul className="space-y-2">
                    {p.auditoria.map((a) => (
                      <li key={a.id} className="rounded-lg border bg-card p-3">
                        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                          <span className="rounded bg-muted px-2 py-0.5 font-mono text-[10px] font-semibold uppercase text-muted-foreground">
                            {a.acao}{a.entidade ? ` · ${a.entidade}` : ''}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatDataHora(a.createdAt)}{a.user ? ` — ${a.user.nomeExibicao || a.user.nome}` : ''}
                          </span>
                        </div>
                        <p className="text-sm">{a.descricao ?? '—'}</p>
                      </li>
                    ))}
                  </ul>
                )
              )}
            </>
          )}
        </div>

        {/* Rodapé LGPD */}
        <div className="border-t bg-muted/30 px-5 py-3">
          <p className="flex items-start gap-2 text-[11px] leading-snug text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Dados processuais e CPF revelado tratados em conformidade com a Lei Geral de Proteção de Dados
            Pessoais (LGPD), Lei nº 13.709, de 14 de agosto de 2018.
          </p>
        </div>
      </div>
      </div>

      {/* Vincular/cadastrar filiado — resolve sem sair da tela */}
      {p && (
        <VincularFiliadoModal
          open={vinculando}
          processoId={p.id}
          nomeSugerido={p.partesBrutas?.find((x) => x.polo === 'ATIVO')?.nome ?? null}
          onClose={() => setVinculando(false)}
          onVinculado={recarregar}
        />
      )}

      <ConfirmDialog
        open={confirmarExcluir}
        variant="destructive"
        title="Excluir processo"
        icon={<Trash2 className="h-6 w-6" />}
        description={
          <>
            Excluir o processo <strong>{p ? formatNPU(p.numeroCNJ) : ''}</strong>? Toda a linha do tempo
            (<strong>{p?.totais.datajud ?? 0}</strong> do DataJud e <strong>{p?.totais.internas ?? 0}</strong>{' '}
            movimentação[ões] interna[s]) e os <strong>anexos</strong> serão removidos. Esta ação é{' '}
            <strong>irreversível</strong> (o processo pode ser reimportado do DATAJUD, mas os andamentos
            escritos pela equipe <strong>não</strong>).
          </>
        }
        confirmLabel="Excluir processo"
        loading={excluir.isPending}
        onConfirm={() => excluir.mutate()}
        onClose={() => setConfirmarExcluir(false)}
      />

      <ConfirmDialog
        open={!!movParaExcluir}
        variant="destructive"
        title="Remover movimentação"
        icon={<Trash2 className="h-6 w-6" />}
        description={
          <>
            Remover este andamento da linha do tempo? Se ele registrou uma mudança de status, o status
            atual do processo <strong>não</strong> será revertido automaticamente.
          </>
        }
        confirmLabel="Remover"
        loading={removerMov.isPending}
        onConfirm={() => movParaExcluir && removerMov.mutate(movParaExcluir)}
        onClose={() => setMovParaExcluir(null)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Item da linha do tempo (DataJud ou interno)
// ---------------------------------------------------------------------------

/**
 * Caixa rápida para registrar uma nota interna — atalho do formulário completo,
 * já com tipo "Atualização" e a marca de nota interna.
 */
function NotaInternaRapida({ processoId, onRegistrada }: { processoId: string; onRegistrada: () => void }) {
  const [texto, setTexto] = useState('');
  const salvar = useMutation({
    mutationFn: () =>
      registrarMovimentacao(processoId, {
        tipo: 'ATUALIZACAO',
        descricao: texto.trim(),
        notaInterna: true,
      }),
    onSuccess: () => { toast.success('Nota interna registrada.'); setTexto(''); onRegistrada(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível registrar.'),
  });

  return (
    <div className="space-y-2 rounded-xl border bg-muted/20 p-3">
      <textarea
        className="min-h-[70px] w-full resize-y rounded-md border border-input bg-background p-2.5 text-sm"
        placeholder={`Ex.: ${V.filiado} ligou pedindo posição; combinei retorno na sexta.`}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
      />
      <div className="flex justify-end">
        <Button size="sm" onClick={() => salvar.mutate()} disabled={salvar.isPending || texto.trim().length < 3}>
          {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Adicionar nota
        </Button>
      </div>
    </div>
  );
}

/**
 * Síntese/teor do ato (despacho, decisão) com destaque leve: barra lateral e
 * fundo suave, para o olho achar o texto sem competir com o título do card.
 * Continua cortado, com "ver mais" — despacho longo não pode dominar a lista.
 */
function SinteseAto({ texto }: { texto: string }) {
  return (
    <div className="mt-2 rounded-md border-l-2 border-brand-400 bg-brand-50/60 py-1.5 pl-2.5 pr-2 dark:border-brand-600 dark:bg-brand-900/15">
      <p className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-brand-800/70 dark:text-brand-400/80">
        <ScrollText className="h-3 w-3" /> Síntese do ato
      </p>
      <TextoExpansivel texto={texto} nu />
    </div>
  );
}

/**
 * Texto longo com corte: mostra as primeiras linhas e só expande a pedido.
 * Mantém a linha do tempo escaneável mesmo com despachos extensos.
 * `nu` remove a moldura própria (quando já está dentro de um bloco destacado).
 */
function TextoExpansivel({ texto, limite = 180, nu }: { texto: string; limite?: number; nu?: boolean }) {
  const [aberto, setAberto] = useState(false);
  const precisaCortar = texto.length > limite;
  const moldura = nu ? '' : 'mt-1.5 rounded-md bg-muted/40 p-2';

  if (!precisaCortar) {
    return (
      <p className={cn('whitespace-pre-wrap text-xs leading-snug text-foreground/80', moldura)}>
        {texto}
      </p>
    );
  }
  return (
    <div className={moldura || undefined}>
      <p className="whitespace-pre-wrap text-xs leading-snug text-foreground/80">
        {aberto ? texto : `${texto.slice(0, limite).trimEnd()}…`}
      </p>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="mt-1 text-[11px] font-medium text-brand-800 hover:underline dark:text-brand-400"
      >
        {aberto ? 'ver menos' : 'ver mais'}
      </button>
    </div>
  );
}

/**
 * Aba "Publicações" — o teor das intimações, que o DataJud não entrega.
 *
 * Os três estados são distintos de propósito, porque significam coisas
 * diferentes para quem opera: integração DESLIGADA (não há o que esperar),
 * ligada e SEM publicação (o CNJ não publicou nada, ou o processo não tem a
 * OAB do sindicato no polo), e com publicações.
 */
function AbaPublicacoes({
  ativo, bloqueadoNaOrigem, carregando, publicacoes, buscando, onBuscar,
}: {
  ativo: boolean;
  bloqueadoNaOrigem: boolean;
  carregando: boolean;
  publicacoes: PublicacaoDjen[];
  buscando: boolean;
  onBuscar: () => void;
}) {
  /**
   * Bloqueio de origem tem aviso próprio, e não o genérico de erro.
   *
   * O CNJ recusa as consultas vindas do servidor antes de elas chegarem à API
   * dele. Mostrar "erro ao consultar" faria a equipe tentar de novo
   * indefinidamente achando ser instabilidade — quando nenhuma tentativa
   * resolve. Dizer o que é poupa o tempo de todo mundo.
   */
  if (ativo && bloqueadoNaOrigem) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-5 text-center dark:border-amber-900/50 dark:bg-amber-950/20">
        <AlertTriangle className="mx-auto mb-2 h-6 w-6 text-amber-600 dark:text-amber-400" />
        <p className="font-semibold text-amber-900 dark:text-amber-200">
          O CNJ está recusando consultas vindas deste servidor
        </p>
        <p className="mx-auto mt-1 max-w-lg text-xs leading-snug text-amber-800/90 dark:text-amber-300/90">
          O bloqueio é do CDN do CNJ e acontece pela origem da requisição, antes de ela chegar
          à API do DJEN — não é limite de uso nem falha do sistema, e tentar de novo não
          resolve. O acompanhamento pelo DataJud continua funcionando normalmente.
        </p>
      </div>
    );
  }

  if (!ativo) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        <Newspaper className="mx-auto mb-2 h-6 w-6 opacity-60" />
        <p className="font-medium text-foreground">Integração com o DJEN desligada</p>
        <p className="mt-1 text-xs">
          Com ela ligada, o sistema traz o teor das intimações publicadas no Diário de Justiça
          Eletrônico Nacional — e não apenas o rótulo do ato que o DataJud informa.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] leading-snug text-muted-foreground">
          Teor das intimações publicadas no Diário de Justiça Eletrônico Nacional.
        </p>
        <Button size="sm" variant="outline" onClick={onBuscar} disabled={buscando}>
          {buscando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
          Buscar no DJEN
        </Button>
      </div>

      {carregando ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Carregando publicações…</p>
      ) : publicacoes.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          <Inbox className="mx-auto mb-2 h-6 w-6 opacity-60" />
          Nenhuma publicação encontrada para este processo.
        </div>
      ) : (
        <ul className="space-y-2">
          {publicacoes.map((pub) => (
            <li key={pub.id} className="rounded-lg border border-l-4 border-l-indigo-400 bg-card p-3">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300">
                    <Newspaper className="mr-1 inline h-3 w-3" />
                    {pub.tipoComunicacao ?? 'Publicação'}
                  </span>
                  {/* A providência é o que o robô entendeu que precisa ser
                      feito — e é o título que a atividade da agenda recebeu. */}
                  {pub.providencia && PROVIDENCIA_LABEL[pub.providencia] && (
                    <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium">
                      {PROVIDENCIA_LABEL[pub.providencia]}
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground/70">{pub.siglaTribunal}</span>
                </span>
                <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                  {formatData(pub.dataDisponibilizacao)}
                </span>
              </div>

              {pub.nomeOrgao && (
                <p className="mb-1 truncate text-[11px] text-muted-foreground">{pub.nomeOrgao}</p>
              )}

              <TextoExpansivel texto={pub.texto} limite={300} />

              {/* O prazo é o que o TEXTO diz. O sistema não calcula vencimento —
                  a contagem oficial depende de dias úteis forenses, feriado da
                  comarca e forma de intimação. */}
              {pub.prazoMencionadoDias != null && (
                <p className="mt-1.5 flex items-start gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-[11px] leading-snug text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
                  <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                  <span>
                    O texto menciona prazo de <strong>{pub.prazoMencionadoDias} dias</strong>.
                    Confira a contagem oficial — o sistema não calcula vencimento.
                  </span>
                </p>
              )}

              <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px]">
                {pub.compromissoId && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Bot className="h-3 w-3" /> Atividade criada na Agenda
                  </span>
                )}
                {pub.link && (
                  <a
                    href={pub.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 font-medium text-brand-800 hover:underline dark:text-brand-400"
                  >
                    <ExternalLink className="h-3 w-3" /> Ver no tribunal
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="text-[11px] leading-snug text-muted-foreground">
        Publicações obtidas da API Comunica PJe (CNJ). São atos de publicidade oficial, tratados
        em conformidade com a LGPD (Lei nº 13.709/2018) para uso exclusivo na defesa dos filiados.
      </p>
    </>
  );
}

/**
 * Resumo dos graus em que o processo corre.
 *
 * Só aparece quando há MAIS DE UM: com uma instância só, a informação já está
 * no cabeçalho e a faixa seria ruído. Com duas, é a resposta para "por que este
 * processo está encerrado e continua recebendo andamento?".
 */
/**
 * A prova de que o processo acabou — com data e nome do ato.
 *
 * SÓ APARECE QUANDO A FASE É "ARQUIVADO", e existe porque a afirmação sozinha
 * gerou desconfiança justificada: um processo com a etiqueta "Fase de Execução"
 * exibido como arquivado parece erro do sistema. Não era — a execução tinha
 * sido extinta meses antes e o processo arquivado depois. O sistema sabia e não
 * mostrava. Rótulo que ninguém consegue conferir mina a confiança em tudo o
 * mais que a tela afirma.
 *
 * Os atos que REABREM o ciclo (desarquivamento, liquidação, início de execução)
 * aparecem na mesma linha do tempo, em verde: se houver um deles depois do
 * arquivamento, quem olha vê na hora que a conclusão do sistema não fecha — e
 * pode nos avisar em vez de simplesmente deixar de acreditar.
 */
function MarcosDoEncerramento({
  marcos,
}: {
  marcos: { codigo: number; rotulo: string; data: string; reabre: boolean }[];
}) {
  if (!marcos.length) return null;
  const ultimo = marcos[marcos.length - 1];
  return (
    <div className="mx-5 mb-3 rounded-xl border bg-muted/40 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <Archive className="h-3.5 w-3.5" />
        Por que está arquivado
      </p>
      <ol className="space-y-1">
        {marcos.map((m, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
            <span className="w-20 shrink-0 tabular-nums text-muted-foreground">{formatData(m.data)}</span>
            <span className={cn(
              'font-medium',
              m.reabre ? 'text-emerald-700 dark:text-emerald-400' : 'text-foreground',
            )}>
              {m.rotulo}
            </span>
            {m.reabre && <span className="text-[10px] text-muted-foreground">(reabre o ciclo)</span>}
          </li>
        ))}
      </ol>
      <p className="mt-2 border-t pt-1.5 text-[11px] leading-snug text-muted-foreground">
        O último ato do tribunal foi <strong className="text-foreground">{ultimo.rotulo}</strong>, em{' '}
        {formatData(ultimo.data)}, e nenhum grau registrou andamento depois disso. Voltando a andar, o
        processo reabre sozinho na próxima sincronização.
      </p>
    </div>
  );
}

function ResumoInstancias({ instancias }: { instancias: InstanciaProcesso[] }) {
  if (instancias.length < 2) return null;
  return (
    <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50/50 p-3 dark:border-indigo-900/40 dark:bg-indigo-950/10">
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-indigo-800 dark:text-indigo-300">
        <Layers className="h-3.5 w-3.5" /> Este processo corre em {instancias.length} instâncias
      </p>
      <ul className="space-y-1">
        {instancias.map((i) => (
          <li
            key={i.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-card px-3 py-2 text-xs"
          >
            <span className="flex flex-wrap items-center gap-1.5">
              <strong>{rotuloGrau(i.grau, i.tribunal)}</strong>
              {i.orgaoJulgador && (
                <span className="text-muted-foreground">· {i.orgaoJulgador}</span>
              )}
              {i.baixada ? (
                <Badge className="border border-border text-[10px] text-muted-foreground">
                  Baixado
                </Badge>
              ) : (
                <Badge className="bg-emerald-100 text-[10px] text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                  Ativo
                </Badge>
              )}
            </span>
            <span className="whitespace-nowrap text-muted-foreground">
              {i._count?.movimentacoes ?? 0} mov.
              {i.ultimoMovimentoEm && ` · último em ${formatData(i.ultimoMovimentoEm)}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ItemLinhaTempo({
  item, tipos, podeExcluir, onExcluir,
}: {
  item: ItemTimeline;
  tipos: any[];
  podeExcluir: boolean;
  onExcluir: () => void;
}) {
  if (item.origem === 'DATAJUD') {
    const categoria = categoriaMovimento(item.codigoMovimento, item.descricao);
    const cor = classesCor(CATEGORIA_COR[categoria]);
    // Complementos tabelados → "Tipo de petição: Petição (outras)".
    const complementos = (item.complementos ?? []).filter((c) => c?.nome);
    // Título genérico ("Documento", "Petição") não informa nada sozinho: o
    // complemento sobe para o título e sai da lista de baixo (sem repetir).
    const generico = ehTituloGenerico(item.descricao);
    const principal = generico ? complementoPrincipal(complementos) : null;
    const restantes = principal ? complementos.filter((c) => c !== principal) : complementos;
    return (
      <li className={cn('flex gap-3 rounded-lg border border-l-4 bg-card p-3', cor.borda)}>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', cor.badge)}>
                <Landmark className="mr-1 inline h-3 w-3" />
                {CATEGORIA_LABEL[categoria]}
              </span>
              {/* Grau que praticou o ato. Sem ele, "Conclusão" do 1º e do 2º
                  grau apareceriam lado a lado sem nada que os distinguisse. */}
              {item.grau && (
                <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {rotuloGrau(item.grau)}
                </span>
              )}
              {item.codigoMovimento != null && (
                <span className="font-mono text-[10px] text-muted-foreground/70">
                  CNJ {item.codigoMovimento}
                </span>
              )}
            </span>
            <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
              {formatDataHora(item.data)}
            </span>
          </div>

          {/* Título do ato — genérico ganha o complemento junto */}
          <p className="text-sm font-medium">
            {item.descricao}
            {principal && (
              <>
                <span className="text-muted-foreground"> — </span>
                {principal.nome}
              </>
            )}
          </p>
          {/* Rótulo do complemento promovido, para não perder o "o que é isso" */}
          {principal && (
            <p className="text-[11px] text-muted-foreground/70">{rotuloComplemento(principal.descricao)}</p>
          )}
          {/* Título genérico e o tribunal não mandou subtipo: deixamos explícito
              que a informação não existe na origem — não é falha da extração. */}
          {generico && !principal && (
            <p className="text-[11px] italic text-muted-foreground/60">
              Sem detalhamento informado pelo tribunal
            </p>
          )}

          {/* Demais complementos, cada um com seu rótulo */}
          {restantes.length > 0 && (
            <ul className="mt-0.5 space-y-0.5">
              {restantes.map((c, i) => (
                <li key={i} className="text-xs text-muted-foreground">
                  <span className="text-muted-foreground/70">{rotuloComplemento(c.descricao)}:</span>{' '}
                  <span className="font-medium text-foreground/80">{c.nome}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Síntese do ato (teor do despacho/decisão) — destaque leve */}
          {item.conteudo && <SinteseAto texto={item.conteudo} />}

          {item.orgaoJulgador && (
            <p className="mt-1 truncate text-[10px] text-muted-foreground/70">{item.orgaoJulgador}</p>
          )}
        </div>
      </li>
    );
  }

  const cor = corTipoMov(item.tipo, tipos);
  return (
    <li className={cn('flex gap-3 rounded-lg border border-l-4 bg-card p-3', cor.borda, item.notaInterna && 'bg-amber-50/40 dark:bg-amber-950/10')}>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
          <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', cor.badge)}>
            {rotuloTipoMov(item.tipo, tipos)}
          </span>
          {item.notaInterna && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              <Lock className="h-3 w-3" /> Nota interna
            </span>
          )}
          {item.statusNovo && (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              <ScrollText className="h-3 w-3" />
              {item.statusAnterior ? STATUS_PROCESSO_LABEL[item.statusAnterior] : '—'} → {STATUS_PROCESSO_LABEL[item.statusNovo]}
            </span>
          )}
        </div>
        <TextoExpansivel texto={item.descricao} limite={220} />
        {item.anexo && (
          <a
            href={item.anexo.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-brand-800 hover:bg-muted dark:text-brand-400"
          >
            <Paperclip className="h-3 w-3" /> {item.anexo.nomeArquivo} <Download className="h-3 w-3" />
          </a>
        )}
        {item.autor && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            por {item.autor.nomeExibicao || item.autor.nome}
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {/* A data exibida é a do FATO quando informada. O carimbo do registro
            vira legenda — sem isso, "quarta" e "sexta" seriam indistinguíveis. */}
        <span className="whitespace-nowrap text-xs text-muted-foreground">{formatDataHora(item.data)}</span>
        {item.dataFato && (
          <span
            className="whitespace-nowrap text-[10px] text-muted-foreground/70"
            title={`Lançado no sistema em ${formatDataHora(item.registradoEm)}`}
          >
            registrado em {formatData(item.registradoEm)}
          </span>
        )}
        {podeExcluir && (
          <button type="button" onClick={onExcluir} title="Remover movimentação"
            className="rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </li>
  );
}
