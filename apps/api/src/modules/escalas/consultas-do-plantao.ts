import { Prisma, StatusCompromisso } from '@prisma/client';
import { NAO_E_RESERVA, ORIGEM_RESERVA } from '../agenda/equipe.util';
import { OFFSET_BR_MS } from '../processos/utils/data-br.util';
import { Faixa, pessoaNaFrase } from './escalas.regras';

/**
 * AS CONSULTAS MARCADAS NUM PLANTÃO — uma regra só para a prévia e para a troca.
 *
 * Nasceu em 14/09/2026 (D16 da rodada 3). Trocar o plantonista deixava as
 * consultas com quem saiu: a Dra. Shérad passava o plantão de 15/09 ao Dr.
 * Murilo, a consulta das 9h continuava na agenda dela, o Dr. Murilo não via
 * nada e o filiado chegava esperando a Dra. Shérad.
 *
 * NÃO EXISTE LIGAÇÃO ENTRE A CONSULTA E O PLANTÃO. O chip do plantão, no
 * desfecho do atendimento, só põe a PESSOA na lista; nenhum id de escala
 * viaja. A consulta "do plantão" é inferida por pessoa + dia + janela, e por
 * isso a tela pede a decisão de gente em vez de passar sozinha.
 *
 * A prévia (`GET /escalas/:id/consultas`) e a gravação (`PATCH /escalas/:id`
 * com `passarConsultas`) leem ESTAS funções. Se a gravação tivesse a própria
 * conta, uma consulta mostrada como "passa" poderia ser recusada — e a recusa
 * de `passarConsultaEmTransacao`, lançada dentro da transação, desfaria a troca
 * inteira. Aqui se decide quem é selecionável; lá só se escreve.
 */

/** O instante em que "AAAA-MM-DD HH:MM" acontece em Teresina (o contêiner roda em UTC). */
export function instanteBR(dia: string, hora: string): Date {
  const [ano, mes, d] = dia.split('-').map(Number);
  const [hh, mm] = hora.split(':').map(Number);
  return new Date(Date.UTC(ano, mes - 1, d, hh, mm) + OFFSET_BR_MS);
}

/** [início, fim) do plantão como instantes. */
export function janelaDoPlantao(p: Faixa & { data: string }): { inicio: Date; fim: Date } {
  return { inicio: instanteBR(p.data, p.horaInicio), fim: instanteBR(p.data, p.horaFim) };
}

/**
 * O que conta como consulta do plantão, no banco.
 *
 *  · `CONSULTA_JURIDICA` que não é seguimento (`origemDesfechoId` nulo): o
 *    retorno marcado ao concluir outra atividade é de quem atendeu, não do
 *    plantão. Audiência, reunião, prazo e tarefa do robô NÃO entram: trocar
 *    plantão não é ausência, e mover a audiência de alguém por causa da escala
 *    seria errado;
 *  · aberta (PENDENTE ou EM_ANDAMENTO);
 *  · no dia do plantão em Teresina, o dia inteiro (a fora do horário aparece
 *    recolhida);
 *  · de quem sai, como responsável ou posta por gente na equipe. A reserva do
 *    robô fica de fora (`NAO_E_RESERVA`): não há o que passar.
 */
export function whereDasConsultasDoPlantao(saiId: string, dia: string): Prisma.CompromissoWhereInput {
  const inicio = instanteBR(dia, '00:00');
  return {
    tipo: 'CONSULTA_JURIDICA',
    origemDesfechoId: null,
    status: { in: [StatusCompromisso.PENDENTE, StatusCompromisso.EM_ANDAMENTO] },
    inicio: { gte: inicio, lt: new Date(inicio.getTime() + 24 * 3_600_000) },
    OR: [{ responsavelId: saiId }, { equipe: { some: { usuarioId: saiId, ...NAO_E_RESERVA } } }],
  };
}

const pessoaSel = { select: { id: true, nome: true, nomeExibicao: true } } as const;

export const selectDaConsultaDoPlantao = {
  id: true,
  titulo: true,
  inicio: true,
  fim: true,
  status: true,
  local: true,
  linkReuniao: true,
  responsavelId: true,
  responsavel: pessoaSel,
  equipe: { select: { usuarioId: true, principal: true, origem: true, usuario: pessoaSel } },
  atendimento: { select: { id: true, numero: true } },
  filiado: { select: { id: true, nomeCompleto: true, telefonePrincipal: true, telefoneSecundario: true } },
} satisfies Prisma.CompromissoSelect;

type Pessoa = { id: string; nome: string; nomeExibicao: string | null };

export interface ConsultaLida {
  id: string;
  titulo: string;
  inicio: Date;
  fim: Date;
  status: StatusCompromisso;
  local: string | null;
  linkReuniao: string | null;
  responsavelId: string;
  responsavel: Pessoa | null;
  equipe: { usuarioId: string; principal: boolean; origem: string | null; usuario: Pessoa | null }[];
  atendimento: { id: string; numero: number } | null;
  filiado: {
    id: string;
    nomeCompleto: string;
    telefonePrincipal: string | null;
    telefoneSecundario: string | null;
  } | null;
}

export type PapelNoPlantao = 'RESPONSAVEL' | 'PARTICIPANTE';

export interface ConsultaClassificada {
  consulta: ConsultaLida;
  papel: PapelNoPlantao;
  /** Começa dentro de [início, fim) do plantão, pela faixa ANTES de qualquer alteração. */
  noHorario: boolean;
  selecionavel: boolean;
  /** A linha da prévia quando não dá para marcar. */
  porQueNao: string | null;
  /** A frase curta quando o id foi pedido e não passou ("Já estava em andamento."). */
  motivoSeNaoPassar: string | null;
  /** Quem responde, quando quem sai só atua junto. */
  principal: Pessoa | null;
  /**
   * Quem sai atua junto e quem entra JÁ É o responsável: passar só tira quem sai
   * da equipe. A mesma conta de `PassagemFeita.jaEraResponsavel` (14/09/2026),
   * para a prévia não somar a consulta ao que quem entra "fica com". Sem quem
   * entra (excluir, encurtar), sempre `false`.
   */
  jaEraResponsavel: boolean;
}

/**
 * O papel de quem sai — pela MESMA régua de `passarConsultaEmTransacao`: a
 * linha do principal é a verdade e o atalho só vale quando ela falta. Se esta
 * conta divergisse da de lá, uma consulta "selecionável" seria recusada dentro
 * da transação e derrubaria a troca do plantão junto.
 */
export function papelDeQuemSai(c: ConsultaLida, saiId: string): PapelNoPlantao | null {
  const principalAtual = c.equipe.find((e) => e.principal)?.usuarioId ?? c.responsavelId;
  if (principalAtual === saiId) return 'RESPONSAVEL';
  const linha = c.equipe.find((e) => e.usuarioId === saiId);
  if (linha && linha.origem !== ORIGEM_RESERVA) return 'PARTICIPANTE';
  return null;
}

export const FRASE_PLANTAO_PASSOU = 'Este plantão já passou. As consultas não mudam de dono.';

/**
 * Separa as consultas do dia em "no horário" e "fora do horário" e diz quais
 * podem passar.
 *
 *  · plantão de um dia que já passou: nada é selecionável — trocar quem esteve
 *    de plantão é corrigir o registro, não reescrever quem atendeu;
 *  · EM_ANDAMENTO aparece, sem caixa: a consulta está acontecendo com quem
 *    saiu;
 *  · o resto (PENDENTE) é selecionável, no horário ou fora dele. A escolha
 *    padrão (marcada no horário, desmarcada fora) é da tela.
 */
export function classificarConsultas(
  consultas: ConsultaLida[],
  p: {
    saiId: string;
    sai: { nome: string; nomeExibicao?: string | null };
    plantao: Faixa & { data: string };
    passado: boolean;
    /** Quem assume, quando a prévia já sabe. */
    entraId?: string;
  },
): ConsultaClassificada[] {
  const janela = janelaDoPlantao(p.plantao);
  const resultado: ConsultaClassificada[] = [];
  for (const consulta of [...consultas].sort((a, b) => a.inicio.getTime() - b.inicio.getTime() || a.id.localeCompare(b.id))) {
    const papel = papelDeQuemSai(consulta, p.saiId);
    if (!papel) continue;
    const noHorario = consulta.inicio >= janela.inicio && consulta.inicio < janela.fim;

    let porQueNao: string | null = null;
    let motivoSeNaoPassar: string | null = null;
    if (p.passado) {
      porQueNao = FRASE_PLANTAO_PASSOU;
      motivoSeNaoPassar = 'Este plantão já passou.';
    } else if (consulta.status === StatusCompromisso.EM_ANDAMENTO) {
      porQueNao = `Em consulta agora — continua com ${pessoaNaFrase(p.sai)}.`;
      motivoSeNaoPassar = 'Já estava em andamento.';
    }

    let principal: Pessoa | null = null;
    let jaEraResponsavel = false;
    if (papel === 'PARTICIPANTE') {
      const linha = consulta.equipe.find((e) => e.principal);
      principal = linha?.usuario ?? consulta.responsavel;
      // A régua de `papelDeQuemSai`: a linha do principal, senão o atalho.
      jaEraResponsavel = !!p.entraId && (linha?.usuarioId ?? consulta.responsavelId) === p.entraId;
    }

    resultado.push({
      consulta,
      papel,
      noHorario,
      selecionavel: porQueNao === null,
      porQueNao,
      motivoSeNaoPassar,
      principal,
      jaEraResponsavel,
    });
  }
  return resultado;
}

/**
 * Por que um id pedido não está mais entre as consultas do plantão — entre a
 * prévia e o salvar alguém concluiu, cancelou, remarcou ou já passou a
 * consulta. A frase entra em "1 consulta não mudou: já tinha sido concluída."
 */
export function motivoDaConsultaQueSaiu(
  achada: { status: StatusCompromisso } | undefined,
  sai: { nome: string; nomeExibicao?: string | null },
): string {
  if (!achada) return 'Não existe mais na agenda.';
  if (achada.status === StatusCompromisso.CONCLUIDO) return 'Já tinha sido concluída.';
  if (achada.status === StatusCompromisso.CANCELADO) return 'Já tinha sido cancelada.';
  return `Não estava mais marcada com ${pessoaNaFrase(sai)} neste dia.`;
}
