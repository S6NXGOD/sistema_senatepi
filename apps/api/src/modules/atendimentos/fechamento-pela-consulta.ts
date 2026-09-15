import { BadRequestException } from '@nestjs/common';
import { AcaoAuditoria, Prisma, StatusAtendimento, StatusCompromisso } from '@prisma/client';
import { ehConsultaDoAtendimento } from './encaminhamento.util';
import { NOTA_MAXIMA } from './fechamento.util';

/**
 * O ATENDIMENTO FECHA SOZINHO QUANDO A CONSULTA NASCIDA DELE É REGISTRADA.
 *
 * POR QUE EXISTE (15/09/2026, E1 da rodada 4). O dono perguntou: "se resolveu
 * na consulta, a triagem não precisa depender do advogado; não são partes
 * independentes?". Medido em 14/09: das 4 consultas que o advogado concluiu, as
 * 4 exigiram que a triagem concluísse o atendimento à mão depois (2 min, 10 min,
 * 16 min e 1 dia), sem registrar nada novo. E o modal da triagem perguntava se
 * a consulta tinha acontecido, fazendo a triagem responder pelo advogado.
 *
 * O CONTRATO, o mesmo de `agenda/cancelamento-em-transacao.ts`: grava DENTRO da
 * transação de quem chama e devolve a auditoria pronta para depois do commit.
 * Um registro de auditoria que falha nunca pode desfazer a conclusão.
 *
 * NUNCA LANÇA por causa do atendimento. A conclusão do advogado é o que
 * importa; se o atendimento não pôde fechar (já fechado, outra consulta aberta,
 * resolvido no ato), a consulta fecha assim mesmo e o motivo vai carimbado no
 * histórico da conclusão. Não há `try/catch` em volta das consultas ao banco de
 * propósito: no Postgres, um erro dentro da transação a deixa abortada, e engolir
 * o erro aqui só empurraria a falha para o commit, com uma mensagem pior.
 *
 * Arquivo simples, fora de módulo Nest, para o agenda.service importar sem
 * ciclo: ele importa só `@prisma/client`, `@nestjs/common` (a exceção da frase
 * de corrida), `encaminhamento.util` e `fechamento.util`, que por sua vez não
 * importam serviço nenhum.
 */

/**
 * De onde veio a conclusão gravada no atendimento. O banco não tem CHECK
 * (a coluna é texto, migração `20260915090000_conclusao_pela_consulta`): só
 * estes dois valores são gravados, e nulo é conclusão anterior a 15/09/2026.
 */
export const ORIGEM_DA_CONCLUSAO = { TRIAGEM: 'TRIAGEM', CONSULTA: 'CONSULTA' } as const;
export type OrigemDaConclusao = (typeof ORIGEM_DA_CONCLUSAO)[keyof typeof ORIGEM_DA_CONCLUSAO];

/** Por que o atendimento não fechou junto com a consulta. */
export type MotivoDeNaoFechar =
  | 'JA_FECHADO'
  | 'OUTRA_CONSULTA_ABERTA'
  | 'SEM_ENCAMINHAMENTO'
  /** A leitura depois da gravação recusada viu tudo em ordem: alguém mudou o atendimento entre as duas. */
  | 'MUDOU_NO_MEIO';

export type AuditoriaDoAtendimento = {
  acao: typeof AcaoAuditoria.UPDATE;
  entidade: 'Atendimento';
  entidadeId: string;
  descricao: string;
  metadata: Prisma.InputJsonObject;
};

export interface AtendimentoMexido {
  atendimentoId: string;
  numero: number;
  /** Pronto para `AuditService.registrar` (some `userId`, `ip` e `userAgent`), depois do commit. */
  auditoria: AuditoriaDoAtendimento;
}

const STATUS_ABERTOS_DA_CONSULTA = [StatusCompromisso.PENDENTE, StatusCompromisso.EM_ANDAMENTO];

/**
 * "Dúvida esclarecida. Orientada a pedir a progressão no RH." — a nota que o
 * atendimento guarda, com o desfecho que o advogado registrou. Cortada no teto
 * da nota do atendimento: a observação da agenda não tem o mesmo limite.
 */
export function conclusaoObsDaConsulta(rotulo: string, obs: string | null | undefined): string {
  const r = (rotulo ?? '').trim().replace(/\.+$/, '');
  const o = (obs ?? '').trim();
  const texto = r ? `${r}.${o ? ` ${o}` : ''}` : o;
  return texto.slice(0, NOTA_MAXIMA);
}

export interface PedidoDeFecharPelaConsulta {
  consulta: { id: string; atendimentoId: string | null; origemDesfechoId: string | null };
  /** O slug do desfecho da agenda, para a auditoria. */
  desfecho: string;
  /** O rótulo do desfecho ("Dúvida esclarecida"), para a nota. */
  rotuloDesfecho: string;
  desfechoObs: string | null;
  /** Quem concluiu a consulta. Em produção até a Coordenação já concluiu (a consulta do #4). */
  autorId: string | null;
  /** O MESMO instante gravado em `concluidoEm` da consulta: é o carimbo que o desfazer confere. */
  agora: Date;
}

/**
 * Fecha o atendimento de origem, se ele estiver esperando só esta consulta.
 *
 * Devolve o atendimento fechado, `{ naoFechou }` com o motivo, ou `null` quando a
 * consulta não é nascida de atendimento (sem `atendimentoId`, ou seguimento com
 * `origemDesfechoId`). O seguimento herda `atendimentoId` na agenda e NUNCA fecha
 * o atendimento: é trabalho do advogado sobre o resultado.
 */
export async function concluirAtendimentoPelaConsulta(
  tx: Prisma.TransactionClient,
  pedido: PedidoDeFecharPelaConsulta,
): Promise<AtendimentoMexido | { naoFechou: MotivoDeNaoFechar } | null> {
  const { consulta, agora } = pedido;
  if (!consulta.atendimentoId || !ehConsultaDoAtendimento(consulta)) return null;
  const atendimentoId = consulta.atendimentoId;

  /*
    OUTRA CONSULTA NASCIDA DE PÉ IMPEDE. É a cópia do laço antigo: o atendimento
    fechado com ela aberta deixaria outro advogado esperando o filiado. A triagem
    resolve concluindo, e o concluir dela cancela as cópias (E4).
    `id: { not }` só porque `id` nunca é nulo (memória "not em coluna nula").
  */
  const outraAberta: Prisma.CompromissoWhereInput = {
    id: { not: consulta.id },
    origemDesfechoId: null,
    status: { in: STATUS_ABERTOS_DA_CONSULTA },
  };

  const conclusaoObs = conclusaoObsDaConsulta(pedido.rotuloDesfecho, pedido.desfechoObs);
  const gravado = await tx.atendimento.updateMany({
    where: {
      id: atendimentoId,
      status: StatusAtendimento.PENDENTE,
      desfecho: 'ENCAMINHADO',
      compromissos: { none: outraAberta },
    },
    data: {
      status: StatusAtendimento.CONCLUIDO,
      concluidoEm: agora,
      concluidoPor: pedido.autorId,
      conclusaoObs,
      conclusaoOrigem: ORIGEM_DA_CONCLUSAO.CONSULTA,
      conclusaoConsultaId: consulta.id,
    },
  });

  if (gravado.count !== 1) {
    const lido = await tx.atendimento.findUnique({
      where: { id: atendimentoId },
      select: {
        status: true,
        desfecho: true,
        compromissos: { where: outraAberta, select: { id: true }, take: 1 },
      },
    });
    if (!lido) return null;
    const motivo: MotivoDeNaoFechar = lido.status !== StatusAtendimento.PENDENTE
      ? 'JA_FECHADO'
      : lido.desfecho !== 'ENCAMINHADO'
        ? 'SEM_ENCAMINHAMENTO'
        : lido.compromissos.length > 0
          ? 'OUTRA_CONSULTA_ABERTA'
          : 'MUDOU_NO_MEIO';
    return { naoFechou: motivo };
  }

  const { numero } = await tx.atendimento.findUniqueOrThrow({
    where: { id: atendimentoId },
    select: { numero: true },
  });

  return {
    atendimentoId,
    numero,
    auditoria: {
      acao: AcaoAuditoria.UPDATE,
      entidade: 'Atendimento',
      entidadeId: atendimentoId,
      descricao: `Atendimento #${numero}: andamento de ${StatusAtendimento.PENDENTE} para ${StatusAtendimento.CONCLUIDO}, pela consulta`,
      metadata: {
        alteracoes: [
          { campo: 'status', label: 'Andamento', de: StatusAtendimento.PENDENTE, para: StatusAtendimento.CONCLUIDO },
        ],
        via: ORIGEM_DA_CONCLUSAO.CONSULTA,
        compromissoId: consulta.id,
        desfecho: pedido.desfecho,
        nota: conclusaoObs,
      },
    },
  };
}

/**
 * A ORDEM DAS TRAVAS: PRIMEIRO O ATENDIMENTO, DEPOIS A CONSULTA (15/09/2026).
 *
 * O caso: a Dra. Shérad toca Concluir na consulta do #13 no mesmo instante em
 * que a triagem toca "Resolvido sem a consulta". A agenda gravava a consulta e
 * depois o atendimento; a triagem grava o atendimento e depois cancela a
 * consulta. Cada transação ficava esperando a linha que a outra já tinha
 * travado, o Postgres abortava uma delas (deadlock) e quem perdia via "Internal
 * server error", sem saber se a consulta tinha ficado registrada.
 *
 * A triagem já trava o atendimento primeiro (o `updateMany` dele é a primeira
 * gravação). A agenda passa a fazer o mesmo: esta leitura com `FOR UPDATE` é a
 * PRIMEIRA instrução da transação de concluir, reabrir e desfazer, antes de
 * tocar a consulta. Com a mesma ordem dos dois lados, quem chega segundo espera
 * e depois ouve a frase de corrida, em vez de derrubar a outra.
 */
export async function travarAtendimentoAntesDaConsulta(
  tx: Prisma.TransactionClient,
  atendimentoId: string | null | undefined,
): Promise<void> {
  if (!atendimentoId) return;
  await tx.$queryRaw`SELECT id FROM "atendimentos" WHERE id = ${atendimentoId} FOR UPDATE`;
}

/**
 * Deadlock ou conflito de escrita que o banco resolveu abortando esta transação.
 * O Prisma devolve P2034 nas gravações; numa consulta crua (a trava acima) o erro
 * chega como P2010 com o código do Postgres (40P01 deadlock, 40001 serialização).
 */
export function ehCorridaNoBanco(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (e.code === 'P2034') return true;
  const codigo = (e.meta as { code?: unknown } | undefined)?.code;
  return e.code === 'P2010' && (codigo === '40P01' || codigo === '40001');
}

/**
 * Roda a transação e troca a corrida perdida no banco pela frase de corrida da
 * tela (15/09/2026). Não há filtro global de exceção na API: sem isto, quem
 * perdia o deadlock recebia 500. Nada fica gravado pela metade, porque o banco
 * desfaz a transação inteira; a pessoa só precisa abrir de novo.
 */
export async function comFraseDeCorrida<T>(frase: string, transacao: () => Promise<T>): Promise<T> {
  try {
    return await transacao();
  } catch (e) {
    if (ehCorridaNoBanco(e)) throw new BadRequestException(frase);
    throw e;
  }
}

export interface PedidoDeReabrirPelaConsulta {
  compromissoId: string;
  atendimentoId: string | null;
  /** O `concluidoEm` da consulta ANTES de desfazer ou reabrir. */
  concluidoEm: Date | null;
}

/**
 * DESFAZER OU REABRIR A CONSULTA DEVOLVE O ATENDIMENTO — só se o carimbo bater.
 *
 * O carimbo é a origem CONSULTA, ESTA consulta e o MESMO instante de conclusão
 * (as duas colunas são TIMESTAMP(3), gravadas com o mesmo Date). Se a triagem
 * já reabriu e fechou o atendimento de novo, o carimbo mudou e o atendimento
 * não é tocado: desfazer o gesto do advogado não desfaz o gesto de outra pessoa.
 *
 * Atendimento concluído antes de 15/09/2026 tem as colunas novas nulas e nunca
 * casa; a condição é por igualdade, sem `not`, que deixaria a linha nula de fora
 * pelo motivo errado.
 */
export async function reabrirAtendimentoFechadoPelaConsulta(
  tx: Prisma.TransactionClient,
  pedido: PedidoDeReabrirPelaConsulta,
): Promise<AtendimentoMexido | null> {
  if (!pedido.atendimentoId || !pedido.concluidoEm) return null;
  const onde: Prisma.AtendimentoWhereInput = {
    id: pedido.atendimentoId,
    status: StatusAtendimento.CONCLUIDO,
    conclusaoOrigem: ORIGEM_DA_CONCLUSAO.CONSULTA,
    conclusaoConsultaId: pedido.compromissoId,
    concluidoEm: pedido.concluidoEm,
  };

  // O fechamento anterior vai para a auditoria, porque a ficha o apaga.
  const antes = await tx.atendimento.findFirst({
    where: onde,
    select: { numero: true, conclusaoObs: true, concluidoPor: true },
  });
  if (!antes) return null;

  const r = await tx.atendimento.updateMany({
    where: onde,
    data: {
      status: StatusAtendimento.PENDENTE,
      concluidoEm: null,
      concluidoPor: null,
      conclusaoObs: null,
      conclusaoOrigem: null,
      conclusaoConsultaId: null,
    },
  });
  if (r.count !== 1) return null;

  return {
    atendimentoId: pedido.atendimentoId,
    numero: antes.numero,
    auditoria: {
      acao: AcaoAuditoria.UPDATE,
      entidade: 'Atendimento',
      entidadeId: pedido.atendimentoId,
      descricao: `Atendimento #${antes.numero}: andamento de ${StatusAtendimento.CONCLUIDO} para ${StatusAtendimento.PENDENTE}, a consulta voltou a ficar aberta`,
      metadata: {
        alteracoes: [
          { campo: 'status', label: 'Andamento', de: StatusAtendimento.CONCLUIDO, para: StatusAtendimento.PENDENTE },
        ],
        via: ORIGEM_DA_CONCLUSAO.CONSULTA,
        compromissoId: pedido.compromissoId,
        fechamentoAnterior: {
          nota: antes.conclusaoObs,
          em: pedido.concluidoEm.toISOString(),
          por: antes.concluidoPor,
          origem: ORIGEM_DA_CONCLUSAO.CONSULTA,
        },
      },
    },
  };
}
