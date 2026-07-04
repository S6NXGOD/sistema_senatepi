'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Loader2, Download, Snowflake, Fan, Ban, UserPlus, Ticket,
  AlertTriangle, X, CheckCircle2, ArrowLeft, ExternalLink, Eye, FileText, FileDown,
  ChevronDown, Mail, Phone, MapPin, Table2, UserCog, CalendarClock, Save, Clock, Users,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { mascararCpf } from '@/lib/utils';
import { baixarArquivo } from '@/lib/pdf';
import {
  getPainelAdmin, setStatusTemporada, cancelarReserva, executarSorteio,
  definirDataSorteio,
  formatarPeriodoLote, formatarDataHoraLote, FORMACAO_LABEL, LABEL_CLIMATIZACAO, mascaraCpf,
  AVISO_NOSHOW_24H, prazoCancelamento24h,
  LotePainel, Ocupante, TemporadaResumo,
} from '@/lib/colonia';
import { gerarComprovantePdf, ComprovanteInfo } from '@/lib/colonia-comprovante';
import { gerarRelatorioCompletoPdf, gerarRelatorioLotePdf } from '@/lib/colonia-relatorio';
import { AlocarManualModal } from '@/components/colonia/alocar-manual-modal';
import { DrawModal } from '@/components/colonia/draw-modal';
import { SyncFiliadoModal } from '@/components/colonia/sync-filiado-modal';

type SyncArg = { tipo: 'reserva' | 'inscricao'; id: string; filiadoId: string | null; jaSincronizado: boolean };

export default function ColoniaGestaoPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [alocar, setAlocar] = useState<{ loteId: string; numero: number; quartos: LotePainel['quartos'] } | null>(null);
  const [confirmar, setConfirmar] = useState<Ocupante | null>(null);
  const [sorteioModal, setSorteioModal] = useState<{ lote: LotePainel['lote']; inscritos: LotePainel['inscritos'] } | null>(null);
  const [detalhe, setDetalhe] = useState<{ ocupante: Ocupante; lote: LotePainel['lote']; campanha: string } | null>(null);
  const [sincronizar, setSincronizar] = useState<SyncArg | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['colonia-painel', id],
    queryFn: () => getPainelAdmin(id),
  });

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['colonia-painel', id] });
    qc.invalidateQueries({ queryKey: ['colonia-campanhas'] });
  };

  const t = data?.temporada;

  const toggle = useMutation({
    mutationFn: (novo: 'ATIVA' | 'INATIVA') => setStatusTemporada(t!.id, novo),
    onSuccess: (_, novo) => {
      toast.success(novo === 'ATIVA' ? 'Link público ativado — recebendo reservas' : 'Link público desativado');
      invalidar();
    },
    onError: () => toast.error('Não foi possível alterar o status'),
  });

  const cancelar = useMutation({
    mutationFn: (reservaId: string) => cancelarReserva(reservaId, 'Cancelado pela diretoria'),
    onSuccess: (r: any) => {
      const prom = r?.suplentePromovido;
      toast.success(
        prom
          ? `Reserva cancelada — suplente ${prom.nomeCompleto} (${prom.posicaoSuplente}º) assumiu a vaga.`
          : 'Reserva cancelada — vaga devolvida ao público',
      );
      setConfirmar(null);
      invalidar();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Erro ao cancelar'),
  });

  // "Atualizar cadastro": abre o modal de comparação (antes/depois) e seleção.
  const onSincronizar = (arg: SyncArg) => setSincronizar(arg);

  return (
    <div className="space-y-6">
      {/* Cabeçalho + navegação de volta */}
      <div className="flex items-center gap-3">
        <Link href="/colonia-admin">
          <Button variant="ghost" size="icon" aria-label="Voltar às campanhas" title="Voltar"><ArrowLeft className="h-5 w-5" /></Button>
        </Link>
        <div className="min-w-0">
          <Link href="/colonia-admin" className="text-xs text-muted-foreground hover:underline">Campanhas</Link>
          <h2 className="truncate text-2xl font-bold">{t ? t.nome : 'Colônia de Férias'}</h2>
        </div>
      </div>

      {isLoading && <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-senatepi-800 dark:text-senatepi-400" /></div>}

      {!isLoading && !t && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
            Campanha não encontrada.
            <Link href="/colonia-admin"><Button variant="outline"><ArrowLeft className="h-4 w-4" /> Voltar às campanhas</Button></Link>
          </CardContent>
        </Card>
      )}

      {t && (
        <>
          {/* Controle da campanha: toggle do link público + Exportar CSV */}
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  aria-label="Ativar/desativar link público"
                  disabled={toggle.isPending}
                  onClick={() => toggle.mutate(t.status === 'ATIVA' ? 'INATIVA' : 'ATIVA')}
                  className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${t.status === 'ATIVA' ? 'bg-senatepi-600' : 'bg-muted-foreground/30'}`}
                >
                  <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${t.status === 'ATIVA' ? 'left-6' : 'left-1'}`} />
                </button>
                <div>
                  <p className="font-semibold">
                    Link público {t.status === 'ATIVA' ? 'ATIVO' : 'DESATIVADO'}
                    {toggle.isPending && <Loader2 className="ml-2 inline h-3.5 w-3.5 animate-spin" />}
                  </p>
                  <a href={`/colonia/${t.slug}`} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground hover:underline">
                    /colonia/{t.slug} <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
              <ExportarMenu temporadaId={t.id} campanha={t.nome} lotes={data!.lotes} />
            </CardContent>
          </Card>

          {/* Agenda do sorteio público (data/hora anunciada aos inscritos) */}
          <SorteioAgendaCard temporada={t} onSalvar={invalidar} />

          {/* Aviso global: prazo de cancelamento (Termo de No-Show) */}
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
            <Clock className="mt-0.5 h-4 w-4 shrink-0" />
            <span><strong>Prazo de cancelamento:</strong> {AVISO_NOSHOW_24H}</span>
          </div>

          {/* Lotes */}
          {data!.lotes.map((l) => (
            <LoteAdmin key={l.lote.id} l={l}
              onCancelar={(oc) => setConfirmar(oc)}
              onDetalhes={(oc) => setDetalhe({ ocupante: oc, lote: l.lote, campanha: t.nome })}
              onAlocar={() => setAlocar({ loteId: l.lote.id, numero: l.lote.numero, quartos: l.quartos })}
              onAbrirSorteio={() => setSorteioModal({ lote: l.lote, inscritos: l.inscritos })}
              onSincronizar={onSincronizar}
            />
          ))}
        </>
      )}

      {/* Modal alocação manual (autocomplete /api/admin/filiados/buscar) */}
      {alocar && (
        <AlocarManualModal loteId={alocar.loteId} loteNumero={alocar.numero} quartos={alocar.quartos}
          onClose={() => setAlocar(null)} onSuccess={() => { setAlocar(null); invalidar(); }} />
      )}

      {/* Confirmação de cancelamento */}
      {confirmar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setConfirmar(null)}>
          <div className="w-full max-w-sm rounded-xl bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-red-100 dark:bg-red-950/40"><Ban className="h-6 w-6 text-red-600 dark:text-red-400" /></div>
              <h3 className="font-bold">Cancelar reserva</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Cancelar a reserva de <strong>{confirmar.nomeCompleto}</strong> (Quarto {confirmar.quartoNumero} —{' '}
              {confirmar.climatizacao === 'AR_CONDICIONADO' ? 'Ar-condicionado' : 'Ventilador'}). A vaga voltará a ficar
              <strong> disponível ao público na mesma categoria</strong> imediatamente.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmar(null)}>Voltar</Button>
              <Button variant="destructive" disabled={cancelar.isPending} onClick={() => cancelar.mutate(confirmar.reservaId)}>
                {cancelar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Cancelar reserva
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Sorteio Auditável (modal com mascaramento LGPD + suspense + selo) */}
      {sorteioModal && (
        <DrawModal
          lote={sorteioModal.lote}
          inscritos={sorteioModal.inscritos}
          onRealizar={() => executarSorteio(sorteioModal.lote.id)}
          onClose={() => setSorteioModal(null)}
          onSucesso={invalidar}
        />
      )}

      {/* Detalhes do hóspede + emissão do comprovante */}
      {detalhe && (
        <DetalheModal
          ocupante={detalhe.ocupante}
          lote={detalhe.lote}
          campanha={detalhe.campanha}
          onSincronizar={onSincronizar}
          onClose={() => setDetalhe(null)}
        />
      )}

      {/* Atualizar cadastro do filiado (comparação antes/depois + seleção por campo) */}
      {sincronizar && (
        <SyncFiliadoModal
          tipo={sincronizar.tipo}
          id={sincronizar.id}
          filiadoId={sincronizar.filiadoId}
          jaSincronizado={sincronizar.jaSincronizado}
          onClose={() => setSincronizar(null)}
          onConcluido={invalidar}
        />
      )}
    </div>
  );
}

/**
 * Controle de "Atualizar cadastro": botão quando ainda não sincronizado; após
 * sincronizar, vira badge "Atualizado" que só abre a CONSULTA (não re-atualiza).
 */
function BotaoSync({ tipo, id, filiadoId, filiadoCandidatos, sincronizadoEm, onOpen, compact }: {
  tipo: 'reserva' | 'inscricao';
  id: string;
  filiadoId: string | null;
  filiadoCandidatos: number;
  sincronizadoEm: string | null;
  onOpen: (arg: SyncArg) => void;
  compact?: boolean;
}) {
  const abrir = () => onOpen({ tipo, id, filiadoId, jaSincronizado: !!sincronizadoEm });
  // Mostra quando há match (CPF/nome único), candidatos por nome (>1) ou já sincronizado.
  if (!filiadoId && filiadoCandidatos <= 1 && !sincronizadoEm) return null;
  if (sincronizadoEm) {
    return (
      <button
        type="button"
        onClick={abrir}
        title="Ver o que foi atualizado"
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-700 transition-colors hover:bg-green-200 dark:bg-green-900/40 dark:text-green-300 dark:hover:bg-green-900/60"
      >
        <CheckCircle2 className="h-3.5 w-3.5" /> Atualizado
      </button>
    );
  }
  if (compact) {
    return (
      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" title="Atualizar cadastro do filiado" onClick={abrir}>
        <UserCog className="h-4 w-4" />
      </Button>
    );
  }
  return (
    <Button variant="outline" size="sm" title="Atualizar o cadastro do filiado com estes dados" onClick={abrir}>
      <UserCog className="h-4 w-4" /> Atualizar cadastro
    </Button>
  );
}

function LoteAdmin({ l, onCancelar, onDetalhes, onAlocar, onAbrirSorteio, onSincronizar }: {
  l: LotePainel;
  onCancelar: (oc: Ocupante) => void;
  onDetalhes: (oc: Ocupante) => void;
  onAlocar: () => void;
  onAbrirSorteio: () => void;
  onSincronizar: (arg: SyncArg) => void;
}) {
  const q6Ocupado = l.quartos.find((q) => q.numero === 6)?.ocupado;
  const temQuartoLivre = l.quartos.some((q) => !q.ocupado);
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            Lote {l.lote.numero}
            {l.esgotado && <Badge className="bg-muted text-muted-foreground">Esgotado</Badge>}
            {l.sorteioHabilitado && <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">Sorteio aberto</Badge>}
          </CardTitle>
          <p className="text-xs text-muted-foreground">{formatarPeriodoLote(l.lote.dataInicio, l.lote.dataFim)}</p>
        </div>
        {temQuartoLivre && (
          <Button size="sm" variant="outline" onClick={onAlocar}><UserPlus className="h-4 w-4" /> Alocar Manualmente</Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Ocupantes — no mobile a 1ª (Quarto) e a última (Ação) colunas ficam fixas */}
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <th className="sticky left-0 z-20 border-r bg-muted px-3 py-2 font-medium">Quarto</th>
                <th className="px-3 py-2 font-medium">Nome</th>
                <th className="px-3 py-2 font-medium">CPF</th>
                <th className="px-3 py-2 font-medium">COREN</th>
                <th className="px-3 py-2 font-medium">Profissão</th>
                <th className="px-3 py-2 font-medium">Locais de trabalho</th>
                <th className="px-3 py-2 font-medium">Origem</th>
                <th className="sticky right-0 z-20 border-l bg-muted px-3 py-2 text-right font-medium">Ação</th>
              </tr>
            </thead>
            <tbody>
              {l.ocupacao.map((o) => {
                const ar = o.climatizacao === 'AR_CONDICIONADO';
                return (
                  <tr key={o.reservaId} className="border-b align-top last:border-0">
                    <td className="sticky left-0 z-10 border-r bg-card px-3 py-2">
                      <div className="flex items-center gap-2">
                        {ar
                          ? <Snowflake className="h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
                          : <Fan className="h-4 w-4 shrink-0 text-senatepi-600 dark:text-senatepi-400" />}
                        <div className="leading-tight">
                          <div className="font-medium">Quarto {o.quartoNumero}</div>
                          <div className="text-xs text-muted-foreground">{ar ? 'Quarto com Ar-condicionado' : 'Quarto com Ventilador'}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 font-medium">{o.nomeCompleto}</td>
                    <td className="px-3 py-2 tabular-nums">{mascararCpf(o.cpf)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{o.coren ?? '—'}</td>
                    <td className="px-3 py-2">{FORMACAO_LABEL[o.formacao]}</td>
                    <td className="px-3 py-2 text-xs">{[o.localTrabalho1, o.localTrabalho2].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="px-3 py-2">
                      <Badge className={
                        o.alocacaoManual ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'
                          : o.origem === 'SORTEIO' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                          : 'bg-muted text-muted-foreground'}>
                        {o.alocacaoManual ? 'Manual' : o.origem === 'SORTEIO' ? 'Sorteio' : 'Direta'}
                      </Badge>
                    </td>
                    <td className="sticky right-0 z-10 border-l bg-card px-3 py-2">
                      <div className="flex items-center justify-end gap-1.5">
                        <BotaoSync tipo="reserva" id={o.reservaId} filiadoId={o.filiadoId} filiadoCandidatos={o.filiadoCandidatos} sincronizadoEm={o.sincronizadoEm} onOpen={onSincronizar} />
                        <Button variant="outline" size="sm" onClick={() => onDetalhes(o)}>
                          <Eye className="h-4 w-4" /> Detalhes
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => onCancelar(o)}>
                          <Ban className="h-4 w-4" /> Cancelar
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {l.ocupacao.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">Nenhuma reserva neste lote ainda.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Sorteio */}
        {(l.inscritos.length > 0 || l.sorteioHabilitado) && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-900/40 dark:bg-amber-950/10">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300"><Ticket className="h-4 w-4" /> Sorteio — Quarto 6 (Ventilador)</p>
              <Button size="sm" className="bg-amber-500 text-white hover:bg-amber-600" disabled={l.inscritos.length === 0 || q6Ocupado}
                onClick={onAbrirSorteio}>
                <Ticket className="h-4 w-4" /> Abrir Sorteio Auditável
              </Button>
            </div>
            {q6Ocupado ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4" /> Quarto 6 já ocupado.</p>
            ) : l.inscritos.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground"><AlertTriangle className="h-4 w-4" /> Sorteio aberto, aguardando inscritos.</p>
            ) : (
              <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {l.inscritos.map((i, idx) => (
                  <li key={i.id} className="flex items-center gap-2 rounded-md border bg-card p-2 text-sm">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-semibold">{idx + 1}</span>
                    <span className="flex-1 truncate">{i.nomeCompleto}</span>
                    <span className="text-xs text-muted-foreground">{mascararCpf(i.cpf)}</span>
                    <BotaoSync tipo="inscricao" id={i.id} filiadoId={i.filiadoId} filiadoCandidatos={i.filiadoCandidatos} sincronizadoEm={i.sincronizadoEm} onOpen={onSincronizar} compact />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Fila de suplentes (após o sorteio): entram automaticamente se uma reserva do sorteio for cancelada */}
        {l.suplentes.length > 0 && (
          <div className="rounded-lg border border-sky-200 bg-sky-50/50 p-4 dark:border-sky-900/40 dark:bg-sky-950/10">
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-sky-800 dark:text-sky-300">
              <Users className="h-4 w-4" /> Fila de suplentes — entram automaticamente ao cancelar a reserva do sorteio
            </p>
            <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {l.suplentes.map((s) => (
                <li key={s.id} className="flex items-center gap-2 rounded-md border bg-card p-2 text-sm">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-100 text-xs font-bold text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">{s.posicao}º</span>
                  <span className="flex-1 truncate">{s.nomeCompleto}</span>
                  <span className="text-xs text-muted-foreground">{mascararCpf(s.cpf)}</span>
                  <BotaoSync tipo="inscricao" id={s.id} filiadoId={s.filiadoId} filiadoCandidatos={s.filiadoCandidatos} sincronizadoEm={s.sincronizadoEm} onOpen={onSincronizar} compact />
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Menu de exportação: CSV + Relatório Completo (PDF) + Relatório por Lote (PDF)
// ---------------------------------------------------------------------------

function ExportarMenu({ temporadaId, campanha, lotes }: { temporadaId: string; campanha: string; lotes: LotePainel[] }) {
  const [aberto, setAberto] = useState(false);
  const [picker, setPicker] = useState(false);
  const [gerando, setGerando] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  async function comGerando(fn: () => Promise<void>) {
    setGerando(true);
    try { await fn(); } catch { toast.error('Não foi possível gerar o documento.'); } finally { setGerando(false); }
  }

  const itemCls = 'flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm hover:bg-muted';

  return (
    <div className="relative" ref={ref}>
      <Button variant="outline" onClick={() => setAberto((v) => !v)} disabled={gerando}>
        {gerando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        Exportar <ChevronDown className="h-4 w-4" />
      </Button>

      {aberto && (
        <div className="absolute right-0 z-20 mt-2 w-64 overflow-hidden rounded-lg border bg-card py-1 shadow-lg">
          <button
            className={itemCls}
            onClick={() => {
              setAberto(false);
              baixarArquivo(`/colonia/admin/relatorio.csv?temporadaId=${temporadaId}`, `colonia-${campanha}.csv`)
                .catch(() => toast.error('Falha ao exportar CSV.'));
            }}
          >
            <Table2 className="h-4 w-4 text-muted-foreground" /> Exportar CSV (Dados Brutos)
          </button>
          <button
            className={itemCls}
            onClick={() => { setAberto(false); comGerando(() => gerarRelatorioCompletoPdf(campanha, lotes)); }}
          >
            <FileText className="h-4 w-4 text-senatepi-700 dark:text-senatepi-400" /> Baixar Relatório Completo (PDF)
          </button>
          <button
            className={itemCls}
            onClick={() => { setAberto(false); setPicker(true); }}
          >
            <FileDown className="h-4 w-4 text-senatepi-700 dark:text-senatepi-400" /> Baixar Relatório por Lote (PDF)
          </button>
        </div>
      )}

      {/* Seletor de lote para o relatório de conferência */}
      {picker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setPicker(false)}>
          <div className="w-full max-w-sm rounded-xl bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-bold">Relatório por Lote</h3>
              <Button variant="ghost" size="icon" onClick={() => setPicker(false)}><X className="h-4 w-4" /></Button>
            </div>
            <p className="mb-3 text-sm text-muted-foreground">Escolha o lote para imprimir a lista de conferência do check-in.</p>
            <div className="space-y-2">
              {lotes.map((l) => (
                <button
                  key={l.lote.id}
                  className="flex w-full items-center justify-between rounded-lg border p-3 text-left text-sm transition-colors hover:border-senatepi-600 hover:bg-muted"
                  onClick={() => { setPicker(false); comGerando(() => gerarRelatorioLotePdf(campanha, l)); }}
                >
                  <span className="font-medium">Lote {l.lote.numero}</span>
                  <span className="text-xs text-muted-foreground">{l.ocupacao.length} hóspede(s)</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detalhes do hóspede + emissão do comprovante (mesmo PDF do fluxo público)
// ---------------------------------------------------------------------------

function DetalheModal({ ocupante: o, lote, campanha, onSincronizar, onClose }: {
  ocupante: Ocupante;
  lote: LotePainel['lote'];
  campanha: string;
  onSincronizar: (arg: SyncArg) => void;
  onClose: () => void;
}) {
  const [gerando, setGerando] = useState(false);
  const ar = o.climatizacao === 'AR_CONDICIONADO';
  const prazo = prazoCancelamento24h(o.createdAt);

  async function baixarComprovante() {
    setGerando(true);
    try {
      const info: ComprovanteInfo = {
        protocolo: o.reservaId,
        tipo: ar ? 'AR' : 'VENTILADOR',
        campanha,
        nome: o.nomeCompleto,
        cpf: o.cpf,
        loteNumero: lote.numero,
        dataInicio: lote.dataInicio,
        dataFim: lote.dataFim,
        quartoNumero: o.quartoNumero,
        climatizacao: o.climatizacao,
      };
      await gerarComprovantePdf(info);
    } catch {
      toast.error('Não foi possível gerar o comprovante.');
    } finally {
      setGerando(false);
    }
  }

  const Campo = ({ rotulo, valor, Icon }: { rotulo: string; valor: React.ReactNode; Icon?: any }) => (
    <div className="min-w-0">
      <p className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
        {Icon && <Icon className="h-3 w-3" />} {rotulo}
      </p>
      <p className="break-words text-sm font-medium">{valor || '—'}</p>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-card shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-muted p-2">
              {ar ? <Snowflake className="h-6 w-6 text-sky-600 dark:text-sky-400" /> : <Fan className="h-6 w-6 text-senatepi-600 dark:text-senatepi-400" />}
            </div>
            <div>
              <h3 className="font-semibold leading-tight">{o.nomeCompleto}</h3>
              <p className="text-xs text-muted-foreground">Lote {lote.numero} · Quarto {o.quartoNumero} — {LABEL_CLIMATIZACAO[o.climatizacao]}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div className="rounded-lg border bg-muted/40 p-3 text-sm">
            <p><span className="text-muted-foreground">Check-in:</span> <strong>{formatarDataHoraLote(lote.dataInicio)}</strong></p>
            <p><span className="text-muted-foreground">Check-out:</span> <strong>{formatarDataHoraLote(lote.dataFim)}</strong></p>
          </div>

          {/* Prazo de cancelamento (Termo de No-Show) */}
          <div className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
            prazo.expirado
              ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300'
              : 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200'}`}>
            <Clock className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {prazo.expirado
                ? <><strong>Prazo de cancelamento expirado</strong> (era até {prazo.texto}). Aplicam-se as penalidades do Termo de No-Show.</>
                : <>Prazo para cancelamento sem penalidade: <strong>até {prazo.texto}</strong> (24h após a reserva).</>}
            </span>
          </div>

          {o.filiadoId && (
            <div className="rounded-lg border border-senatepi-200 bg-senatepi-50/50 p-3 dark:border-senatepi-900/40 dark:bg-senatepi-900/10">
              <p className="mb-2 text-sm text-muted-foreground">
                {o.sincronizadoEm
                  ? 'Os dados desta reserva já foram subidos para o cadastro do filiado. Consulte o que foi atualizado.'
                  : 'Existe um cadastro de filiado com este CPF. Você pode subir os dados desta reserva como atualização de informações.'}
              </p>
              <BotaoSync tipo="reserva" id={o.reservaId} filiadoId={o.filiadoId} filiadoCandidatos={o.filiadoCandidatos} sincronizadoEm={o.sincronizadoEm} onOpen={onSincronizar} />
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Campo rotulo="CPF" valor={mascaraCpf(o.cpf)} />
            <Campo rotulo="COREN" valor={o.coren} />
            <Campo rotulo="Formação" valor={FORMACAO_LABEL[o.formacao]} />
            <Campo rotulo="Telefone" valor={o.telefone} Icon={Phone} />
            <Campo rotulo="E-mail" valor={o.email} Icon={Mail} />
            <Campo rotulo="Cidade / Estado" valor={`${o.cidade} / ${o.estado}`} Icon={MapPin} />
            <Campo rotulo="Local de trabalho 1" valor={o.localTrabalho1} />
            <Campo rotulo="Local de trabalho 2" valor={o.localTrabalho2} />
          </div>

          <div>
            <Badge className={
              o.alocacaoManual ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'
                : o.origem === 'SORTEIO' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                : 'bg-muted text-muted-foreground'}>
              Origem: {o.alocacaoManual ? 'Alocação manual' : o.origem === 'SORTEIO' ? 'Sorteio' : 'Reserva direta'}
            </Badge>
          </div>
        </div>

        <div className="border-t p-4">
          <Button className="w-full" onClick={baixarComprovante} disabled={gerando}>
            {gerando ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
            Baixar Comprovante de Reserva (PDF)
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agenda do sorteio público: data/hora anunciada aos inscritos (área pública)
// ---------------------------------------------------------------------------

function SorteioAgendaCard({ temporada, onSalvar }: { temporada: TemporadaResumo; onSalvar: () => void }) {
  const [valor, setValor] = useState(() => paraInputLocal(temporada.dataSorteio));

  const salvar = useMutation({
    mutationFn: (iso: string | null) => definirDataSorteio(temporada.id, iso),
    onSuccess: () => { toast.success('Data do sorteio atualizada.'); onSalvar(); },
    onError: () => toast.error('Não foi possível salvar a data do sorteio.'),
  });

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-amber-100 p-2 dark:bg-amber-950/40">
            <CalendarClock className="h-6 w-6 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <p className="font-semibold">Sorteio público</p>
            <p className="text-xs text-muted-foreground">
              {temporada.dataSorteio
                ? `Agendado para ${new Date(temporada.dataSorteio).toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short' })}`
                : 'Sem data definida — anuncie a data do sorteio ao vivo na área pública'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="datetime-local"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            className="h-12 rounded-md border border-input md:h-10 bg-background px-3 text-base md:text-sm"
          />
          <Button size="sm" disabled={salvar.isPending}
            onClick={() => salvar.mutate(valor ? new Date(valor).toISOString() : null)}>
            {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar
          </Button>
          {temporada.dataSorteio && (
            <Button size="sm" variant="outline" disabled={salvar.isPending}
              onClick={() => { setValor(''); salvar.mutate(null); }}>
              Limpar
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** Converte ISO → valor de <input type="datetime-local"> (horário local). */
function paraInputLocal(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
