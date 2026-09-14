import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AcaoAuditoria, Prisma, StatusCompromisso } from '@prisma/client';
import { CATEGORIA_CANCELAMENTO_LABEL, categoriaCancelamentoValida } from './desfechos.catalogo';
import { STATUS_ABERTOS } from './recortes.util';

/**
 * CANCELAR UMA ATIVIDADE, POR UMA REGRA SÓ — dentro da transação de quem pede.
 *
 * POR QUE SAIU DO SERVIÇO (14/09/2026, D20 da rodada 3). O fechamento do
 * atendimento passa a cancelar a consulta que nasceu dele ("cancelar a
 * consulta também"), e isso tem de acontecer NA MESMA transação que fecha o
 * atendimento: atendimento cancelado com consulta viva deixa o advogado
 * esperando alguém que não vem; consulta cancelada com atendimento aberto
 * deixa a triagem sem saída. A escrita da agenda morava em
 * `AgendaService.cancelar`, presa ao `$transaction` dele. Copiar os seis campos
 * no módulo de atendimentos seria a segunda implementação que diverge no
 * primeiro ajuste — foi assim que o cancelamento pela edição esqueceu a
 * dispensa da movimentação (fechado em 27/08).
 *
 * O CONTRATO: esta função GRAVA (a atividade e a dispensa da movimentação) e
 * DEVOLVE as frases. Histórico e auditoria ficam para DEPOIS do commit, com
 * quem chamou — `AgendaService.registrarNoHistorico` e `AuditService.registrar`
 * —, porque um histórico que falha nunca pode desfazer o cancelamento.
 */

export const FRASE_CATEGORIA_OBRIGATORIA = 'Informe por que a atividade não aconteceu.';
export const FRASE_JA_CANCELADA = 'Esta atividade já está cancelada.';
export const FRASE_CONCLUIDA_REABRA = 'Atividade concluída — reabra antes de cancelar.';
export const FRASE_EM_ANDAMENTO_NAO_CANCELA =
  'Esta atividade está em andamento: quem encerra é quem está cuidando dela.';
export const FRASE_MUDOU_NO_MEIO =
  'Esta atividade acabou de ser mudada por outra pessoa. Abra de novo para ver como ficou.';

/**
 * CANCELAR UMA TAREFA DO ROBÔ NÃO PODE DEIXAR A MOVIMENTAÇÃO EM LIMBO.
 *
 * O robô carimba `movimentacao.compromissoId` ao criar a tarefa — é a trava
 * de idempotência dele e, ao mesmo tempo, o que faz o selo "Prazo sem tarefa"
 * sair da lista e o radar de audiências parar de cobrar. Excluir a tarefa
 * limpa o carimbo sozinho (a FK é `SetNull`); CANCELAR não limpava nada.
 *
 * O resultado era um limbo silencioso: a movimentação ficava presa a uma
 * tarefa cancelada, sem tarefa viva, sem selo na lista e sem voltar ao radar.
 * O ato desaparecia — e o pior tipo de desaparecimento, o que não deixa
 * sintoma. (Medido em 27/08/2026: nenhum caso ainda. É buraco novo em folha,
 * fechado antes de morder.)
 *
 * POR QUE DISPENSAR, E NÃO SÓ LIMPAR O CARIMBO. Limpar faria o selo voltar
 * amanhã e o robô recriar a tarefa na varredura seguinte — um laço em que
 * cancelar não cancela nada. Dispensar registra o que de fato aconteceu:
 * uma PESSOA decidiu que aquilo não precisa de providência. É auditável
 * (guarda quem e por quê), aparece no radar como dispensado e é REVERSÍVEL
 * (`AudienciasService.restaurar`) — nada fica sem saída.
 *
 * Só vale para tarefa do ROBÔ: uma atividade criada à mão e depois cancelada
 * não tem movimentação para dispensar, e não deve inventar uma. E não
 * redispensa o que já estava dispensado: sobrescrever apagaria quem decidiu
 * primeiro, no radar.
 *
 * Mora aqui desde 14/09/2026 junto com o cancelamento; `cancelarPorSistema`
 * (o tribunal derrubou a pauta) usa a mesma, sem autor.
 */
export async function dispensarMovimentacaoLigada(
  tx: Prisma.TransactionClient,
  compromissoId: string,
  motivo: string,
  userId?: string | null,
  agora: Date = new Date(),
): Promise<number> {
  const r = await tx.movimentacaoProcessual.updateMany({
    where: { compromissoId, dispensadoEm: null },
    data: {
      dispensadoEm: agora,
      dispensadoPor: userId ?? null,
      dispensadoMotivo: motivo,
    },
  });
  return r.count;
}

export type StatusQueCancela = typeof StatusCompromisso.PENDENTE | typeof StatusCompromisso.EM_ANDAMENTO;

export interface PedidoDeCancelamento {
  /** Id da atividade (compromisso). */
  id: string;
  /** Slug do catálogo (`CATEGORIAS_CANCELAMENTO`). Obrigatório: é a explicação padronizada. */
  categoria: string;
  /** Detalhe livre. Vazio ou só espaços vira nulo. */
  motivo?: string | null;
  /** Quem cancelou. Nulo quando não houve pessoa. */
  autorId?: string | null;
  /**
   * Em que situações aceita cancelar. Padrão: PENDENTE e EM_ANDAMENTO, a regra
   * da agenda. O fechamento do atendimento passa só PENDENTE: a consulta que
   * já começou é de quem está atendendo.
   */
  aceitarStatus?: StatusQueCancela[];
  /** O instante gravado em `canceladoEm` e `dispensadoEm`. Padrão: agora. */
  agora?: Date;
}

export type HistoricoDoCancelamento = {
  acao: 'CANCELADO';
  descricao: string;
  metadata: { de: StatusCompromisso; categoria: string; motivo: string | null };
};

export type AuditoriaDoCancelamento = {
  acao: typeof AcaoAuditoria.UPDATE;
  entidade: 'Compromisso';
  entidadeId: string;
  descricao: string;
  metadata: { de: StatusCompromisso; motivo: string | null; categoria: string };
};

export interface CancelamentoFeito {
  id: string;
  titulo: string;
  /** A situação lida antes de cancelar. */
  de: StatusCompromisso;
  categoria: string;
  rotuloCategoria: string;
  motivo: string | null;
  canceladoEm: Date;
  /** Quantas movimentações do robô foram dispensadas junto (0 para atividade feita à mão). */
  movimentacoesDispensadas: number;
  /** Pronto para `AgendaService.registrarNoHistorico`, depois do commit. */
  historico: HistoricoDoCancelamento;
  /** Pronto para `AuditService.registrar` (some `userId`, `ip` e `userAgent`), depois do commit. */
  auditoria: AuditoriaDoCancelamento;
}

/**
 * Cancela a atividade dentro de `tx`: confere, grava e dispensa a movimentação
 * ligada. Qualquer recusa é lançada ANTES de escrever.
 *
 * A gravação é condicional à situação (`updateMany` com `status in`): se outra
 * pessoa concluiu ou iniciou a consulta entre a leitura e a escrita, nada é
 * gravado e a recusa derruba a transação inteira de quem chamou — melhor um
 * "abra de novo" do que cancelar a consulta que o advogado acabou de concluir.
 */
export async function cancelarCompromissoEmTransacao(
  tx: Prisma.TransactionClient,
  pedido: PedidoDeCancelamento,
): Promise<CancelamentoFeito> {
  const { id, categoria } = pedido;
  const aceitos: StatusCompromisso[] = pedido.aceitarStatus?.length
    ? [...pedido.aceitarStatus]
    : [...STATUS_ABERTOS];

  // A ORDEM DAS RECUSAS é a que `AgendaService.cancelar` sempre teve: primeiro
  // se a atividade existe e em que situação está, depois a categoria.
  const atual = await tx.compromisso.findUnique({
    where: { id },
    select: { id: true, status: true, titulo: true },
  });
  if (!atual) throw new NotFoundException('Compromisso não encontrado.');
  if (atual.status === StatusCompromisso.CANCELADO) throw new BadRequestException(FRASE_JA_CANCELADA);
  if (atual.status === StatusCompromisso.CONCLUIDO) throw new BadRequestException(FRASE_CONCLUIDA_REABRA);
  // A categoria é o que torna o cancelamento mensurável ("quantas faltas de
  // filiado tivemos no mês?") — e é ela que carrega a explicação.
  if (!categoriaCancelamentoValida(categoria)) {
    throw new BadRequestException(FRASE_CATEGORIA_OBRIGATORIA);
  }
  if (!aceitos.includes(atual.status)) {
    throw new BadRequestException(
      atual.status === StatusCompromisso.EM_ANDAMENTO ? FRASE_EM_ANDAMENTO_NAO_CANCELA : FRASE_MUDOU_NO_MEIO,
    );
  }

  const rotuloCategoria = CATEGORIA_CANCELAMENTO_LABEL[categoria];
  const motivo = pedido.motivo?.trim() || null;
  const agora = pedido.agora ?? new Date();
  const autorId = pedido.autorId ?? null;

  const gravado = await tx.compromisso.updateMany({
    where: { id, status: { in: aceitos } },
    data: {
      status: StatusCompromisso.CANCELADO,
      canceladoCategoria: categoria,
      canceladoMotivo: motivo,
      canceladoEm: agora,
      canceladoPor: autorId,
      // Cancelar interrompe o cronômetro: o tempo "em andamento" pararia de
      // fazer sentido num evento que não vai acontecer.
      iniciadoEm: null,
    },
  });
  if (gravado.count !== 1) throw new BadRequestException(FRASE_MUDOU_NO_MEIO);

  const explicacao = `${rotuloCategoria}${motivo ? `: ${motivo}` : ''}`;
  // Na mesma transação: cancelar sem dispensar deixaria o ato invisível, e
  // dispensar sem cancelar tiraria o alerta de algo que ainda tem tarefa viva.
  const movimentacoesDispensadas = await dispensarMovimentacaoLigada(
    tx,
    id,
    `Atividade cancelada — ${explicacao}`,
    autorId,
    agora,
  );

  return {
    id,
    titulo: atual.titulo,
    de: atual.status,
    categoria,
    rotuloCategoria,
    motivo,
    canceladoEm: agora,
    movimentacoesDispensadas,
    historico: {
      acao: 'CANCELADO',
      descricao: `Cancelada — ${rotuloCategoria}.${motivo ? ` ${motivo}` : ''}`,
      metadata: { de: atual.status, categoria, motivo },
    },
    auditoria: {
      acao: AcaoAuditoria.UPDATE,
      entidade: 'Compromisso',
      entidadeId: id,
      descricao: `Compromisso CANCELADO: ${atual.titulo} — ${explicacao}`,
      metadata: { de: atual.status, motivo, categoria },
    },
  };
}
