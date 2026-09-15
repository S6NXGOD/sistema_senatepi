import { Prisma } from '@prisma/client';
import { diaBR, inicioDoDiaBR } from '../processos/utils/data-br.util';
import { diasUteisEntre } from '../dashboard/dias-uteis';

/**
 * O ENCAMINHAMENTO VOLTA — derivado da consulta na LEITURA, nunca gravado.
 *
 * Até 13/09/2026 o atendimento guardava o nome do advogado em TEXTO, escrito uma
 * vez no desfecho (`atendimentos.responsavel`). Se a agenda trocava o
 * responsável, o texto mentia; se a consulta era concluída ou cancelada, o
 * atendimento não sabia. A triagem não tinha como responder "o Dr. X já
 * atendeu?", e o cartão de pendentes do painel crescia sem fim.
 *
 * Gravar o estado no atendimento seria a mesma doença de outro jeito: um
 * derivado que alguém precisa lembrar de atualizar em cada caminho da agenda
 * (concluir, cancelar, remarcar, assumir). Por isso a regra é uma função pura,
 * chamada pela listagem, pelo detalhe e pelo painel — a MESMA função, para que
 * as três telas nunca discordem.
 *
 * O texto `responsavel` fica no banco como histórico (migração só aditiva);
 * ninguém mais lê dele para dizer quem cuida.
 */

export type EstadoEncaminhamento =
  | 'AGENDADA'
  | 'HOJE'
  | 'EM_CONSULTA'
  | 'FICOU_PARA_TRAS'
  | 'ATENDIDA'
  | 'CANCELADA';

/** O que a regra precisa de cada consulta — ver `SELECT_CONSULTA_DO_ENCAMINHAMENTO`. */
export interface ConsultaDoEncaminhamento {
  id: string;
  status: string;
  inicio: Date;
  local?: string | null;
  linkReuniao?: string | null;
  /** Preenchido quando a atividade é SEGUIMENTO de outra — ver abaixo. */
  origemDesfechoId?: string | null;
  createdAt?: Date;
  /** Quantas vezes a agenda remarcou a consulta. Ausente em leitura antiga: conta como zero. */
  remarcacoes?: number | null;
  /** A data da primeira marcação, travada na primeira remarcação. */
  dataOriginal?: Date | null;
  responsavel: { id: string; nome: string; nomeExibicao: string | null } | null;
}

export interface SituacaoDoEncaminhamento {
  estado: EstadoEncaminhamento;
  compromissoId: string;
  inicio: Date;
  responsavel: { id: string; nome: string; nomeExibicao: string | null } | null;
  linkReuniao: string | null;
  local: string | null;
  /**
   * CONSULTA REMARCADA (15/09/2026, E6 da rodada 4). A triagem precisa saber
   * que a data mudou para avisar o filiado, e o chip diz "Consulta remarcada"
   * em tom neutro, com o WhatsApp. Nunca âmbar: o sistema não sabe se o
   * filiado já foi avisado, e um aviso que nada apaga vira ruído permanente.
   */
  remarcacoes: number;
  dataOriginal: Date | null;
}

/**
 * O select mínimo que alimenta a regra. Exportado para o painel usar o mesmo
 * recorte de colunas — se cada leitor escolhesse as suas, um deles esqueceria
 * `origemDesfechoId` e passaria a mostrar o seguimento no lugar da consulta.
 */
export const SELECT_CONSULTA_DO_ENCAMINHAMENTO = {
  id: true,
  tipo: true,
  status: true,
  inicio: true,
  local: true,
  linkReuniao: true,
  origemDesfechoId: true,
  createdAt: true,
  remarcacoes: true,
  dataOriginal: true,
  responsavel: { select: { id: true, nome: true, nomeExibicao: true } },
} as const satisfies Prisma.CompromissoSelect;

/**
 * A consulta é a atividade que NASCEU do atendimento — não qualquer uma que
 * carregue o id dele.
 *
 * A agenda copia `atendimentoId` para o seguimento criado na conclusão
 * (agenda.service, "herda os vínculos"). Sem este filtro, a consulta atendida
 * que gera um "Retorno ao filiado" apareceria como AGENDADA de novo, na agenda
 * de quem cuida do retorno — e a triagem nunca veria "atendida".
 */
export function ehConsultaDoAtendimento(c: { origemDesfechoId?: string | null }): boolean {
  return !c.origemDesfechoId;
}

function estadoDe(c: ConsultaDoEncaminhamento, agora: Date): EstadoEncaminhamento {
  switch (c.status) {
    case 'CONCLUIDO':
      return 'ATENDIDA';
    case 'CANCELADO':
      return 'CANCELADA';
    case 'EM_ANDAMENTO':
      return 'EM_CONSULTA';
    default: {
      /*
        "FICOU PARA TRÁS" É O DIA DE TERESINA, não o relógio.

        A consulta das 9h que às 11h ainda está PENDENTE é HOJE: o advogado pode
        só não ter apertado "Iniciar". Ficar para trás é o dia ter acabado sem
        ninguém atender — a mesma régua das atrasadas da agenda. E o sistema
        nunca diz "vencida": a tela pinta de âmbar.
      */
      const inicio = new Date(c.inicio);
      if (inicio < inicioDoDiaBR(agora)) return 'FICOU_PARA_TRAS';
      return diaBR(inicio) === diaBR(agora) ? 'HOJE' : 'AGENDADA';
    }
  }
}

const maisRecentePrimeiro = (a: ConsultaDoEncaminhamento, b: ConsultaDoEncaminhamento) => {
  const porInicio = new Date(b.inicio).getTime() - new Date(a.inicio).getTime();
  if (porInicio !== 0) return porInicio;
  return new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime();
};

/**
 * Em que pé está o encaminhamento, a partir das consultas do atendimento.
 *
 * Entre várias (reencaminhado, remarcado por nova consulta), vale a MAIS
 * RECENTE que não foi cancelada: a cancelada é passado, a nova é o que está de
 * pé. Só quando TODAS foram canceladas o estado é CANCELADA — e aí a triagem
 * precisa saber, porque ninguém vai atender.
 *
 * Sem consulta, não há encaminhamento a mostrar: devolve `null`.
 */
export function situacaoDoEncaminhamento(
  consultas: ConsultaDoEncaminhamento[] | null | undefined,
  agora: Date = new Date(),
): SituacaoDoEncaminhamento | null {
  const proprias = (consultas ?? []).filter(ehConsultaDoAtendimento);
  if (proprias.length === 0) return null;

  const ordenadas = [...proprias].sort(maisRecentePrimeiro);
  const escolhida = ordenadas.find((c) => c.status !== 'CANCELADO') ?? ordenadas[0];

  return {
    estado: estadoDe(escolhida, agora),
    compromissoId: escolhida.id,
    inicio: new Date(escolhida.inicio),
    responsavel: escolhida.responsavel
      ? {
          id: escolhida.responsavel.id,
          nome: escolhida.responsavel.nome,
          nomeExibicao: escolhida.responsavel.nomeExibicao ?? null,
        }
      : null,
    linkReuniao: escolhida.linkReuniao ?? null,
    local: escolhida.local ?? null,
    remarcacoes: escolhida.remarcacoes ?? 0,
    dataOriginal: escolhida.dataOriginal ? new Date(escolhida.dataOriginal) : null,
  };
}

// ---------------------------------------------------------------------------
// De quem é a vez: a triagem ou a consulta
// ---------------------------------------------------------------------------

export type FilaDoAtendimento = 'TRIAGEM' | 'CONSULTA';

export type MotivoDaFila =
  | 'SEM_DESFECHO'
  | 'FALTA_CONCLUIR'
  | 'SEM_CONSULTA'
  | 'CONSULTA_CANCELADA'
  | 'CONSULTA_SEM_REGISTRO'
  | 'AGUARDANDO';

export interface FilaCalculada {
  fila: FilaDoAtendimento;
  motivo: MotivoDaFila;
}

export const FILAS_DO_ATENDIMENTO: FilaDoAtendimento[] = ['TRIAGEM', 'CONSULTA'];

/**
 * QUANTOS DIAS ÚTEIS A CONSULTA PODE FICAR SEM REGISTRO antes de voltar para a
 * triagem.
 *
 * Dois, e não zero (15/09/2026, E3 da rodada 4):
 *  - é o mesmo corte da faixa de avisos;
 *  - nesses dias o atraso já aparece âmbar na agenda de quem vai atender, e
 *    repetir o mesmo atraso na tela da triagem é o erro do "mesmo atraso três
 *    vezes" que o painel já cometeu;
 *  - passado isso, ninguém está cuidando, e aí a triagem precisa ligar.
 * No #13 (consulta de seg 14/09 às 09:00): neutro nos dias 14 e 15, âmbar a
 * partir de qua 16/09. Fim de semana não conta (`diasUteisEntre`).
 */
export const DIAS_UTEIS_ATE_VOLTAR_A_TRIAGEM = 2;

/**
 * DE QUEM É A VEZ — calculado na LEITURA, nunca gravado.
 *
 * POR QUE (15/09/2026, E3 da rodada 4). A lista, a gaveta e o painel pintavam
 * "Pendente" em âmbar em todo atendimento aberto. Medido em 14/09: o #13 (consulta
 * de hoje às 09:00) e o #14 (consulta de 17/09) apareciam iguais ao atendimento
 * que de fato pedia a triagem, e nos dois não havia nada a fazer além de esperar.
 * Desde a mesma data o atendimento fecha sozinho quando a consulta é registrada
 * (`fechamento-pela-consulta.ts`), e a triagem só precisa agir quando a bola
 * volta para ela.
 *
 * A MESMA função serve à lista, à gaveta e ao painel, com o mesmo `agora`: três
 * cópias da regra discordariam no primeiro ajuste.
 *
 * A consulta que decide é a VIGENTE de `situacaoDoEncaminhamento` (a mais recente
 * não cancelada). Se ela já foi registrada, a vez é da triagem mesmo que sobre
 * uma cópia aberta do laço antigo: o fechamento sozinho não acontece com cópia
 * de pé, e concluir pela triagem cancela as cópias (E4).
 */
export function filaDoAtendimento(
  at: { status: string; desfecho: string | null },
  consultas: ConsultaDoEncaminhamento[] | null | undefined,
  agora: Date = new Date(),
): FilaCalculada | null {
  if (at.status !== 'PENDENTE') return null;
  if (!at.desfecho) return { fila: 'TRIAGEM', motivo: 'SEM_DESFECHO' };
  if (at.desfecho !== 'ENCAMINHADO') return { fila: 'TRIAGEM', motivo: 'FALTA_CONCLUIR' };

  const nascidas = (consultas ?? []).filter(ehConsultaDoAtendimento);
  const encaminhamento = situacaoDoEncaminhamento(nascidas, agora);
  if (!encaminhamento) return { fila: 'TRIAGEM', motivo: 'SEM_CONSULTA' };

  switch (encaminhamento.estado) {
    case 'CANCELADA':
      return { fila: 'TRIAGEM', motivo: 'CONSULTA_CANCELADA' };
    case 'ATENDIDA':
      return { fila: 'TRIAGEM', motivo: 'FALTA_CONCLUIR' };
    case 'AGENDADA':
    case 'HOJE':
      return { fila: 'CONSULTA', motivo: 'AGUARDANDO' };
    default: {
      /*
        FICOU_PARA_TRAS ou EM_CONSULTA. A consulta em andamento desde HOJE é o
        advogado atendendo agora; a que foi iniciada num dia anterior e ficou
        aberta é o mesmo esquecimento da pendente que ficou para trás, e conta
        igual a partir do início marcado.
      */
      const inicio = new Date(encaminhamento.inicio);
      if (inicio >= inicioDoDiaBR(agora)) return { fila: 'CONSULTA', motivo: 'AGUARDANDO' };
      return diasUteisEntre(inicio, agora) >= DIAS_UTEIS_ATE_VOLTAR_A_TRIAGEM
        ? { fila: 'TRIAGEM', motivo: 'CONSULTA_SEM_REGISTRO' }
        : { fila: 'CONSULTA', motivo: 'AGUARDANDO' };
    }
  }
}

// ---------------------------------------------------------------------------
// Modalidade da consulta
// ---------------------------------------------------------------------------

export type ModalidadeConsulta = 'SEDE' | 'VIDEO' | 'TELEFONE';
export const MODALIDADES_CONSULTA: ModalidadeConsulta[] = ['SEDE', 'VIDEO', 'TELEFONE'];

/**
 * VÍDEO É A FORMA DA CONSULTA, NÃO UM CANAL DO ATENDIMENTO (decisão D11).
 *
 * A modalidade não vira coluna nem enum: ela mora no `local`, que já aparece no
 * cartão da agenda, no painel e no dossiê. Assim o advogado que abre a
 * atividade lê "Por chamada de vídeo" onde antes leria o endereço, e não fica
 * esperando na sede alguém que vai ligar. Na sede, o `local` fica vazio, como
 * sempre foi.
 */
export const LOCAL_DA_MODALIDADE: Record<ModalidadeConsulta, string | null> = {
  SEDE: null,
  VIDEO: 'Por chamada de vídeo',
  TELEFONE: 'Por telefone',
};

/** Remoto exige dia e hora combinados: "amanhã às 9h" não serve para uma chamada. */
export function modalidadeRemota(m: ModalidadeConsulta | null | undefined): boolean {
  return m === 'VIDEO' || m === 'TELEFONE';
}
