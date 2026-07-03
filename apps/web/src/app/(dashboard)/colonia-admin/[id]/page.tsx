'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Loader2, Download, Snowflake, Fan, Ban, UserPlus, Ticket, Trophy,
  AlertTriangle, X, CheckCircle2, ArrowLeft, ExternalLink, Eye, FileText, FileDown,
  ChevronDown, Mail, Phone, MapPin, Table2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { mascararCpf } from '@/lib/utils';
import { baixarArquivo } from '@/lib/pdf';
import {
  getPainelAdmin, setStatusTemporada, cancelarReserva, executarSorteio,
  formatarPeriodoLote, formatarDataHoraLote, FORMACAO_LABEL, LABEL_CLIMATIZACAO, mascaraCpf,
  LotePainel, Ocupante, ResultadoSorteio,
} from '@/lib/colonia';
import { gerarComprovantePdf, ComprovanteInfo } from '@/lib/colonia-comprovante';
import { gerarRelatorioCompletoPdf, gerarRelatorioLotePdf } from '@/lib/colonia-relatorio';
import { AlocarManualModal } from '@/components/colonia/alocar-manual-modal';

export default function ColoniaGestaoPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [alocar, setAlocar] = useState<{ loteId: string; numero: number; quartos: LotePainel['quartos'] } | null>(null);
  const [confirmar, setConfirmar] = useState<Ocupante | null>(null);
  const [resultado, setResultado] = useState<ResultadoSorteio | null>(null);
  const [detalhe, setDetalhe] = useState<{ ocupante: Ocupante; lote: LotePainel['lote']; campanha: string } | null>(null);

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
    onSuccess: () => { toast.success('Reserva cancelada — vaga devolvida ao público'); setConfirmar(null); invalidar(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Erro ao cancelar'),
  });

  const sortear = useMutation({
    mutationFn: (loteId: string) => executarSorteio(loteId),
    onSuccess: (r) => { setResultado(r); toast.success('Sorteio realizado!'); invalidar(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Erro no sorteio'),
  });

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

          {/* Lotes */}
          {data!.lotes.map((l) => (
            <LoteAdmin key={l.lote.id} l={l}
              onCancelar={(oc) => setConfirmar(oc)}
              onDetalhes={(oc) => setDetalhe({ ocupante: oc, lote: l.lote, campanha: t.nome })}
              onAlocar={() => setAlocar({ loteId: l.lote.id, numero: l.lote.numero, quartos: l.quartos })}
              onSortear={() => sortear.mutate(l.lote.id)}
              sorteando={sortear.isPending}
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

      {/* Resultado do sorteio */}
      {resultado && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setResultado(null)}>
          <div className="w-full max-w-md rounded-xl bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-bold"><Trophy className="h-5 w-5 text-amber-500" /> Resultado do Sorteio</h3>
              <Button variant="ghost" size="icon" onClick={() => setResultado(null)}><X className="h-4 w-4" /></Button>
            </div>
            <div className="rounded-lg border border-senatepi-600 bg-senatepi-50 p-3 dark:bg-senatepi-900/20">
              <p className="text-xs uppercase text-senatepi-700 dark:text-senatepi-400">Contemplado(a)</p>
              <p className="font-semibold">{resultado.vencedor.nomeCompleto}</p>
              <p className="text-sm text-muted-foreground">{mascararCpf(resultado.vencedor.cpf)} · {FORMACAO_LABEL[resultado.vencedor.formacao]}</p>
            </div>
            {resultado.suplentes.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-sm font-medium text-muted-foreground">Suplentes (ordem de espera)</p>
                <ol className="space-y-1">
                  {resultado.suplentes.map((s) => (
                    <li key={s.cpf} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-semibold">{s.posicao}</span>
                      <span className="flex-1">{s.nomeCompleto}</span>
                      <span className="text-xs text-muted-foreground">{mascararCpf(s.cpf)}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Detalhes do hóspede + emissão do comprovante */}
      {detalhe && (
        <DetalheModal
          ocupante={detalhe.ocupante}
          lote={detalhe.lote}
          campanha={detalhe.campanha}
          onClose={() => setDetalhe(null)}
        />
      )}
    </div>
  );
}

function LoteAdmin({ l, onCancelar, onDetalhes, onAlocar, onSortear, sorteando }: {
  l: LotePainel;
  onCancelar: (oc: Ocupante) => void;
  onDetalhes: (oc: Ocupante) => void;
  onAlocar: () => void;
  onSortear: () => void;
  sorteando: boolean;
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
        {/* Ocupantes */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <th className="px-3 py-2 font-medium">Quarto</th>
                <th className="px-3 py-2 font-medium">Nome</th>
                <th className="px-3 py-2 font-medium">CPF</th>
                <th className="px-3 py-2 font-medium">COREN</th>
                <th className="px-3 py-2 font-medium">Profissão</th>
                <th className="px-3 py-2 font-medium">Locais de trabalho</th>
                <th className="px-3 py-2 font-medium">Origem</th>
                <th className="px-3 py-2 text-right font-medium">Ação</th>
              </tr>
            </thead>
            <tbody>
              {l.ocupacao.map((o) => {
                const ar = o.climatizacao === 'AR_CONDICIONADO';
                return (
                  <tr key={o.reservaId} className="border-b align-top last:border-0">
                    <td className="px-3 py-2">
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
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1.5">
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
              <Button size="sm" className="bg-amber-500 text-white hover:bg-amber-600" disabled={l.inscritos.length === 0 || sorteando || q6Ocupado}
                onClick={onSortear}>
                {sorteando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trophy className="h-4 w-4" />} Executar Sorteio Auditável
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
                  </li>
                ))}
              </ul>
            )}
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

function DetalheModal({ ocupante: o, lote, campanha, onClose }: {
  ocupante: Ocupante;
  lote: LotePainel['lote'];
  campanha: string;
  onClose: () => void;
}) {
  const [gerando, setGerando] = useState(false);
  const ar = o.climatizacao === 'AR_CONDICIONADO';

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
