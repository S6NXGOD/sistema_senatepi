import { CalendarClock, CalendarX2, CheckCircle2, Clock, PlayCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  ESTADO_ENCAMINHAMENTO, rotuloDoEncaminhamento, tomDoEncaminhamento,
  type EstadoEncaminhamento, type Encaminhamento, type FilaNaResposta,
  type StatusAtendimento, type TomDoEstado,
} from '@/lib/atendimentos';

/** Um desenho por estado; `CalendarClock` (marcada) é o padrão. */
const ICONE: Partial<Record<EstadoEncaminhamento, typeof CalendarClock>> = {
  ATENDIDA: CheckCircle2,
  FICOU_PARA_TRAS: Clock,
  CANCELADA: CalendarX2,
  EM_CONSULTA: PlayCircle,
};

const TOM: Record<TomDoEstado, string> = {
  ambar: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300',
  verde: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300',
  /*
    ROSA É IDENTIDADE, NÃO ALARME (18/09/2026) — ver `STATUS_COR` em
    `lib/atendimentos`. Repare que a borda e o texto são mais fracos que os do
    âmbar: quem precisa de alguém continua sendo o mais forte da tela.
  */
  rosa: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300',
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
  /*
    O DESENHO TEM DE DIZER O QUE ACONTECEU (18/09/2026).

    "Consulta cancelada" usava `CalendarClock` — o MESMO ícone de "Consulta
    marcada". Na tabela, as duas linhas ficavam com o mesmo símbolo de
    compromisso agendado, e a única diferença era ler a palavra. O ícone é o que
    o olho pega primeiro; ele não pode dizer o contrário do texto.

    Antes da cor: o calendário riscado separa "não aconteceu" de "vai acontecer"
    mesmo em cinza, o que vale para quem não distingue rosa de âmbar.
  */
  const Icone = ICONE[encaminhamento.estado] ?? CalendarClock;
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
