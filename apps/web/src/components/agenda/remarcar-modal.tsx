'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, CalendarClock, History, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  remarcarCompromisso, formatDataHora, paraInputLocal, type Compromisso,
  dataJaPassou, inicioDoDiaBRMs, novoInicioPorAtalho, remarcacaoPermitida,
} from '@/lib/agenda';
import { V } from '@/lib/vocabulario';

/** Atalhos que cobrem a maioria das remarcações reais do balcão. */
const ATALHOS = [
  { label: 'Amanhã', dias: 1 },
  { label: 'Em 3 dias', dias: 3 },
  { label: 'Próxima semana', dias: 7 },
  { label: 'Em 15 dias', dias: 15 },
];

/**
 * Remarcar — ação de UM passo.
 *
 * Antes, "Remarcar" abria o formulário completo de edição: para mudar a data o
 * usuário encarava título, tipo, responsável, filiado, processo e observações.
 * Aqui só existe o que a remarcação é: nova data, e por quê. A duração do
 * evento é preservada pela API quando o fim não é informado.
 */
export function RemarcarModal({
  compromisso, open, onClose, onRemarcado,
}: {
  compromisso: Compromisso | null;
  open: boolean;
  onClose: () => void;
  onRemarcado: () => void;
}) {
  const [inicio, setInicio] = useState('');
  const [motivo, setMotivo] = useState('');

  useEffect(() => {
    if (open && compromisso) {
      setInicio(paraInputLocal(compromisso.inicio));
      setMotivo('');
    }
  }, [open, compromisso]);

  const salvar = useMutation({
    mutationFn: () =>
      remarcarCompromisso(compromisso!.id, {
        inicio: new Date(inicio).toISOString(),
        motivo: motivo.trim() || undefined,
      }),
    onSuccess: () => { toast.success('Atividade remarcada.'); onRemarcado(); onClose(); },
    onError: (e: any) => {
      const m = e?.response?.data?.message;
      toast.error(Array.isArray(m) ? m[0] : m ?? 'Não foi possível remarcar.');
    },
  });

  if (!open || !compromisso) return null;

  /**
   * Mantém a HORA da atividade e empurra o DIA — a partir de HOJE quando o dia
   * marcado já passou. Somar à data antiga levava a tarefa de 02/09, remarcada
   * em 12/09 com "Amanhã", para 03/09: continuava para trás, com +1 no contador.
   */
  function adiar(dias: number) {
    setInicio(paraInputLocal(novoInicioPorAtalho(compromisso!.inicio, dias)));
  }

  const tempoNovo = inicio ? new Date(inicio).getTime() : NaN;
  const novoIso = Number.isFinite(tempoNovo) ? new Date(tempoNovo).toISOString() : null;
  const mudou = !!novoIso && tempoNovo !== new Date(compromisso.inicio).getTime();
  /** O servidor recusa antes do começo de hoje (Teresina); hoje mais cedo vale. */
  const permitida = !!novoIso && remarcacaoPermitida(novoIso);
  const jaPassou = dataJaPassou(compromisso.inicio);
  const duracaoMin = Math.round(
    (new Date(compromisso.fim).getTime() - new Date(compromisso.inicio).getTime()) / 60000,
  );

  return (
    <div
      className="fixed inset-0 z-50 flex animate-overlay-entrar items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={salvar.isPending ? undefined : onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="flex max-h-[92vh] w-full max-w-md animate-dialogo-entrar flex-col overflow-y-auto rounded-t-2xl bg-card shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b p-5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 dark:bg-amber-900/30">
              <CalendarClock className="h-4.5 w-4.5 text-amber-700 dark:text-amber-400" />
            </span>
            <div className="min-w-0">
              <h3 className="text-base font-bold">Remarcar atividade</h3>
              <p className="truncate text-xs text-muted-foreground">{compromisso.titulo}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Data atual: </span>
            <strong>{formatDataHora(compromisso.inicio)}</strong>
            {duracaoMin > 0 && (
              <span className="text-muted-foreground"> · duração {duracaoMin} min (preservada)</span>
            )}
          </div>

          {compromisso.remarcacoes > 0 && (
            <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
              <History className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Já remarcada <strong>{compromisso.remarcacoes}×</strong>
                {compromisso.dataOriginal && <> · original: {formatDataHora(compromisso.dataOriginal)}</>}
              </span>
            </p>
          )}

          {jaPassou && (
            <p className="flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                <strong>Esta data já passou.</strong> Os atalhos contam a partir de hoje e mantêm o horário da atividade.
              </span>
            </p>
          )}

          <div className="space-y-1.5">
            <label htmlFor="nova-data-remarcar" className="text-sm font-medium">Nova data e hora *</label>
            <div className="flex flex-wrap gap-1.5">
              {ATALHOS.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  onClick={() => adiar(a.dias)}
                  className="min-h-11 rounded-full bg-muted px-3 text-xs font-medium text-muted-foreground transition hover:bg-brand-50 hover:text-brand-800 dark:hover:bg-brand-900/30 dark:hover:text-brand-400 sm:min-h-8"
                >
                  {a.label}
                </button>
              ))}
            </div>
            <Input
              id="nova-data-remarcar"
              type="datetime-local"
              value={inicio}
              min={paraInputLocal(new Date(inicioDoDiaBRMs()).toISOString())}
              onChange={(e) => setInicio(e.target.value)}
            />
            {mudou && !permitida && (
              <p className="text-xs text-amber-800 dark:text-amber-300">
                Escolha um dia de hoje em diante. Para corrigir uma data que já passou, use Editar.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Motivo <span className="font-normal text-muted-foreground">(opcional)</span>
            </label>
            <Input
              placeholder={`Ex.: ${V.filiado} pediu para adiar; advogado em audiência.`}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              A data original e o histórico de remarcações ficam registrados na auditoria.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t bg-muted/30 p-4">
          <Button variant="outline" onClick={onClose} disabled={salvar.isPending}>Cancelar</Button>
          <Button onClick={() => salvar.mutate()} disabled={salvar.isPending || !mudou || !permitida}>
            {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
            Remarcar
          </Button>
        </div>
      </div>
    </div>
  );
}
