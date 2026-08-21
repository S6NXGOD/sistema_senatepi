import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * A EQUIPE DE UMA ATIVIDADE — quem responde e quem participa.
 *
 * POR QUE UM ARQUIVO SÓ PARA ISTO
 * -------------------------------------------------------------------------
 * A regra é curta mas é escrita em quatro caminhos diferentes (criar, editar,
 * concluir com seguimento, e os robôs de prazo/audiência). Repetida quatro
 * vezes ela divergiria no primeiro ajuste — foi exatamente o que aconteceu com
 * o selo "Urgente" na tela, copiado em três componentes.
 *
 * O CONTRATO, em uma frase: a lista de participantes é a VERDADE, o
 * `responsavelId` do compromisso é um ATALHO dela, e os dois são escritos na
 * MESMA transação. É o mesmo desenho de `PartesService.sincronizarAtalhos`
 * para `Processo.advogadoId`, e a semelhança é proposital: quem entendeu um
 * entende o outro.
 */

export interface EquipeDesejada {
  /** Quem RESPONDE pela atividade. Sempre exatamente um. */
  principalId: string;
  /**
   * Quem mais atua. O principal pode vir repetido aqui — é normal, porque a
   * tela manda a lista inteira do seletor; a normalização remove.
   */
  participantesIds?: string[];
}

/**
 * Normaliza o que veio da tela numa lista sem repetição, com o responsável
 * SEMPRE primeiro.
 *
 * Aceita o principal dentro ou fora de `participantesIds` de propósito: o
 * seletor da tela é um só, e obrigar o front a separar as duas listas seria
 * transferir para ele uma regra que é nossa.
 */
export function normalizarEquipe(equipe: EquipeDesejada): string[] {
  const { principalId } = equipe;
  if (!principalId) throw new BadRequestException('Informe o responsável pela atividade.');
  const vistos = new Set<string>([principalId]);
  const ordenada = [principalId];
  for (const id of equipe.participantesIds ?? []) {
    const limpo = (id ?? '').trim();
    if (!limpo || vistos.has(limpo)) continue;
    vistos.add(limpo);
    ordenada.push(limpo);
  }
  return ordenada;
}

/**
 * Escreve a equipe e RECALCULA o atalho, na mesma transação.
 *
 * A ORDEM IMPORTA e não é acidental:
 *
 *  1. Apaga quem saiu. Tem de vir antes do passo 2, porque o índice único
 *     parcial `compromisso_um_principal` recusaria um segundo `principal` se o
 *     anterior ainda estivesse lá — e a troca de responsável é justamente o
 *     caso em que isso acontece.
 *  2. Rebaixa TODO MUNDO a participante e só então promove o novo principal.
 *     Um `updateMany` que promovesse antes de rebaixar esbarraria no mesmo
 *     índice.
 *  3. Só no fim o atalho é reescrito — a partir do que ficou gravado, nunca do
 *     que o DTO pediu. Ler de volta é o que impede o atalho de prometer algo
 *     que a tabela não confirma.
 */
export async function sincronizarEquipe(
  tx: Prisma.TransactionClient,
  compromissoId: string,
  equipe: EquipeDesejada,
): Promise<string[]> {
  const ids = normalizarEquipe(equipe);
  const [principalId] = ids;

  // 1. Quem não está mais na equipe sai.
  await tx.compromissoResponsavel.deleteMany({
    where: { compromissoId, usuarioId: { notIn: ids } },
  });

  // 2. Todos viram participantes; depois o responsável é promovido.
  await tx.compromissoResponsavel.updateMany({
    where: { compromissoId, principal: true },
    data: { principal: false },
  });
  for (const usuarioId of ids) {
    await tx.compromissoResponsavel.upsert({
      where: { compromissoId_usuarioId: { compromissoId, usuarioId } },
      create: { compromissoId, usuarioId, principal: usuarioId === principalId },
      update: { principal: usuarioId === principalId },
    });
  }

  // 3. O atalho, lido de volta da fonte de verdade.
  const gravadoPrincipal = await tx.compromissoResponsavel.findFirst({
    where: { compromissoId, principal: true },
    select: { usuarioId: true },
  });
  await tx.compromisso.update({
    where: { id: compromissoId },
    data: { responsavelId: gravadoPrincipal?.usuarioId ?? principalId },
  });

  return ids;
}

// ---------------------------------------------------------------------------
// Urgência
// ---------------------------------------------------------------------------

/** Quem marcou: uma pessoa na tela, ou um robô do sistema. */
export type OrigemUrgencia = 'PESSOA' | 'AUTOMACAO';

export interface UrgenciaGravavel {
  urgente: boolean;
  urgenteMotivo: string | null;
  urgenteEm: Date | null;
  urgentePor: string | null;
}

/**
 * Traduz "marcar como urgente" nos quatro campos que vão ao banco.
 *
 * O MOTIVO É OBRIGATÓRIO PARA PESSOA, e este é o ponto da mudança inteira.
 * Urgência sem justificativa não se revisa: ninguém sabe por que aquilo é
 * prioritário nem desde quando, então nada nunca é desmarcado e, em poucos
 * meses, metade da fila está urgente — que é o mesmo que nada estar. Com
 * motivo e data, a fila vira uma lista auditável.
 *
 * A AUTOMAÇÃO É DISPENSADA DA OBRIGAÇÃO, mas não do motivo: ela passa o dela
 * ("prazo vence em 3 dias", "audiência sem data confirmada"). Antes, as
 * atividades criadas pelo robô nasciam urgentes sem nenhuma explicação na
 * tela — quem abria não tinha como saber se aquilo era regra ou engano.
 *
 * DESMARCAR LIMPA TUDO: manter o motivo antigo de um item que deixou de ser
 * urgente é guardar uma frase que não vale mais.
 */
export function montarUrgencia(
  urgente: boolean | undefined,
  motivo: string | undefined | null,
  ctx: { userId?: string; origem?: OrigemUrgencia },
  atual?: { urgente: boolean; urgenteMotivo: string | null; urgenteEm: Date | null; urgentePor: string | null },
): Partial<UrgenciaGravavel> {
  // Campo ausente = "não mexa". Diferente de `false`, que é "desmarque".
  if (urgente === undefined) {
    // Sem mudar o estado, um motivo novo ainda pode corrigir o texto.
    if (motivo !== undefined && atual?.urgente) {
      return { urgenteMotivo: (motivo ?? '').trim() || atual.urgenteMotivo };
    }
    return {};
  }

  if (!urgente) {
    return { urgente: false, urgenteMotivo: null, urgenteEm: null, urgentePor: null };
  }

  const texto = (motivo ?? '').trim();
  const origem = ctx.origem ?? 'PESSOA';
  if (!texto && origem === 'PESSOA') {
    // Já estava urgente e continua: não force a redigitar o motivo.
    if (atual?.urgente && atual.urgenteMotivo) return {};
    throw new BadRequestException(
      'Diga por que isto é urgente. Sem motivo, a marca não pode ser revista depois ' +
        'e a fila de urgências perde o sentido.',
    );
  }

  return {
    urgente: true,
    urgenteMotivo: texto || null,
    urgenteEm: new Date(),
    urgentePor: ctx.userId ?? null,
  };
}
