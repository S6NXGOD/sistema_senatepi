'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { X, Loader2, ArrowRight, CheckCircle2, CalendarClock, Clock, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { listarPlantao, listarAdvogadosEscala, estaNoHorario } from '@/lib/escalas';
import { listarProcessos, formatNPU } from '@/lib/processos';
import {
  registrarDesfecho, DesfechoAtendimento, TipoEncaminhamento, TIPO_ENC_LABEL,
} from '@/lib/atendimentos';

const inputCls = 'h-12 w-full rounded-md border border-input bg-background px-3 text-base md:h-10 md:text-sm';

function ymd(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export interface AtendimentoParaDesfecho {
  id: string;
  numero: number;
  descricao: string;
  filiado: { id: string; nomeCompleto: string };
}

export function RegistrarDesfechoModal({
  open, onClose, atendimento, onRegistrado,
}: {
  open: boolean;
  onClose: () => void;
  atendimento: AtendimentoParaDesfecho | null;
  onRegistrado: (resultado: DesfechoAtendimento) => void;
}) {
  const [resultado, setResultado] = useState<DesfechoAtendimento>('ENCAMINHADO');
  const [desfechoObs, setDesfechoObs] = useState('');
  const [selecionados, setSelecionados] = useState<{ id: string; nome: string }[]>([]);
  const [tipoEnc, setTipoEnc] = useState<TipoEncaminhamento>('CONSULTA_NOVA');
  const [processoId, setProcessoId] = useState('');
  const [dataConsulta, setDataConsulta] = useState('');

  const hojeKey = ymd(new Date());
  const amanhaKey = ymd(new Date(Date.now() + 864e5));
  const dataAlvo = dataConsulta ? dataConsulta.slice(0, 10) : hojeKey;
  const alvoEhHoje = dataAlvo === hojeKey;

  const plantaoAlvo = useQuery({ queryKey: ['plantao', dataAlvo], queryFn: () => listarPlantao(dataAlvo), enabled: open && resultado === 'ENCAMINHADO' });
  const plantaoAmanha = useQuery({ queryKey: ['plantao', amanhaKey], queryFn: () => listarPlantao(amanhaKey), enabled: open && resultado === 'ENCAMINHADO' && alvoEhHoje });
  const advogados = useQuery({ queryKey: ['escalas-advogados'], queryFn: listarAdvogadosEscala, enabled: open });
  const processos = useQuery({
    queryKey: ['processos-desfecho', atendimento?.filiado.id],
    queryFn: () => listarProcessos({ filiadoId: atendimento?.filiado.id, pageSize: 50 }),
    enabled: open && !!atendimento && tipoEnc === 'ANDAMENTO_PROCESSO',
  });

  useEffect(() => {
    if (open) {
      setResultado('ENCAMINHADO'); setDesfechoObs(''); setSelecionados([]);
      setTipoEnc('CONSULTA_NOVA'); setProcessoId(''); setDataConsulta('');
    }
  }, [open]);

  const idsSelec = useMemo(() => new Set(selecionados.map((s) => s.id)), [selecionados]);
  const addAdv = (id: string, nome: string) => setSelecionados((s) => (s.some((x) => x.id === id) ? s : [...s, { id, nome }]));
  const remAdv = (id: string) => setSelecionados((s) => s.filter((x) => x.id !== id));

  const salvar = useMutation({
    mutationFn: () =>
      registrarDesfecho(atendimento!.id, {
        resultado,
        desfechoObs: desfechoObs.trim() || undefined,
        ...(resultado === 'ENCAMINHADO'
          ? {
              advogadoIds: selecionados.map((s) => s.id),
              tipoEncaminhamento: tipoEnc,
              processoId: tipoEnc === 'ANDAMENTO_PROCESSO' ? processoId : undefined,
              dataConsulta: dataConsulta ? new Date(dataConsulta).toISOString() : undefined,
            }
          : {}),
      }),
    onSuccess: () => {
      onRegistrado(resultado);
      onClose();
    },
    onError: (e: any) => {
      const m = e?.response?.data?.message;
      toast.error(Array.isArray(m) ? m[0] : m ?? 'Não foi possível registrar o desfecho.');
    },
  });

  function submeter() {
    if (resultado === 'ENCAMINHADO') {
      if (selecionados.length === 0) return toast.error('Selecione ao menos um advogado.');
      if (tipoEnc === 'ANDAMENTO_PROCESSO' && !processoId) return toast.error('Selecione o processo existente.');
    }
    salvar.mutate();
  }

  if (!open || !atendimento) return null;

  const ChipPlantao = ({ item, hoje }: { item: any; hoje: boolean }) => {
    const sel = idsSelec.has(item.advogado.id);
    const noHorario = hoje && estaNoHorario(item);
    return (
      <button
        type="button"
        onClick={() => (sel ? remAdv(item.advogado.id) : addAdv(item.advogado.id, item.advogado.nomeExibicao || item.advogado.nome))}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors',
          sel
            ? 'border-emerald-500 bg-emerald-50 text-emerald-700 ring-1 ring-emerald-300 dark:bg-emerald-900/20 dark:text-emerald-300'
            : hoje
              ? 'border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-900/20'
              : 'border-input text-foreground hover:bg-muted',
        )}
      >
        {item.advogado.nomeExibicao || item.advogado.nome}
        <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground"><Clock className="h-3 w-3" />{item.horaInicio}–{item.horaFim}</span>
        {noHorario && <span className="rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">no horário</span>}
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={salvar.isPending ? undefined : onClose}>
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-card shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b p-5">
          <h3 className="text-lg font-bold">Registrar Desfecho</h3>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {/* Contexto do atendimento */}
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Atendimento #{atendimento.numero}</p>
            <p className="font-semibold">{atendimento.filiado.nomeCompleto}</p>
            <p className="line-clamp-2 text-sm text-muted-foreground">{atendimento.descricao}</p>
          </div>

          {/* Resultado */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Resultado *</label>
            <select className={inputCls} value={resultado} onChange={(e) => setResultado(e.target.value as DesfechoAtendimento)}>
              <option value="ENCAMINHADO">Encaminhado para Advogado</option>
              <option value="RESOLVIDO_ATO">Resolvido no Ato</option>
            </select>
          </div>

          {resultado === 'RESOLVIDO_ATO' ? (
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-sm font-medium"><CheckCircle2 className="h-4 w-4 text-senatepi-700 dark:text-senatepi-400" /> O que foi resolvido?</label>
              <textarea className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm" placeholder="Descreva a orientação/solução dada ao filiado…" value={desfechoObs} onChange={(e) => setDesfechoObs(e.target.value)} />
            </div>
          ) : (
            <>
              <p className="flex items-start gap-2 rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-800 dark:bg-sky-950/20 dark:text-sky-300">
                <ArrowRight className="mt-0.5 h-4 w-4 shrink-0" /> Será criado automaticamente um evento de consulta na agenda do advogado.
              </p>

              {/* Plantão do dia-alvo */}
              <div className="space-y-1.5">
                <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <CalendarClock className="h-3.5 w-3.5" />
                  {alvoEhHoje ? 'De plantão hoje' : `De plantão em ${dataAlvo.split('-').reverse().slice(0, 2).join('/')}`} — toque para selecionar
                </p>
                {plantaoAlvo.isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (plantaoAlvo.data ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">Ninguém de plantão neste dia.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">{(plantaoAlvo.data ?? []).map((p) => <ChipPlantao key={p.id} item={p} hoje={alvoEhHoje} />)}</div>
                )}
              </div>

              {/* Sugestão amanhã (só quando o alvo é hoje) */}
              {alvoEhHoje && (plantaoAmanha.data ?? []).length > 0 && (
                <div className="space-y-1.5">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><CalendarClock className="h-3.5 w-3.5" /> Sugestão: plantão de amanhã</p>
                  <div className="flex flex-wrap gap-2">{(plantaoAmanha.data ?? []).map((p) => <ChipPlantao key={p.id} item={p} hoje={false} />)}</div>
                </div>
              )}

              {/* Advogados responsáveis (selecionados + dropdown) */}
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-sm font-medium"><Users className="h-4 w-4 text-muted-foreground" /> Advogado(s) Responsável *</label>
                {selecionados.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {selecionados.map((s) => (
                      <span key={s.id} className="inline-flex items-center gap-1 rounded-full bg-senatepi-100 px-2.5 py-1 text-sm font-medium text-senatepi-800 dark:bg-senatepi-900/40 dark:text-senatepi-300">
                        {s.nome}
                        <button type="button" onClick={() => remAdv(s.id)} className="hover:text-red-600"><X className="h-3.5 w-3.5" /></button>
                      </span>
                    ))}
                  </div>
                )}
                <select
                  className={inputCls}
                  value=""
                  onChange={(e) => { const a = (advogados.data ?? []).find((x) => x.id === e.target.value); if (a) addAdv(a.id, a.nomeExibicao || a.nome); }}
                >
                  <option value="">Selecionar advogado(s)…</option>
                  {(advogados.data ?? []).filter((a) => !idsSelec.has(a.id)).map((a) => (
                    <option key={a.id} value={a.id}>{a.nomeExibicao || a.nome}</option>
                  ))}
                </select>
              </div>

              {/* Tipo de encaminhamento */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Tipo de Encaminhamento *</label>
                <select className={inputCls} value={tipoEnc} onChange={(e) => { setTipoEnc(e.target.value as TipoEncaminhamento); setProcessoId(''); }}>
                  <option value="CONSULTA_NOVA">{TIPO_ENC_LABEL.CONSULTA_NOVA}</option>
                  <option value="ANDAMENTO_PROCESSO">{TIPO_ENC_LABEL.ANDAMENTO_PROCESSO}</option>
                </select>
              </div>

              {tipoEnc === 'ANDAMENTO_PROCESSO' && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Processo Existente *</label>
                  <select className={inputCls} value={processoId} onChange={(e) => setProcessoId(e.target.value)}>
                    <option value="">Selecionar processo…</option>
                    {(processos.data?.items ?? []).map((p) => (
                      <option key={p.id} value={p.id}>{formatNPU(p.numeroCNJ)}{p.classeProcessual ? ` — ${p.classeProcessual}` : ''}</option>
                    ))}
                  </select>
                  {(processos.data?.items ?? []).length === 0 && !processos.isLoading && (
                    <p className="text-xs text-muted-foreground">Este filiado não tem processos cadastrados.</p>
                  )}
                </div>
              )}
            </>
          )}

          {/* Data e hora da consulta (também para resolvido? não — só encaminhado) */}
          {resultado === 'ENCAMINHADO' && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Data e Hora da Consulta <span className="font-normal text-muted-foreground">(se vazio, agendado para amanhã)</span></label>
              <Input type="datetime-local" value={dataConsulta} onChange={(e) => setDataConsulta(e.target.value)} />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t bg-muted/30 p-4">
          <Button variant="outline" onClick={onClose} disabled={salvar.isPending}>Cancelar</Button>
          <Button onClick={submeter} disabled={salvar.isPending}>
            {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : resultado === 'ENCAMINHADO' ? <ArrowRight className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
            {resultado === 'ENCAMINHADO' ? 'Encaminhar' : 'Registrar'}
          </Button>
        </div>
      </div>
    </div>
  );
}
