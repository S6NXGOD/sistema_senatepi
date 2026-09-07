import type { PrismaClient } from '@prisma/client';

/**
 * FECHAR A TAREFA "CADASTRE ESTA AÇÃO" QUANDO A AÇÃO SAI DA FILA.
 *
 * A tarefa nasce apontando para um processo que não existe. No dia em que ele
 * passa a existir — ou em que alguém decide que não vai existir — ela vira uma
 * cobrança sobre trabalho já feito. Esse é o jeito mais rápido de a equipe parar
 * de confiar na agenda, e o módulo inteiro já foi desenhado em torno disso.
 *
 * POR QUE UMA FUNÇÃO, E NÃO QUATRO TRECHOS IGUAIS
 * A sugestão sai de PENDENTE em QUATRO caminhos: a reconciliação na leitura, a
 * importação em lote, o "ignorar" manual e a conferência no CNJ que descobre o
 * processo já baixado. Escrever o fechamento em cada um é garantir que o quinto
 * caminho — o que alguém escrever daqui a três meses — vai esquecer. Aqui há uma
 * definição só, e um teste que confere se os quatro chamam.
 *
 * IDEMPOTENTE E SILENCIOSA. Sem tarefa, sem tarefa já fechada, ou sugestão sem
 * vínculo: não faz nada e não reclama. Fechar tarefa é efeito colateral de uma
 * operação que já deu certo; deixá-la derrubar o cadastro do processo seria
 * inverter a importância das duas coisas.
 */
export type DesfechoDaFila = 'CADASTRADO' | 'DESCARTADO';

const MOTIVO: Record<DesfechoDaFila, string> = {
  // CONCLUÍDO não leva motivo; este texto vai para a descrição do que houve.
  CADASTRADO: 'O processo foi cadastrado no acervo.',
  // CANCELADO exige motivo — é regra de negócio da agenda, não enfeite.
  DESCARTADO: 'A ação saiu da fila do Diário sem virar processo.',
};

export async function fecharTarefaDeCadastro(
  prisma: Pick<PrismaClient, 'sugestaoProcesso' | 'compromisso'>,
  sugestaoId: string,
  desfecho: DesfechoDaFila,
): Promise<void> {
  const s = await prisma.sugestaoProcesso.findUnique({
    where: { id: sugestaoId },
    select: { compromissoId: true, processoId: true },
  });
  if (!s?.compromissoId) return;

  await prisma.compromisso.updateMany({
    // `updateMany` com o status no filtro: se alguém já concluiu a tarefa na
    // mão, não reescrevemos o desfecho dessa pessoa por cima.
    where: { id: s.compromissoId, status: { in: ['PENDENTE', 'EM_ANDAMENTO'] } },
    data:
      desfecho === 'CADASTRADO'
        ? {
            status: 'CONCLUIDO',
            concluidoEm: new Date(),
            // O robô concluiu; não há autor humano a quem creditar.
            concluidoPor: null,
            // O processo agora existe — a tarefa passa a apontar para ele, e
            // deixa de ser a única do sistema órfã de processo.
            ...(s.processoId ? { processoId: s.processoId } : {}),
          }
        : {
            status: 'CANCELADO',
            canceladoEm: new Date(),
            canceladoMotivo: MOTIVO.DESCARTADO,
          },
  });
}
