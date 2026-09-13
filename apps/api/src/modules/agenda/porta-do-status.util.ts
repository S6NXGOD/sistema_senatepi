import { BadRequestException } from '@nestjs/common';
import { StatusCompromisso } from '@prisma/client';

/**
 * A SITUAÇÃO DA ATIVIDADE SÓ MUDA PELAS PORTAS QUE SABEM O QUE FAZER.
 *
 * `CreateCompromissoDto` tem `status` opcional, e o DTO de edição herda o
 * campo. Com isso, `PATCH /compromissos/:id { status: 'CONCLUIDO' }` fechava a
 * atividade sem desfecho, sem autor, sem andamento no processo e sem substituir
 * o seguimento; `{ status: 'CANCELADO' }` cancelava sem categoria e SEM
 * dispensar a movimentação ligada — o limbo que `dispensarMovimentacaoLigada`
 * fechou em 27/08. Nenhuma tela usava esse caminho; qualquer perfil com EDITAR
 * na agenda alcançava.
 *
 * O campo NÃO sai do DTO: cliente antigo que o envie tomaria 400 pelo
 * `forbidNonWhitelisted`. Ele passa a ser conferido aqui.
 */

export const FRASE_CONCLUIR_PELA_ROTA =
  'Para concluir, registre o desfecho da atividade (o que aconteceu com a demanda).';
export const FRASE_CANCELAR_PELA_ROTA = 'Para cancelar, informe o motivo do cancelamento.';
export const FRASE_REABRIR_PELA_ROTA =
  'Para reabrir, use "Reabrir": ele limpa o desfecho anterior antes de a atividade voltar à fila.';

const fechado = (s: StatusCompromisso) =>
  s === StatusCompromisso.CONCLUIDO || s === StatusCompromisso.CANCELADO;

function recusarFechamento(pedido: StatusCompromisso): void {
  if (pedido === StatusCompromisso.CONCLUIDO) throw new BadRequestException(FRASE_CONCLUIR_PELA_ROTA);
  if (pedido === StatusCompromisso.CANCELADO) throw new BadRequestException(FRASE_CANCELAR_PELA_ROTA);
}

export interface StatusGravavel {
  status?: StatusCompromisso;
  iniciadoEm?: Date | null;
}

/** Criar nasce PENDENTE ou EM_ANDAMENTO — e EM_ANDAMENTO já com o cronômetro. */
export function statusDaCriacao(
  pedido: StatusCompromisso | undefined,
  agora: Date = new Date(),
): StatusGravavel {
  if (!pedido || pedido === StatusCompromisso.PENDENTE) return {};
  recusarFechamento(pedido);
  return { status: StatusCompromisso.EM_ANDAMENTO, iniciadoEm: agora };
}

/**
 * Editar: status igual ao atual é ignorado (o formulário pode reenviar o que
 * leu); CONCLUIDO e CANCELADO têm rota própria; reabrir também — ela limpa o
 * desfecho, e esta porta não. Sobra iniciar e voltar a pendente, com o mesmo
 * cronômetro de `mudarStatus`.
 */
export function statusPelaEdicao(
  atual: { status: StatusCompromisso; iniciadoEm: Date | null },
  pedido: StatusCompromisso | undefined,
  agora: Date = new Date(),
): StatusGravavel {
  if (!pedido || pedido === atual.status) return {};
  recusarFechamento(pedido);
  if (fechado(atual.status)) throw new BadRequestException(FRASE_REABRIR_PELA_ROTA);
  if (pedido === StatusCompromisso.EM_ANDAMENTO) {
    return atual.iniciadoEm ? { status: pedido } : { status: pedido, iniciadoEm: agora };
  }
  return { status: StatusCompromisso.PENDENTE, iniciadoEm: null };
}
