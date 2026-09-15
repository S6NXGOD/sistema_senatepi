import { CalendarClock, CheckCircle2, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  ESTADO_ENCAMINHAMENTO, rotuloDoEncaminhamento, tomDoEncaminhamento,
  type Encaminhamento, type FilaNaResposta, type StatusAtendimento, type TomDoEstado,
} from '@/lib/atendimentos';

const TOM: Record<TomDoEstado, string> = {
  ambar: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300',
  verde: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300',
  neutro: 'border-border bg-muted/60 text-foreground/80',
};

/**
 * O ESTADO DO ENCAMINHAMENTO — um chip só, para a lista, a gaveta e o painel.
 *
 * O estado vem PRONTO do servidor (`situacaoDoEncaminhamento`). Este componente
 * só escolhe a palavra e a cor: âmbar para o que pede a triagem, verde para
 * atendida, neutro para o que está correndo. Nunca vermelho, e sem pulsar:
 * aviso é estado.
 *
 * Desde 15/09/2026 o tom lê também a FILA: consulta que ficou para trás há
 * menos de 2 dias úteis está na agenda de quem atende, não na da triagem, e
 * fica neutra. Consulta remarcada é sempre neutra.
 *
 * Sem `encaminhamento` (API antiga, ou atendimento sem consulta), não desenha
 * nada — melhor nenhum chip do que um "Pendente" genérico que não diz de quem.
 */
export function ChipEncaminhamento({
  encaminhamento,
  statusAtendimento,
  fila,
  className,
}: {
  encaminhamento: Encaminhamento | null | undefined;
  statusAtendimento: StatusAtendimento;
  /** A fila do atendimento. Ausente na API de antes: vale o tom da tabela. */
  fila?: FilaNaResposta;
  className?: string;
}) {
  if (!encaminhamento) return null;
  const info = ESTADO_ENCAMINHAMENTO[encaminhamento.estado];
  if (!info) return null;
  const Icone = encaminhamento.estado === 'ATENDIDA'
    ? CheckCircle2
    : encaminhamento.estado === 'FICOU_PARA_TRAS' ? Clock : CalendarClock;
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        TOM[tomDoEncaminhamento(encaminhamento.estado, statusAtendimento, fila)],
        className,
      )}
    >
      <Icone className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="truncate">
        {rotuloDoEncaminhamento(encaminhamento.estado, statusAtendimento, encaminhamento.remarcacoes)}
      </span>
    </span>
  );
}
