import { BadRequestException } from '@nestjs/common';
import { StatusCompromisso } from '@prisma/client';
import { formatarDataHoraBR, inicioDoDiaBR } from '../processos/utils/data-br.util';

/**
 * REMARCAR NUM CAMINHO SÓ.
 *
 * Havia dois, e gravavam coisas diferentes. Medido na produção em 12/09/2026:
 * 7 atividades remarcadas pelo botão e 8 só pela edição do formulário.
 *
 *  · o BOTÃO somava o contador, guardava o motivo, voltava a PENDENTE e zerava
 *    o cronômetro — mas não escrevia no histórico da atividade;
 *  · a EDIÇÃO escrevia no histórico e travava a data original — mas não
 *    somava, não guardava motivo e deixava "em andamento" uma atividade que
 *    mudou de dia.
 *
 * O cartão omitia o "2×" e o modal escondia "Já remarcada" porque o contador
 * ficou em 0 em metade dos casos. Agora os dois caminhos chamam esta função e
 * gravam a mesma coisa.
 *
 * AO MINUTO: o formulário junta data e hora sem os segundos e sempre envia o
 * início. A tarefa do robô nasce com segundos ("Avisar filiado", criada com
 * `new Date()`), e editar só o título dela virava uma remarcação falsa.
 */

const MINUTO_MS = 60_000;

export const mesmoMinuto = (a: Date, b: Date): boolean =>
  Math.floor(a.getTime() / MINUTO_MS) === Math.floor(b.getTime() / MINUTO_MS);

export type ViaDaRemarcacao = 'remarcar' | 'edicao';

export interface AtividadeParaRemarcar {
  status: StatusCompromisso;
  inicio: Date;
  fim: Date;
  dataOriginal: Date | null;
  remarcacoes: number;
}

export interface PedidoDeRemarcacao {
  inicio: Date;
  /** Omitido: preserva a duração — remarcar uma audiência de 1h não a torna instantânea. */
  fim?: Date | null;
  motivo?: string | null;
  via: ViaDaRemarcacao;
}

export interface Remarcacao {
  data: {
    inicio: Date;
    fim: Date;
    dataOriginal?: Date;
    remarcacoes: number;
    remarcadoMotivo: string | null;
    status: StatusCompromisso;
    iniciadoEm: null;
  };
  historico: {
    descricao: string;
    metadata: {
      de: string;
      para: string;
      via: ViaDaRemarcacao;
      remarcacoes: number;
      dataOriginal: string;
      motivo: string | null;
    };
  };
  auditoria: { descricao: string };
}

/**
 * O que a remarcação grava — ou `null` quando o início não mudou (ao minuto).
 * Recusa atividade fechada e fim antes do início, com a frase da tela.
 */
export function dadosDaRemarcacao(
  atual: AtividadeParaRemarcar,
  pedido: PedidoDeRemarcacao,
): Remarcacao | null {
  if (Number.isNaN(pedido.inicio.getTime())) throw new BadRequestException('Data inválida.');
  if (atual.status === StatusCompromisso.CANCELADO) {
    throw new BadRequestException('Atividade cancelada — reabra antes de remarcar.');
  }
  if (atual.status === StatusCompromisso.CONCLUIDO) {
    throw new BadRequestException('Atividade concluída — reabra antes de remarcar.');
  }
  if (mesmoMinuto(pedido.inicio, atual.inicio)) return null;

  const duracao = atual.fim.getTime() - atual.inicio.getTime();
  const fim = pedido.fim ?? new Date(pedido.inicio.getTime() + duracao);
  if (Number.isNaN(fim.getTime())) throw new BadRequestException('Data inválida.');
  if (fim < pedido.inicio) throw new BadRequestException('O fim não pode ser antes do início.');

  const motivo = pedido.motivo?.trim() || null;
  const remarcacoes = atual.remarcacoes + 1;
  const original = atual.dataOriginal ?? atual.inicio;

  return {
    data: {
      inicio: pedido.inicio,
      fim,
      // A 1ª data agendada é gravada uma única vez e nunca mais muda.
      ...(atual.dataOriginal ? {} : { dataOriginal: atual.inicio }),
      remarcacoes,
      remarcadoMotivo: motivo,
      // Uma atividade que mudou de data não continua "em andamento".
      status: StatusCompromisso.PENDENTE,
      iniciadoEm: null,
    },
    historico: {
      descricao:
        `Remarcada de ${formatarDataHoraBR(atual.inicio)} para ${formatarDataHoraBR(pedido.inicio)}` +
        (motivo ? ` — ${motivo}.` : '.'),
      metadata: {
        de: atual.inicio.toISOString(),
        para: pedido.inicio.toISOString(),
        via: pedido.via,
        remarcacoes,
        dataOriginal: original.toISOString(),
        motivo,
      },
    },
    auditoria: {
      descricao:
        `Compromisso REMARCADO (${remarcacoes}ª vez): ${atual.inicio.toISOString()} → ` +
        `${pedido.inicio.toISOString()}${motivo ? ` — ${motivo}` : ''}`,
    },
  };
}

/**
 * O BOTÃO REMARCAR NÃO ACEITA DATA QUE JÁ PASSOU.
 *
 * O atalho "Amanhã" somava um dia à data ANTIGA: a tarefa de 02/09 remarcada
 * em 12/09 ia para 03/09 — continuava atrasada, ganhava +1 no contador, e a
 * pessoa achava que tinha resolvido. Hora já passada de HOJE continua valendo
 * (remarcar para agora é legítimo); dia anterior, não. Corrigir uma data que
 * de fato foi no passado continua possível pela edição.
 */
export function recusarRemarcacaoParaOPassado(inicio: Date, agora: Date = new Date()): void {
  if (inicio < inicioDoDiaBR(agora)) {
    throw new BadRequestException(
      'Essa data já passou. Remarque para hoje ou um dia à frente — para corrigir uma data antiga, use Editar.',
    );
  }
}
