'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  X, Loader2, User, Phone, Mail, MapPin, UserCog, Clock, ArrowRight, History,
  Gavel, CheckCircle2, XCircle, RotateCcw, CalendarClock,
} from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { WhatsAppIcon } from '@/components/whatsapp-icon';
import { AtualizacaoCadastralModal } from '@/components/atendimentos/atualizacao-cadastral-modal';
import { AnexosSection } from '@/components/anexos/anexos-section';
import { AtendimentoParaDesfecho } from '@/components/atendimentos/registrar-desfecho-modal';
import {
  getAtendimento, mudarStatusAtendimento, linkWhatsApp, mensagemSaudacao, formatDataHora,
  CANAL_LABEL, DESFECHO_LABEL, DESFECHO_COR, STATUS_LABEL, STATUS_COR, TIPO_ENC_LABEL, StatusAtendimento,
} from '@/lib/atendimentos';
import { formatNPU } from '@/lib/processos';
import { mascararCpf } from '@/lib/utils';

export function AtendimentoDrawer({
  atendimentoId, open, onClose, onMudou, onRegistrarDesfecho,
}: {
  atendimentoId: string | null;
  open: boolean;
  onClose: () => void;
  onMudou?: () => void;
  onRegistrarDesfecho?: (a: AtendimentoParaDesfecho) => void;
}) {
  const qc = useQueryClient();
  const [cadastral, setCadastral] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['atendimento', atendimentoId],
    queryFn: () => getAtendimento(atendimentoId!),
    enabled: open && !!atendimentoId,
  });

  const at = data?.atendimento;
  const filiado = at?.filiado;
  const encaminhado = at?.desfecho === 'ENCAMINHADO';

  const status = useMutation({
    mutationFn: (s: StatusAtendimento) => mudarStatusAtendimento(atendimentoId!, s),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['atendimento', atendimentoId] }); onMudou?.(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível mudar o status.'),
  });

  function abrirWhatsApp() {
    if (!filiado || !at) return;
    const url = linkWhatsApp(filiado.telefonePrincipal, mensagemSaudacao({ nome: filiado.nomeCompleto, data: at.createdAt }));
    if (!url) return toast.error('Filiado sem telefone válido para WhatsApp.');
    window.open(url, '_blank');
  }

  const Linha = ({ Icon, children }: { Icon: any; children: React.ReactNode }) => (
    <p className="flex items-center gap-2 text-sm"><Icon className="h-4 w-4 shrink-0 text-muted-foreground" /> {children}</p>
  );

  return (
    <>
      <Sheet open={open} onClose={onClose} side="right" className="w-full max-w-lg">
        <div className="flex items-center justify-between border-b p-5">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Atendimento {at ? `#${at.numero}` : ''}</p>
            <h3 className="truncate text-lg font-bold">{filiado?.nomeCompleto ?? 'Carregando…'}</h3>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>

        {isLoading || !at || !filiado ? (
          <div className="flex flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-brand-800 dark:text-brand-400" /></div>
        ) : (
          <div className="flex-1 space-y-5 overflow-y-auto p-5">
            {/* Filiado */}
            <div className="rounded-xl border p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 font-semibold"><User className="h-4 w-4 text-brand-700 dark:text-brand-400" /> Filiado</p>
                <Badge className="bg-muted text-muted-foreground">Matrícula {filiado.matricula}</Badge>
              </div>
              <div className="space-y-1.5">
                <Linha Icon={User}>{mascararCpf(filiado.cpf ?? '')}</Linha>
                <Linha Icon={Phone}>{filiado.telefonePrincipal || <span className="text-muted-foreground">sem telefone</span>}</Linha>
                <Linha Icon={Mail}>{filiado.email || <span className="text-muted-foreground">sem e-mail</span>}</Linha>
                <Linha Icon={MapPin}>{[filiado.endereco, filiado.numero, filiado.bairro, filiado.cidade].filter(Boolean).join(', ') || <span className="text-muted-foreground">sem endereço</span>}</Linha>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" className="bg-[#25D366] text-white hover:bg-[#20bd5a]" onClick={abrirWhatsApp}>
                  <WhatsAppIcon className="h-4 w-4" /> WhatsApp
                </Button>
                <Button size="sm" variant="outline" onClick={() => setCadastral(true)}>
                  <UserCog className="h-4 w-4" /> Atualização cadastral
                </Button>
              </div>
            </div>

            {/* Dossiê do atendimento */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-muted text-muted-foreground">{CANAL_LABEL[at.canal]}</Badge>
                {at.desfecho
                  ? <Badge className={DESFECHO_COR[at.desfecho]}>{DESFECHO_LABEL[at.desfecho]}</Badge>
                  : <span className="text-sm italic text-muted-foreground">Sem desfecho</span>}
                <Badge className={STATUS_COR[at.status]}>{STATUS_LABEL[at.status]}</Badge>
                <span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3.5 w-3.5" /> {formatDataHora(at.createdAt)}</span>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Demanda</p>
                <p className="whitespace-pre-wrap text-sm">{at.descricao}</p>
              </div>

              {at.desfecho === 'RESOLVIDO_ATO' && at.desfechoObs && (
                <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Resolução</p>
                  <p className="whitespace-pre-wrap">{at.desfechoObs}</p>
                </div>
              )}

              {encaminhado && (
                <div className="space-y-2 rounded-lg border border-sky-200 bg-sky-50/50 p-3 dark:border-sky-900/40 dark:bg-sky-950/10">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-sky-800 dark:text-sky-300">
                    <ArrowRight className="h-4 w-4" /> Encaminhamento Jurídico
                  </p>
                  <p className="text-sm">{at.tipoEncaminhamento ? TIPO_ENC_LABEL[at.tipoEncaminhamento] : '—'}</p>
                  {at.processo && (
                    <p className="flex items-center gap-1.5 text-sm"><Gavel className="h-3.5 w-3.5 text-muted-foreground" /> {formatNPU(at.processo.numeroCNJ)}{at.processo.classeProcessual ? ` · ${at.processo.classeProcessual}` : ''}</p>
                  )}
                  {at.responsavel && <p className="text-sm">Advogado(s): <strong>{at.responsavel}</strong></p>}
                  {at.compromissos.length > 0 && (
                    <ul className="space-y-1.5 pt-1">
                      {at.compromissos.map((c) => (
                        <li key={c.id} className="flex items-center justify-between gap-2 rounded-md bg-card px-2.5 py-1.5 text-xs">
                          <span className="flex items-center gap-1.5"><CalendarClock className="h-3.5 w-3.5 text-brand-700 dark:text-brand-400" /> {c.responsavel.nome}</span>
                          <span className="text-muted-foreground">{formatDataHora(c.inicio)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <p className="text-xs text-muted-foreground">Registrado por <strong>{at.atendente.nome}</strong></p>
            </div>

            {/* Ações da demanda */}
            <div className="flex flex-wrap gap-2 border-y py-3">
              {!at.desfecho && onRegistrarDesfecho && (
                <Button size="sm" onClick={() => { onRegistrarDesfecho({ id: at.id, numero: at.numero, descricao: at.descricao, filiado: { id: filiado.id, nomeCompleto: filiado.nomeCompleto } }); onClose(); }}>
                  <Gavel className="h-4 w-4" /> Registrar desfecho
                </Button>
              )}
              {at.desfecho && at.status === 'PENDENTE' && (
                <Button size="sm" onClick={() => status.mutate('CONCLUIDO')} disabled={status.isPending}>
                  <CheckCircle2 className="h-4 w-4" /> Marcar como Concluído
                </Button>
              )}
              {at.status !== 'PENDENTE' && (
                <Button size="sm" variant="outline" onClick={() => status.mutate('PENDENTE')} disabled={status.isPending}>
                  <RotateCcw className="h-4 w-4" /> Reabrir
                </Button>
              )}
              {at.status !== 'CANCELADO' && (
                <Button size="sm" variant="outline" className="text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30" onClick={() => status.mutate('CANCELADO')} disabled={status.isPending}>
                  <XCircle className="h-4 w-4" /> Cancelar
                </Button>
              )}
            </div>

            {/* Histórico do filiado */}
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><History className="h-4 w-4" /> Histórico do filiado</p>
              {data.historico.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum atendimento anterior.</p>
              ) : (
                <ul className="space-y-2">
                  {data.historico.map((h) => (
                    <li key={h.id} className="rounded-lg border p-3">
                      <div className="mb-1 flex flex-wrap items-center gap-1.5">
                        <Badge className="bg-muted text-muted-foreground">{CANAL_LABEL[h.canal]}</Badge>
                        {h.desfecho
                          ? <Badge className={DESFECHO_COR[h.desfecho]}>{DESFECHO_LABEL[h.desfecho]}</Badge>
                          : <span className="text-[11px] italic text-muted-foreground">sem desfecho</span>}
                        <Badge className={cn('text-[10px]', STATUS_COR[h.status])}>{STATUS_LABEL[h.status]}</Badge>
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><Clock className="h-3 w-3" /> {formatDataHora(h.createdAt)}</span>
                      </div>
                      <p className="line-clamp-2 text-sm text-muted-foreground">{h.descricao}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Anexos — com "Puxar do acervo" (o filiado não reenvia o que já entregou) */}
            <AnexosSection atendimentoId={at.id} filiadoId={filiado.id} />
          </div>
        )}
      </Sheet>

      {cadastral && filiado && (
        <AtualizacaoCadastralModal
          filiado={filiado}
          onClose={() => setCadastral(false)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['atendimento', atendimentoId] }); onMudou?.(); }}
        />
      )}
    </>
  );
}
