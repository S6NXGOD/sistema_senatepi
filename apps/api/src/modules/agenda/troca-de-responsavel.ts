import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma, StatusCompromisso } from '@prisma/client';
import { ORIGEM_RESERVA, sincronizarEquipe } from './equipe.util';

/**
 * PASSAR UMA CONSULTA DE UMA PESSOA PARA OUTRA, NO MESMO PAPEL.
 *
 * Nasceu em 14/09/2026 (D16 e D20 da rodada 3) para a troca de plantão: a
 * Dra. Shérad passa o plantão de 15/09 ao Dr. Murilo, e as consultas marcadas
 * com ela naquele horário passam junto. Em setembro são 16 plantões e a
 * maioria das consultas é com o plantonista do dia.
 *
 * POR QUE A LISTA INTEIRA É LIDA AQUI DENTRO. `sincronizarEquipe` é a única
 * escritora do atalho `responsavelId`, e ela APAGA quem não estiver na lista
 * que recebe (equipe.util.ts, passo 1). Quem montasse a lista só com "quem
 * entra" derrubaria junto o colega que alguém pôs para atuar na consulta — e
 * a reserva que o robô anotou. A lista sai da tabela, dentro da mesma
 * transação, menos quem sai, mais quem entra.
 *
 * O PAPEL NÃO MUDA:
 *  · quem sai respondia → quem entra passa a responder;
 *  · quem sai atuava junto → quem entra passa a atuar junto, e o responsável
 *    continua o mesmo.
 * Quem entra por esta porta foi escolhido por GENTE: se já estava na equipe
 * como reserva do robô, a marca sai (o mesmo cuidado do passo 2.1 de
 * `sincronizarEquipe`, estendido ao participante).
 *
 * Histórico e auditoria ficam para depois do commit, com quem chamou
 * (`AgendaService.registrarNoHistorico`): aqui só a escrita da equipe.
 */

export type PapelNaConsulta = 'RESPONSAVEL' | 'PARTICIPANTE';

export interface PedidoDePassagem {
  compromissoId: string;
  /** Quem sai. */
  deId: string;
  /** Quem entra. */
  paraId: string;
}

export interface PassagemFeita {
  papel: PapelNaConsulta;
  /**
   * Quem sai atuava junto e quem entra JÁ ERA o responsável (14/09/2026, revisão
   * da rodada 3). A equipe gravada fica certa sozinha — `normalizarEquipe` ignora
   * o principal repetido na lista de participantes, e sobra só ele —, mas quem
   * escrevesse "quem atua junto passou para o Dr. Murilo" descreveria uma equipe
   * que não existe. Quem chama escolhe a frase por aqui. Sempre `false` no papel
   * RESPONSAVEL.
   */
  jaEraResponsavel: boolean;
  deNome: string;
  paraNome: string;
}

const nomeDe = (u?: { nome: string; nomeExibicao: string | null } | null) =>
  u?.nomeExibicao?.trim() || u?.nome || null;

/**
 * Troca `deId` por `paraId` na equipe da atividade, dentro de `tx`. Toda recusa
 * é lançada antes da primeira escrita — e, lançada dentro da transação, desfaz
 * também o que quem chamou já tinha gravado. Quem passa várias consultas deve
 * filtrar antes as que não podem passar (fechadas, ou em que a pessoa é só
 * reserva) e não contar com a recusa como filtro.
 */
export async function passarConsultaEmTransacao(
  tx: Prisma.TransactionClient,
  { compromissoId, deId, paraId }: PedidoDePassagem,
): Promise<PassagemFeita> {
  if (!deId?.trim() || !paraId?.trim()) {
    throw new BadRequestException('Diga quem sai e quem entra na consulta.');
  }
  if (deId === paraId) {
    throw new BadRequestException('Quem sai e quem entra são a mesma pessoa.');
  }

  const atividade = await tx.compromisso.findUnique({
    where: { id: compromissoId },
    select: { id: true, status: true, responsavelId: true },
  });
  if (!atividade) throw new NotFoundException('Compromisso não encontrado.');
  // Fechada é história: mudar o dono de uma consulta concluída reescreveria
  // quem atendeu.
  if (atividade.status === StatusCompromisso.CONCLUIDO || atividade.status === StatusCompromisso.CANCELADO) {
    throw new BadRequestException(
      'Atividade concluída ou cancelada não muda de dono: o histórico diz quem cuidou dela.',
    );
  }

  const pessoas = await tx.user.findMany({
    where: { id: { in: [deId, paraId] } },
    select: { id: true, nome: true, nomeExibicao: true, ativo: true },
  });
  const quemSai = pessoas.find((p) => p.id === deId);
  const quemEntra = pessoas.find((p) => p.id === paraId);
  const deNome = nomeDe(quemSai) ?? 'Quem sai';
  if (!quemEntra || !quemEntra.ativo) {
    throw new BadRequestException(
      `${nomeDe(quemEntra) ?? 'Quem entra'} não está ativo no sistema e não pode assumir a consulta.`,
    );
  }
  const paraNome = nomeDe(quemEntra)!;

  const equipe = await tx.compromissoResponsavel.findMany({
    where: { compromissoId },
    select: { usuarioId: true, principal: true, origem: true },
  });
  // A lista é a verdade; o atalho só vale quando a linha do principal falta
  // (correção manual ou carga antiga).
  const principalAtual = equipe.find((e) => e.principal)?.usuarioId ?? atividade.responsavelId;
  const linhaDeQuemSai = equipe.find((e) => e.usuarioId === deId);

  let papel: PapelNaConsulta;
  if (principalAtual === deId) {
    papel = 'RESPONSAVEL';
  } else if (linhaDeQuemSai && linhaDeQuemSai.origem !== ORIGEM_RESERVA) {
    papel = 'PARTICIPANTE';
  } else if (linhaDeQuemSai) {
    throw new BadRequestException(
      `${deNome} está nesta atividade só como reserva posta pelo sistema. Não há o que passar.`,
    );
  } else {
    throw new BadRequestException(`${deNome} não está nesta atividade.`);
  }

  const semQuemSai = equipe.map((e) => e.usuarioId).filter((id) => id !== deId);
  await sincronizarEquipe(
    tx,
    compromissoId,
    papel === 'RESPONSAVEL'
      ? { principalId: paraId, participantesIds: semQuemSai }
      : { principalId: principalAtual, participantesIds: [...semQuemSai, paraId] },
  );
  await tx.compromissoResponsavel.updateMany({
    where: { compromissoId, usuarioId: paraId, origem: ORIGEM_RESERVA },
    data: { origem: null },
  });

  return { papel, jaEraResponsavel: papel === 'PARTICIPANTE' && principalAtual === paraId, deNome, paraNome };
}
