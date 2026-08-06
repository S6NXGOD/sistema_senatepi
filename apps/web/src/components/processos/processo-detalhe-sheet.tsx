'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  X, RefreshCw, Loader2, Landmark, FileText, CalendarDays, ShieldCheck, Trash2,
  Clock, History, Users, Search, Lock, Paperclip, Download, ArrowRight, ExternalLink,
  BadgeCheck, Gavel, Phone, Mail, GraduationCap, User as UserIcon, ScrollText,
  AlertTriangle, Plus, Tag, Bot, Newspaper, Layers, Inbox,
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
  ehTituloGenerico, complementoPrincipal, rotuloGrau,
  type ItemTimeline, type InstanciaProcesso,
} from '@/lib/movimentacoes';
import {
  listarPublicacoes, sincronizarPublicacoes, statusDjen,
  PROVIDENCIA_LABEL, type PublicacaoDjen,
} from '@/lib/djen';
import { classesCor } from '@/lib/paleta-cores';

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
  const [busca, setBusca] = useState('');
  const [filtroOrigem, setFiltroOrigem] = useState<'todas' | 'INTERNA' | 'DATAJUD'>('todas');
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
    if (open) { setAba('timeline'); setBusca(''); setFiltroOrigem('todas'); }
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

  // Filtro da linha do tempo (busca textual + origem).
  const timeline = useMemo(() => {
    const itens = p?.linhaDoTempo ?? [];
    const termo = busca.trim().toLowerCase();
    return itens.filter((i) => {
      if (filtroOrigem !== 'todas' && i.origem !== filtroOrigem) return false;
      if (!termo) return true;
      return i.descricao.toLowerCase().includes(termo);
    });
  }, [p?.linhaDoTempo, busca, filtroOrigem]);

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
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho rico */}
        <div className="border-b p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-senatepi-50 dark:bg-senatepi-900/30">
                <Gavel className="h-5 w-5 text-senatepi-800 dark:text-senatepi-400" />
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
                      className="inline-flex items-center gap-1 rounded-full bg-senatepi-50 px-2.5 py-0.5 text-xs font-semibold text-senatepi-800 dark:bg-senatepi-900/40 dark:text-senatepi-300"
                      title="Ação coletiva movida pelo SENATEPI em nome da categoria"
                    >
                      🏛️ Ação Institucional (SENATEPI)
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
                    {p.advogado && (
                      <span>
                        Responsável: <strong className="text-foreground">{p.advogado.nomeExibicao || p.advogado.nome}</strong>
                        {p.totais.advogados > 1 && ` +${p.totais.advogados - 1}`}
                      </span>
                    )}
                    {/* A linha do filiado NUNCA some — sem vínculo vira alerta acionável. */}
                    {p.filiado ? (
                      <span>
                        Filiado: <strong className="text-foreground">{p.filiado.nomeCompleto}</strong>
                        {p.totais.filiados > 1 && ` +${p.totais.filiados - 1}`}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        Filiado:
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                          <AlertTriangle className="h-3 w-3" /> Sem filiado vinculado
                        </span>
                        {podeEditar && (
                          <button
                            type="button"
                            onClick={() => { setAba('partes'); setVinculando(true); }}
                            className="font-medium text-senatepi-800 hover:underline dark:text-senatepi-400"
                          >
                            Vincular filiado
                          </button>
                        )}
                      </span>
                    )}
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
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditandoEtiquetas(false)}>Cancelar</Button>
                    <Button size="sm" onClick={() => salvarEtiquetas.mutate()} disabled={salvarEtiquetas.isPending}>
                      {salvarEtiquetas.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Salvar etiquetas
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-1.5">
                  {(p.etiquetas ?? []).map((e) => (
                    <span key={e} className="rounded-full bg-senatepi-50 px-2.5 py-0.5 text-xs font-medium text-senatepi-800 dark:bg-senatepi-900/30 dark:text-senatepi-400">
                      {e}
                    </span>
                  ))}
                  {podeEditar && (
                    <button
                      type="button"
                      onClick={() => { setEtiquetasEdit(p.etiquetas ?? []); setEditandoEtiquetas(true); }}
                      className="inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-[11px] text-muted-foreground transition hover:border-senatepi-400 hover:text-foreground"
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

          {/* Instâncias — só quando há mais de uma, senão é ruído */}
          <ResumoInstancias instancias={p?.instancias ?? []} />

          {/* Abas */}
          <div className="mt-3 flex gap-1 overflow-x-auto rounded-lg border bg-muted/30 p-1">
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
                    'flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition',
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

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
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
                    {/* Registrar movimentação fica ao ALCANCE — sem rolar até o fim */}
                    {podeEditar && (
                      <Button size="sm" variant={registrando ? 'outline' : 'default'} onClick={() => setRegistrando((v) => !v)}>
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

                  {/* Dossiê DataJud */}
                  <section className="rounded-xl border bg-card p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h4 className="flex items-center gap-2 text-sm font-semibold">
                        <Landmark className="h-4 w-4 text-senatepi-800 dark:text-senatepi-400" /> Dossiê DataJud
                      </h4>
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Dados oficiais do CNJ</span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                      <CampoDossie label="Tribunal">{p.tribunal ?? '—'}</CampoDossie>
                      <CampoDossie label="Órgão Julgador">{p.orgaoJulgador ?? '—'}</CampoDossie>
                      <CampoDossie label="Grau">{p.grau ?? '—'}</CampoDossie>
                      <CampoDossie label="Classe">{p.classeProcessual ?? '—'}</CampoDossie>
                      <CampoDossie label="Distribuição">{formatData(p.dataDistribuicao)}</CampoDossie>
                      <CampoDossie label="Valor da causa">{formatMoeda(p.valorCausa)}</CampoDossie>
                      <CampoDossie label="Formato">{p.formato ?? '—'}</CampoDossie>
                      <CampoDossie label="Sistema">{p.sistema ?? '—'}</CampoDossie>
                      <CampoDossie label="Movimentações">
                        {p.totais.datajud} <span className="font-normal text-muted-foreground">do CNJ · {p.totais.internas} internas</span>
                      </CampoDossie>
                    </div>
                    {/* Assuntos completos (o principal em destaque) */}
                    {(p.assuntos?.length ? p.assuntos : p.assuntoPrincipal ? [{ nome: p.assuntoPrincipal, codigo: null, principal: true }] : []).length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {(p.assuntos?.length ? p.assuntos : [{ nome: p.assuntoPrincipal, codigo: null, principal: true }]).map((a, i) => (
                          <span key={i} className={cn(
                            'inline-flex rounded-full px-2.5 py-0.5 text-xs',
                            a.principal ? 'bg-senatepi-50 font-medium text-senatepi-800 dark:bg-senatepi-900/30 dark:text-senatepi-400' : 'bg-muted text-muted-foreground',
                          )}>
                            {a.nome}{a.principal ? ' · principal' : ''}
                          </span>
                        ))}
                      </div>
                    )}
                    {p.atualizadoNoCnjEm && (
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        Última atualização no CNJ: {formatDataHora(p.atualizadoNoCnjEm)}
                      </p>
                    )}
                  </section>

                  {/* As partes do processo NÃO vêm mais daqui: a API Pública do
                      DataJud não as devolve (verificado em TJPI, TRT22, TJSP e
                      TRF1). Elas são cadastradas pela equipe e vivem na aba
                      "Partes" — que é a fonte única de quem processou quem. */}

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
                        <Link href="/agenda" className="flex items-center gap-3 rounded-lg border bg-card p-3 transition hover:bg-muted/40">
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
                  {/* Sem filiado: nenhum cadastro provisório é criado — a equipe decide */}
                  {!p.filiado && (
                    <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
                      <p className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
                        <AlertTriangle className="h-4 w-4" /> Sem filiado vinculado
                      </p>
                      <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-300/80">
                        O processo pode ficar assim — o vínculo não é obrigatório. Nenhum cadastro
                        provisório foi criado a partir dos dados do tribunal.
                      </p>
                      {podeEditar && (
                        <div className="mt-3">
                          <Button size="sm" variant="outline" onClick={() => setVinculando(true)}>
                            <UserIcon className="h-4 w-4" /> Vincular ou cadastrar filiado
                          </Button>
                        </div>
                      )}
                    </div>
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
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-senatepi-400 text-lg font-bold text-senatepi-900">
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
        placeholder="Ex.: filiado ligou pedindo posição; combinei retorno na sexta."
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
    <div className="mt-2 rounded-md border-l-2 border-senatepi-400 bg-senatepi-50/60 py-1.5 pl-2.5 pr-2 dark:border-senatepi-600 dark:bg-senatepi-900/15">
      <p className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-senatepi-800/70 dark:text-senatepi-400/80">
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
        className="mt-1 text-[11px] font-medium text-senatepi-800 hover:underline dark:text-senatepi-400"
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
  ativo, carregando, publicacoes, buscando, onBuscar,
}: {
  ativo: boolean;
  carregando: boolean;
  publicacoes: PublicacaoDjen[];
  buscando: boolean;
  onBuscar: () => void;
}) {
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
                    className="flex items-center gap-1 font-medium text-senatepi-800 hover:underline dark:text-senatepi-400"
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
              <strong>{rotuloGrau(i.grau)}</strong>
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
            className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-senatepi-800 hover:bg-muted dark:text-senatepi-400"
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
