'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  X, RefreshCw, Loader2, Landmark, Scale, FileText, CalendarDays, Coins,
  BadgeCheck, Users, ShieldCheck, Hash, Building2, User as UserIcon,
} from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { TimelineMovimentacoes } from './timeline-movimentacoes';
import { AnexosSection } from '@/components/anexos/anexos-section';
import {
  getProcesso, sincronizarProcesso, formatNPU, formatData, formatDataHora,
  formatMoeda, ParteProcesso, STATUS_PROCESSO_COR, STATUS_PROCESSO_LABEL,
} from '@/lib/processos';

const POLO_LABEL: Record<string, string> = { ATIVO: 'Polo Ativo', PASSIVO: 'Polo Passivo' };

function Campo({ icon: Icon, label, children }: { icon: any; label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </p>
      <p className="mt-0.5 break-words text-sm font-medium text-foreground">{children}</p>
    </div>
  );
}

export function ProcessoDetalheSheet({
  processoId,
  open,
  onClose,
  partesIniciais,
  onChanged,
}: {
  processoId: string | null;
  open: boolean;
  onClose: () => void;
  partesIniciais?: ParteProcesso[];
  onChanged?: () => void;
}) {
  const qc = useQueryClient();
  const [partes, setPartes] = useState<ParteProcesso[]>([]);

  const { data: processo, isLoading } = useQuery({
    queryKey: ['processo', processoId],
    queryFn: () => getProcesso(processoId as string),
    enabled: open && !!processoId,
  });

  // Semeia as partes (vêm de importar/sincronizar — o GET /:id não as retorna).
  useEffect(() => {
    if (open) setPartes(partesIniciais ?? []);
  }, [open, processoId, partesIniciais]);

  const sincronizar = useMutation({
    mutationFn: () => sincronizarProcesso(processoId as string),
    onSuccess: (resp) => {
      setPartes(resp.partes ?? []);
      const n = resp.novasMovimentacoes ?? 0;
      toast.success(
        n > 0 ? `${n} nova(s) movimentação(ões) encontrada(s).` : 'Processo já estava atualizado.',
      );
      qc.invalidateQueries({ queryKey: ['processo', processoId] });
      onChanged?.();
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message ?? 'Não foi possível sincronizar com o DATAJUD.'),
  });

  return (
    <Sheet open={open} onClose={onClose} side="right" className="w-full max-w-2xl">
      {/* Cabeçalho */}
      <div className="flex items-start justify-between gap-3 border-b p-5">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Processo</p>
          <h3 className="truncate font-mono text-lg font-bold" title={processo ? formatNPU(processo.numeroCNJ) : ''}>
            {processo ? formatNPU(processo.numeroCNJ) : '—'}
          </h3>
          {processo && (
            <span className={cn('mt-1 inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium', STATUS_PROCESSO_COR[processo.statusInterno])}>
              {STATUS_PROCESSO_LABEL[processo.statusInterno]}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => sincronizar.mutate()}
            disabled={sincronizar.isPending || !processo}
            title="Buscar novas movimentações no DATAJUD"
          >
            {sincronizar.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">Atualizar movimentações</span>
          </Button>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto p-5">
        {isLoading || !processo ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <>
            {/* Dossiê */}
            <section className="rounded-xl border bg-card p-4">
              <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <FileText className="h-4 w-4 text-senatepi-700 dark:text-senatepi-400" /> Dossiê
              </h4>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                <Campo icon={Landmark} label="Tribunal">{processo.tribunal ?? '—'}</Campo>
                <Campo icon={Building2} label="Órgão Julgador">{processo.orgaoJulgador ?? '—'}</Campo>
                <Campo icon={Hash} label="Grau">{processo.grau ?? '—'}</Campo>
                <Campo icon={FileText} label="Classe">{processo.classeProcessual ?? '—'}</Campo>
                <Campo icon={FileText} label="Assunto">{processo.assuntoPrincipal ?? '—'}</Campo>
                <Campo icon={Coins} label="Valor da Causa">{formatMoeda(processo.valorCausa)}</Campo>
                <Campo icon={CalendarDays} label="Distribuição">{formatData(processo.dataDistribuicao)}</Campo>
                <Campo icon={UserIcon} label="Filiado">{processo.filiado?.nomeCompleto ?? '—'}</Campo>
                <Campo icon={Scale} label="Advogado">{processo.advogado?.nome ?? '—'}</Campo>
              </div>
            </section>

            {/* Partes (com desmascaramento inteligente do CPF) */}
            {partes.length > 0 && (
              <section>
                <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <Users className="h-4 w-4 text-senatepi-700 dark:text-senatepi-400" /> Partes
                </h4>
                <ul className="space-y-2">
                  {partes.map((p, i) => (
                    <li key={i} className="flex items-start justify-between gap-3 rounded-lg border bg-card p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{p.nome ?? 'Parte não identificada'}</p>
                        <p className="text-xs text-muted-foreground">
                          {p.polo ? (POLO_LABEL[p.polo] ?? p.polo) : 'Parte'}
                          {p.documento ? ` · ${p.documento}` : ''}
                        </p>
                      </div>
                      {p.documentoDesmascarado && (
                        <Badge className="shrink-0 gap-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                          <BadgeCheck className="h-3.5 w-3.5" /> CPF Confirmado
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Timeline */}
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h4 className="flex items-center gap-2 text-sm font-semibold">
                  <CalendarDays className="h-4 w-4 text-senatepi-700 dark:text-senatepi-400" /> Linha do Tempo
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    {processo.movimentacoes.length}
                  </span>
                </h4>
                <span className="text-[11px] text-muted-foreground">
                  Sincronizado {formatDataHora(processo.ultimaSincronizacao)}
                </span>
              </div>
              <TimelineMovimentacoes movimentacoes={processo.movimentacoes} />
            </section>

            {/* Anexos (documentos do processo) */}
            <AnexosSection processoId={processo.id} />
          </>
        )}
      </div>

      {/* Rodapé — conformidade LGPD */}
      <div className="border-t bg-muted/30 px-5 py-3">
        <p className="flex items-start gap-2 text-[11px] leading-snug text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Dados processuais e CPF revelado tratados em conformidade com a Lei Geral de Proteção de Dados
          Pessoais (LGPD), Lei nº 13.709, de 14 de agosto de 2018 (Fonte: Diário Oficial da União).
        </p>
      </div>
    </Sheet>
  );
}
