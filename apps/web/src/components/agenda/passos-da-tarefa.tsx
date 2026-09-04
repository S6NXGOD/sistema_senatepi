'use client';

import { PROVIDENCIA_LABEL } from '@/lib/djen';

/**
 * O QUE ESTA TAREFA ESPERA — três passos, e os dois últimos são sobre o SISTEMA.
 *
 * O primeiro passo nomeia o trabalho ("elaborar a manifestação") e é o que o
 * advogado menos precisa que alguém diga: ele sabe. Os outros dois é que somem
 * — anexar a peça na atividade e concluir informando o protocolo — e são
 * justamente o que faz o processo ter histórico em vez de ter só uma tarefa
 * fechada sem rastro.
 *
 * Por isso a lista existe e por isso ela é curta: não ensina Direito, lembra o
 * que o registro precisa. Não tem caixa de marcar: o estado da tarefa já é
 * PENDENTE → EM ANDAMENTO → CONCLUÍDA, e um segundo estado paralelo seria duas
 * verdades sobre a mesma coisa.
 */

/** O verbo do primeiro passo, por providência. O resto é igual para todas. */
const PRIMEIRO_PASSO: Record<string, string> = {
  ELABORAR_MANIFESTACAO: 'Elaborar a manifestação',
  JUNTAR_DOCUMENTOS: 'Reunir os documentos pedidos',
  ANALISAR_SENTENCA: 'Ler a sentença e decidir se cabe recurso',
  AVALIAR_RECURSO: 'Avaliar o cabimento do recurso',
  ANALISAR_INTIMACAO: 'Ler a intimação e decidir a providência',
  PREPARAR_AUDIENCIA: 'Preparar a audiência',
  SOLICITAR_DOCUMENTOS_FILIADO: 'Pedir os documentos ao filiado',
  COMUNICAR_FILIADO: 'Falar com o filiado',
};

/**
 * Providências que terminam em PEÇA — nelas faz sentido pedir o anexo. Ligar
 * para o filiado não gera documento, e "anexe aqui" ali seria instrução morta.
 */
const GERA_PECA = new Set([
  'ELABORAR_MANIFESTACAO',
  'JUNTAR_DOCUMENTOS',
  'ANALISAR_SENTENCA',
  'AVALIAR_RECURSO',
]);

export function PassosDaTarefa({ providencia }: { providencia: string | null }) {
  if (!providencia || !PRIMEIRO_PASSO[providencia]) return null;

  const passos = GERA_PECA.has(providencia)
    ? [
        PRIMEIRO_PASSO[providencia],
        'Anexar a peça nesta atividade',
        'Concluir informando o protocolo',
      ]
    : [PRIMEIRO_PASSO[providencia], 'Concluir registrando o que foi feito'];

  return (
    <div className="rounded-xl border bg-muted/30 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        O que esta tarefa espera
      </p>
      <ol className="mt-1.5 space-y-1">
        {passos.map((passo, i) => (
          <li key={passo} className="flex gap-2 text-sm leading-snug">
            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-brand-700 text-[10px] font-bold text-white dark:bg-brand-600">
              {i + 1}
            </span>
            <span>{passo}</span>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
        Classificada como <strong>{PROVIDENCIA_LABEL[providencia] ?? providencia}</strong> a partir
        do texto da publicação. O prazo é o que o tribunal escreveu — o sistema não calcula
        vencimento.
      </p>
    </div>
  );
}
