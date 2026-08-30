'use client';

import { useQuery } from '@tanstack/react-query';
import { CalendarClock, Loader2 } from 'lucide-react';

import { conflitosDeAgenda } from '@/lib/agenda';

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

const diaCurto = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

/**
 * "ESTA PESSOA JÁ TEM COMPROMISSO NESSE HORÁRIO."
 *
 * O BURACO, medido na produção em 27/08/2026: a Dra. Margareth tinha TRÊS
 * consultas encadeadas no dia 31/08 — 12:00–13:00, 12:40–13:40 e 13:20–14:20.
 * Alguém marcou de quarenta em quarenta minutos atendimentos de uma hora, e o
 * sistema não disse nada. Um advogado não se divide em dois; numa audiência a
 * consequência não é constrangimento, é revelia.
 *
 * NÃO BLOQUEIA — e a escolha é deliberada. Sobreposição legítima existe: duas
 * atividades curtas no mesmo bloco, uma que será delegada, uma audiência que já
 * se sabe que será adiada. Recusar obrigaria a equipe a mentir a data para
 * conseguir salvar, que é o pior desfecho possível para um sistema de prazos.
 *
 * APARECE ENQUANTO SE PREENCHE, e não ao salvar. Descobrir o choque depois de
 * confirmar significa voltar, apagar e refazer; descobrir enquanto se escolhe o
 * horário significa escolher outro. É a diferença entre um aviso e uma bronca.
 *
 * SILENCIOSO QUANDO NÃO HÁ NADA: um "sem conflitos" permanente vira ruído que a
 * pessoa aprende a não ler — e aí o dia em que houver conflito ela também não lê.
 */
export function AvisoDeChoque({
  responsavelId,
  inicio,
  fim,
  ignorarId,
}: {
  responsavelId: string;
  /** ISO — nulo enquanto a data/hora ainda não formam um instante válido. */
  inicio: string | null;
  fim: string | null;
  /** Na edição, a própria atividade não conta como choque consigo mesma. */
  ignorarId?: string;
}) {
  const pronto = !!responsavelId && !!inicio && !!fim;

  const { data, isFetching } = useQuery({
    queryKey: ['agenda-conflitos', responsavelId, inicio, fim, ignorarId],
    queryFn: () => conflitosDeAgenda({ responsavelId, inicio: inicio!, fim: fim!, ignorarId }),
    enabled: pronto,
    // A consulta acompanha a digitação: cache curto evita ida ao servidor a
    // cada tecla, mas não pode ser longo — a agenda muda enquanto a pessoa
    // preenche, e um aviso velho é pior que nenhum.
    staleTime: 15_000,
  });

  if (!pronto) return null;

  if (isFetching && !data) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Conferindo a agenda…
      </p>
    );
  }

  if (!data?.length) return null;

  return (
    <div className="space-y-1.5 rounded-lg border border-amber-300 bg-amber-50/70 p-2.5 dark:border-amber-900 dark:bg-amber-950/20">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-900 dark:text-amber-200">
        <CalendarClock className="h-3.5 w-3.5 shrink-0" />
        {data.length === 1
          ? 'Já há uma atividade nesse horário'
          : `Já há ${data.length} atividades nesse horário`}
      </p>
      <ul className="space-y-1">
        {data.map((c) => (
          <li key={c.id} className="flex gap-1.5 text-xs leading-snug">
            <span className="shrink-0 font-mono text-muted-foreground">
              {diaCurto(c.inicio)} {hhmm(c.inicio)}–{hhmm(c.fim)}
            </span>
            {/* `min-w-0` + quebra: o título é o que identifica o choque e não
                pode virar reticências num aviso que existe para ser lido. */}
            <span className="min-w-0 break-words">
              {c.titulo}
              {c.filiado && (
                <span className="text-muted-foreground"> · {c.filiado.nomeCompleto}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-muted-foreground">
        Dá para salvar assim mesmo — às vezes a sobreposição é real. Só confira
        se não é engano antes de comprometer a agenda do responsável.
      </p>
    </div>
  );
}
