import { Prisma } from '@prisma/client';
import { diaBR, inicioDoDiaBR } from '../processos/utils/data-br.util';

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
  responsavel: { id: string; nome: string; nomeExibicao: string | null } | null;
}

export interface SituacaoDoEncaminhamento {
  estado: EstadoEncaminhamento;
  compromissoId: string;
  inicio: Date;
  responsavel: { id: string; nome: string; nomeExibicao: string | null } | null;
  linkReuniao: string | null;
  local: string | null;
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
  };
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
