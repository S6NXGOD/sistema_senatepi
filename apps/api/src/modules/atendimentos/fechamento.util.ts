import { OFFSET_BR_MS } from '../processos/utils/data-br.util';
import {
  ConsultaDoEncaminhamento, ehConsultaDoAtendimento, situacaoDoEncaminhamento,
} from './encaminhamento.util';

/**
 * O QUE FECHAR O ATENDIMENTO VAI CAUSAR — uma regra só, calculada no servidor.
 *
 * POR QUE EXISTE (14/09/2026, D8 da rodada 3). Concluir e cancelar eram um
 * PATCH de status que trocava uma coluna e mais nada. A consulta marcada na
 * agenda do advogado continuava viva depois que o atendimento morria, e a
 * Triagem (Agenda VISUALIZAR) não tinha como limpá-la. Medido na produção em
 * 13/09: o #9 alternou CANCELADO↔CONCLUIDO seis vezes em quatro minutos, o #4
 * foi cancelado duas vezes antes de concluir, e o #7 foi concluído antes da
 * consulta (era duplicidade). O toque único confundia, e nada dizia o que
 * acontecia com a consulta.
 *
 * A MESMA FUNÇÃO serve a leitura (`atendimento.fechamento` no detalhe, que o
 * modal mostra) e a gravação (`concluir` e `cancelar` validam com ela). Uma
 * prévia que recalculasse a regra na tela seria a segunda implementação, e
 * as duas discordariam no primeiro ajuste.
 *
 * A consulta "afetada" é a VIGENTE pela escolha de `situacaoDoEncaminhamento`
 * (a mais recente não cancelada), lida por ela mesma. As demais consultas
 * abertas nascidas do atendimento seguem o mesmo destino: é o resíduo do laço
 * antigo que criava uma cópia por advogado. Seguimento (`origemDesfechoId`
 * preenchido) nunca é tocado: é trabalho do advogado sobre o resultado.
 */

// ---------------------------------------------------------------------------
// Vocabulário
// ---------------------------------------------------------------------------

/** Em que pé está a consulta vigente. NENHUMA sai no detalhe como `consulta: null`. */
export type SituacaoNoFechamento = 'NENHUMA' | 'ATENDIDA' | 'FUTURA' | 'COMECOU' | 'EM_ANDAMENTO';

export type EscolhaDaConsulta = 'MANTER' | 'CANCELAR';
export const ESCOLHAS_DA_CONSULTA: EscolhaDaConsulta[] = ['MANTER', 'CANCELAR'];

/**
 * AS QUATRO CATEGORIAS DO CANCELAMENTO DO ATENDIMENTO.
 *
 * São slugs do catálogo da agenda (`CATEGORIAS_CANCELAMENTO`), e não um enum
 * novo: a consulta cancelada junto recebe a MESMA categoria, sem tradução, e
 * a estatística "por que caem" conta as duas pelo mesmo nome. Sem "Outro",
 * como no catálogo: o detalhe livre já existe para o que não couber.
 */
export const CATEGORIAS_CANCELAMENTO_ATENDIMENTO = [
  'DESISTENCIA', 'NAO_COMPARECEU', 'PERDEU_OBJETO', 'DUPLICIDADE',
] as const;
export type CategoriaCancelamentoAtendimento = (typeof CATEGORIAS_CANCELAMENTO_ATENDIMENTO)[number];

/**
 * A categoria da consulta cancelada ao CONCLUIR. Se a demanda acabou antes da
 * consulta, a consulta perdeu o objeto — "A demanda deixou de existir antes
 * da data", no catálogo.
 */
export const CATEGORIA_DA_CONSULTA_AO_CONCLUIR: CategoriaCancelamentoAtendimento = 'PERDEU_OBJETO';

/**
 * A CATEGORIA DA CÓPIA QUE SOBROU (15/09/2026, E4 da rodada 4). Com a consulta
 * vigente já registrada pelo advogado, a outra consulta aberta nascida do mesmo
 * atendimento é resíduo do laço antigo que criava uma por advogado: ninguém vai
 * atendê-la, e ela ficaria atrasada para sempre na agenda de alguém. Não perdeu
 * o objeto (o objeto foi atendido): é duplicidade.
 */
export const CATEGORIA_DA_COPIA_QUE_SOBROU: CategoriaCancelamentoAtendimento = 'DUPLICIDADE';

export const NOTA_MINIMA = 10;
export const NOTA_MAXIMA = 2000;
export const MOTIVO_MAXIMO = 1000;

export const FRASE_JA_CONCLUIDO = 'Este atendimento já está concluído.';
export const FRASE_CANCELADO_REABRA = 'Atendimento cancelado: reabra antes de concluir.';
export const FRASE_SEM_DESFECHO = 'Registre o desfecho antes de concluir o atendimento.';
export const FRASE_JA_CANCELADO = 'Este atendimento já está cancelado.';
export const FRASE_CONCLUIDO_REABRA = 'Atendimento concluído: reabra antes de cancelar.';
/*
  "Diga se a consulta aconteceu" saiu em 15/09/2026 (E2 da rodada 4): a triagem
  não responde mais pelo advogado. Quem diz que a consulta aconteceu é quem a
  registra na agenda, e o atendimento fecha junto.
*/
export const FRASE_DIGA_O_QUE_FAZER = 'Diga o que fazer com a consulta marcada.';
export const FRASE_EM_ANDAMENTO = 'A consulta está em andamento: quem encerra é quem está atendendo.';
export const FRASE_NOTA_CURTA =
  `Conte em poucas palavras como a demanda terminou (pelo menos ${NOTA_MINIMA} caracteres).`;
export const FRASE_CATEGORIA = 'Diga por que o atendimento vai ser cancelado.';
export const FRASE_ATENDIMENTO_MUDOU =
  'Este atendimento acabou de ser mudado por outra pessoa. Abra de novo para ver como ficou.';
export const FRASE_CONSULTA_MUDOU =
  'A consulta acabou de ser mudada na agenda. Abra o atendimento de novo para ver como ficou.';
export const FRASE_TELA_PROPRIA =
  'Concluir e cancelar agora têm tela própria. Atualize a página e tente de novo.';

// ---------------------------------------------------------------------------
// Datas e nomes nas frases
// ---------------------------------------------------------------------------

const DIAS_DA_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const doisDigitos = (n: number) => String(n).padStart(2, '0');

/**
 * "qui, 17/09 às 09:00" no relógio de Teresina — a mesma grafia do
 * `rotuloDoInstante` do web, para a recusa da API e o modal falarem igual.
 *
 * Sem `toLocale*`: o contêiner roda em UTC e a trava global de fuso só deixa
 * `data-br.util` formatar. O deslocamento vem de lá (`OFFSET_BR_MS`), e as
 * leituras são as `getUTC*` do instante já deslocado.
 */
export function rotuloDoInstanteBR(instante: Date): string {
  const aqui = new Date(new Date(instante).getTime() - OFFSET_BR_MS);
  return `${DIAS_DA_SEMANA[aqui.getUTCDay()]}, ${doisDigitos(aqui.getUTCDate())}/${doisDigitos(aqui.getUTCMonth() + 1)}`
    + ` às ${doisDigitos(aqui.getUTCHours())}:${doisDigitos(aqui.getUTCMinutes())}`;
}

type Pessoa = { nome: string; nomeExibicao?: string | null } | null | undefined;

export function nomeDaPessoa(p: Pessoa): string {
  return (p?.nomeExibicao || p?.nome || '').trim();
}

/** "com a Dra. Shérad", "com o Dr. Murilo", "com Maria": sem chutar gênero do nome (a regra do web). */
export function comQuem(nome: string): string {
  if (/^dra\.?\s/i.test(nome)) return `com a ${nome}`;
  if (/^dr\.?\s/i.test(nome)) return `com o ${nome}`;
  return `com ${nome}`;
}

/** "A consulta com a Dra. X ainda não aconteceu (qui, 17/09 às 09:00). Para concluir agora, cancele a consulta junto." */
export function fraseConsultaFutura(consulta: { inicio: Date; responsavel?: Pessoa }): string {
  const quem = nomeDaPessoa(consulta.responsavel);
  return `A consulta${quem ? ` ${comQuem(quem)}` : ''} ainda não aconteceu (${rotuloDoInstanteBR(consulta.inicio)}). `
    + 'Para concluir agora, cancele a consulta junto.';
}

/**
 * A CONSULTA QUE JÁ COMEÇOU E NINGUÉM REGISTROU (15/09/2026, E2 da rodada 4).
 *
 * Até ali o modal perguntava à triagem se a consulta tinha acontecido, e a
 * triagem respondia pelo advogado. Medido em 14/09: das 4 consultas que o
 * advogado concluiu, as 4 exigiram que a triagem fechasse o atendimento à mão
 * depois, sem registrar nada novo. Agora quem registra é quem atendeu, e o
 * atendimento fecha junto; a triagem só conclui sem a consulta, cancelando-a.
 */
export function fraseConsultaSemRegistro(consulta: { inicio: Date; responsavel?: Pessoa }): string {
  const quem = nomeDaPessoa(consulta.responsavel);
  return `A consulta${quem ? ` ${comQuem(quem)}` : ''} de ${rotuloDoInstanteBR(consulta.inicio)} ainda não foi registrada. `
    + 'Se aconteceu, quem registra é quem atendeu, e o atendimento fecha sozinho. '
    + 'Para concluir sem ela, cancele a consulta junto.';
}

/** A consulta em andamento: quem está atendendo encerra, e o atendimento fecha junto. */
export function fraseEmAndamentoFechaSozinho(consulta: { responsavel?: Pessoa } | null | undefined): string {
  const quem = nomeDaPessoa(consulta?.responsavel);
  return `A consulta${quem ? ` ${comQuem(quem)}` : ''} está em andamento. `
    + 'Quando for registrada, o atendimento é concluído sozinho.';
}

// ---------------------------------------------------------------------------
// O plano
// ---------------------------------------------------------------------------

export interface AtendimentoParaFechar {
  status: string;
  desfecho: string | null;
}

export interface PlanoDeFechamento {
  consulta: {
    id: string;
    situacao: Exclude<SituacaoNoFechamento, 'NENHUMA'>;
    inicio: Date;
    local: string | null;
    linkReuniao: string | null;
    responsavel: ConsultaDoEncaminhamento['responsavel'];
  } | null;
  /** Consultas nascidas do atendimento ainda de pé (pendentes ou em andamento). */
  consultasAbertas: number;
  /**
   * O ATENDIMENTO FECHA SOZINHO quando a consulta for registrada (15/09/2026, E1
   * da rodada 4): pendente, encaminhado, com a consulta vigente futura, já
   * começada ou em andamento. A tela lê daqui e não recalcula; é este campo que
   * tira o "Concluir atendimento" do lugar de ação principal.
   */
  fechaSozinho: boolean;
  concluir: {
    permitido: boolean;
    recusa: string | null;
    consulta: 'NENHUMA' | 'CANCELAR_PARA_CONCLUIR' | 'ESCOLHER' | 'SO_MANTER';
    nota: 'OPCIONAL' | 'OBRIGATORIA' | 'OBRIGATORIA_SE_CANCELAR';
  };
  cancelar: {
    permitido: boolean;
    recusa: string | null;
    consulta: 'NENHUMA' | 'ATENDIDA' | 'ESCOLHER' | 'SO_MANTER';
  };
}

/**
 * A situação da consulta VIGENTE. "Já começou" é o INSTANTE, não o dia: a
 * consulta das 9h já pode ter acontecido às 15h do mesmo dia, e ninguém marcou.
 */
export function situacaoNoFechamento(
  consultas: ConsultaDoEncaminhamento[] | null | undefined,
  agora: Date = new Date(),
): { situacao: SituacaoNoFechamento; vigente: ConsultaDoEncaminhamento | null } {
  const nascidas = (consultas ?? []).filter(ehConsultaDoAtendimento);
  // A MESMA escolha do encaminhamento, lida pela própria função: se a regra da
  // vigente mudar lá, o fechamento acompanha sem ninguém lembrar.
  const encaminhamento = situacaoDoEncaminhamento(nascidas, agora);
  if (!encaminhamento || encaminhamento.estado === 'CANCELADA') return { situacao: 'NENHUMA', vigente: null };
  const vigente = nascidas.find((c) => c.id === encaminhamento.compromissoId)!;
  switch (vigente.status) {
    case 'CONCLUIDO':
      return { situacao: 'ATENDIDA', vigente };
    case 'EM_ANDAMENTO':
      return { situacao: 'EM_ANDAMENTO', vigente };
    default:
      return { situacao: new Date(vigente.inicio) > agora ? 'FUTURA' : 'COMECOU', vigente };
  }
}

/** As consultas que "cancelar junto" cancela: nascidas do atendimento e PENDENTES. Em andamento é de quem atende. */
export function consultasParaCancelar(consultas: ConsultaDoEncaminhamento[] | null | undefined): ConsultaDoEncaminhamento[] {
  return (consultas ?? []).filter((c) => ehConsultaDoAtendimento(c) && c.status === 'PENDENTE');
}

/**
 * AS CÓPIAS QUE SOBRARAM quando a consulta vigente já foi registrada (15/09/2026,
 * E4 da rodada 4; auditoria do atendimento, defeito 1).
 *
 * O plano dava "nada a decidir" para a vigente ATENDIDA, e o fechamento não
 * tocava as outras consultas abertas do mesmo atendimento: elas ficavam
 * pendentes para sempre na agenda de outro advogado. Medido em 14/09: nenhum
 * atendimento com duas nascidas de pé, então é borda, mas a borda que o laço
 * antigo criava.
 *
 * Só as PENDENTES: a cópia em andamento tem alguém atendendo, e é dele. Fora da
 * vigente ATENDIDA a lista é vazia: nos outros casos o que acontece com as
 * consultas é o que a pessoa escolheu.
 */
export function copiasQueSobraram(
  plano: Pick<PlanoDeFechamento, 'consulta'>,
  consultas: ConsultaDoEncaminhamento[] | null | undefined,
): ConsultaDoEncaminhamento[] {
  if (plano.consulta?.situacao !== 'ATENDIDA') return [];
  return consultasParaCancelar(consultas).filter((c) => c.id !== plano.consulta!.id);
}

/** O motivo que o advogado lê na linha do tempo da cópia cancelada junto. */
export function motivoDaCopiaCancelada(
  acao: 'CONCLUIR' | 'CANCELAR',
  numero: number,
  vigente: { inicio: Date; responsavel?: Pessoa } | null,
): string {
  const fechado = acao === 'CONCLUIR' ? 'concluído' : 'cancelado';
  const quem = nomeDaPessoa(vigente?.responsavel);
  const qual = vigente
    ? `a consulta${quem ? ` ${comQuem(quem)}` : ''} de ${rotuloDoInstanteBR(vigente.inicio)} já foi registrada`
    : 'a consulta já foi registrada';
  return `Atendimento #${numero} ${fechado}: ${qual}, e esta cópia sobrou.`;
}

export function planoDeFechamento(
  at: AtendimentoParaFechar,
  consultas: ConsultaDoEncaminhamento[] | null | undefined,
  agora: Date = new Date(),
): PlanoDeFechamento {
  const { situacao, vigente } = situacaoNoFechamento(consultas, agora);
  const consultasAbertas = (consultas ?? [])
    .filter((c) => ehConsultaDoAtendimento(c) && (c.status === 'PENDENTE' || c.status === 'EM_ANDAMENTO'))
    .length;

  // --- Concluir ---
  let recusaConcluir: string | null = null;
  if (at.status === 'CONCLUIDO') recusaConcluir = FRASE_JA_CONCLUIDO;
  else if (at.status === 'CANCELADO') recusaConcluir = FRASE_CANCELADO_REABRA;
  else if (!at.desfecho) recusaConcluir = FRASE_SEM_DESFECHO;

  let concluir: PlanoDeFechamento['concluir'];
  switch (situacao) {
    case 'FUTURA':
      // D13: o atendimento termina DEPOIS da consulta. Se a demanda acabou
      // antes, a consulta perdeu o objeto e sai junto; manter é recusado.
      concluir = { permitido: true, recusa: null, consulta: 'CANCELAR_PARA_CONCLUIR', nota: 'OBRIGATORIA' };
      break;
    case 'COMECOU':
      /*
        A TRIAGEM NÃO RESPONDE PELO ADVOGADO (15/09/2026, E2 da rodada 4). Era
        ESCOLHER: "aconteceu" fechava o atendimento com a consulta ainda aberta
        na agenda. Se aconteceu, quem registra é quem atendeu, e o atendimento
        fecha junto. Pela triagem, só "resolveu sem a consulta", que a cancela
        como perdeu o objeto, com a nota de como se resolveu.
      */
      concluir = { permitido: true, recusa: null, consulta: 'CANCELAR_PARA_CONCLUIR', nota: 'OBRIGATORIA' };
      break;
    case 'EM_ANDAMENTO':
      /*
        Alguém está atendendo agora: o atendimento fecha quando essa pessoa
        registrar. Concluir por cima era fechar o atendimento no meio da
        consulta, sem o que ela vai dizer.
      */
      concluir = {
        permitido: false, recusa: fraseEmAndamentoFechaSozinho(vigente), consulta: 'SO_MANTER', nota: 'OPCIONAL',
      };
      break;
    case 'ATENDIDA':
      // O desfecho da consulta, gravado pelo advogado, já conta o que houve:
      // obrigar a nota aqui só renderia eco ("consulta realizada").
      concluir = { permitido: true, recusa: null, consulta: 'NENHUMA', nota: 'OPCIONAL' };
      break;
    default:
      // Encaminhado sem consulta viva: nenhum outro registro diz como terminou.
      concluir = {
        permitido: true, recusa: null, consulta: 'NENHUMA',
        nota: at.desfecho === 'ENCAMINHADO' ? 'OBRIGATORIA' : 'OPCIONAL',
      };
  }
  if (recusaConcluir) concluir = { ...concluir, permitido: false, recusa: recusaConcluir };

  // --- Cancelar ---
  let recusaCancelar: string | null = null;
  if (at.status === 'CANCELADO') recusaCancelar = FRASE_JA_CANCELADO;
  else if (at.status === 'CONCLUIDO') recusaCancelar = FRASE_CONCLUIDO_REABRA;

  const consultaNoCancelar: PlanoDeFechamento['cancelar']['consulta'] =
    situacao === 'FUTURA' || situacao === 'COMECOU' ? 'ESCOLHER'
      : situacao === 'EM_ANDAMENTO' ? 'SO_MANTER'
        : situacao === 'ATENDIDA' ? 'ATENDIDA'
          : 'NENHUMA';

  return {
    consulta: vigente && situacao !== 'NENHUMA'
      ? {
          id: vigente.id,
          situacao,
          inicio: new Date(vigente.inicio),
          local: vigente.local ?? null,
          linkReuniao: vigente.linkReuniao ?? null,
          responsavel: vigente.responsavel ?? null,
        }
      : null,
    consultasAbertas,
    fechaSozinho: at.status === 'PENDENTE'
      && at.desfecho === 'ENCAMINHADO'
      && (situacao === 'FUTURA' || situacao === 'COMECOU' || situacao === 'EM_ANDAMENTO'),
    concluir,
    cancelar: { permitido: !recusaCancelar, recusa: recusaCancelar, consulta: consultaNoCancelar },
  };
}

// ---------------------------------------------------------------------------
// A decisão sobre o pedido — o que `concluir` e `cancelar` gravam
// ---------------------------------------------------------------------------

export type DecisaoDoFechamento =
  | { ok: false; recusa: string }
  | {
      ok: true;
      /** O que acontece com a consulta: CANCELAR cancela as pendentes nascidas; nulo, nada a decidir. */
      consulta: EscolhaDaConsulta | null;
      /** A nota (concluir) ou o detalhe (cancelar), já sem espaços; nulo quando vazio. */
      texto: string | null;
    };

/**
 * Confere o pedido de CONCLUIR contra o plano. `consulta` enviado quando não há
 * consulta aberta é IGNORADO, sem erro: o advogado pode ter fechado a consulta
 * enquanto o modal estava aberto, e isso não é engano de quem conclui.
 */
export function decidirConcluir(
  plano: PlanoDeFechamento,
  pedido: { nota?: string | null; consulta?: EscolhaDaConsulta | null },
): DecisaoDoFechamento {
  if (!plano.concluir.permitido) return { ok: false, recusa: plano.concluir.recusa ?? FRASE_SEM_DESFECHO };

  let consulta: EscolhaDaConsulta | null = null;
  switch (plano.concluir.consulta) {
    case 'CANCELAR_PARA_CONCLUIR':
      // A recusa diz o que houve com ESTA consulta: a que ainda vai acontecer e a
      // que já passou sem registro pedem frases diferentes. O web antigo, em
      // cache, ainda manda MANTER no COMECOU e cai aqui, com a frase nova.
      if (pedido.consulta !== 'CANCELAR') {
        return {
          ok: false,
          recusa: plano.consulta?.situacao === 'COMECOU'
            ? fraseConsultaSemRegistro(plano.consulta)
            : fraseConsultaFutura(plano.consulta!),
        };
      }
      consulta = 'CANCELAR';
      break;
    case 'ESCOLHER':
      // Desde 15/09/2026 o plano não produz ESCOLHER no concluir; o caso fica
      // para um plano calculado por um contêiner antigo na janela de troca.
      if (!pedido.consulta) {
        return { ok: false, recusa: plano.consulta ? fraseConsultaSemRegistro(plano.consulta) : FRASE_DIGA_O_QUE_FAZER };
      }
      consulta = pedido.consulta;
      break;
    case 'SO_MANTER':
      if (pedido.consulta === 'CANCELAR') return { ok: false, recusa: FRASE_EM_ANDAMENTO };
      consulta = 'MANTER';
      break;
    default:
      consulta = null;
  }

  const texto = pedido.nota?.trim() || null;
  const obrigatoria = plano.concluir.nota === 'OBRIGATORIA'
    || (plano.concluir.nota === 'OBRIGATORIA_SE_CANCELAR' && consulta === 'CANCELAR');
  if (obrigatoria && (texto ?? '').length < NOTA_MINIMA) return { ok: false, recusa: FRASE_NOTA_CURTA };
  if ((texto ?? '').length > NOTA_MAXIMA) return { ok: false, recusa: `A nota cabe em ${NOTA_MAXIMA} caracteres.` };
  return { ok: true, consulta, texto };
}

/** Confere o pedido de CANCELAR contra o plano. O motivo obrigatório é a CATEGORIA, não o texto. */
export function decidirCancelar(
  plano: PlanoDeFechamento,
  pedido: { categoria?: string | null; motivo?: string | null; consulta?: EscolhaDaConsulta | null },
): DecisaoDoFechamento {
  if (!(CATEGORIAS_CANCELAMENTO_ATENDIMENTO as readonly string[]).includes(pedido.categoria ?? '')) {
    return { ok: false, recusa: FRASE_CATEGORIA };
  }
  if (!plano.cancelar.permitido) return { ok: false, recusa: plano.cancelar.recusa ?? FRASE_JA_CANCELADO };

  let consulta: EscolhaDaConsulta | null = null;
  switch (plano.cancelar.consulta) {
    case 'ESCOLHER':
      if (!pedido.consulta) return { ok: false, recusa: FRASE_DIGA_O_QUE_FAZER };
      consulta = pedido.consulta;
      break;
    case 'SO_MANTER':
      if (pedido.consulta === 'CANCELAR') return { ok: false, recusa: FRASE_EM_ANDAMENTO };
      consulta = 'MANTER';
      break;
    default:
      consulta = null;
  }

  const texto = pedido.motivo?.trim() || null;
  if ((texto ?? '').length > MOTIVO_MAXIMO) return { ok: false, recusa: `O detalhe cabe em ${MOTIVO_MAXIMO} caracteres.` };
  return { ok: true, consulta, texto };
}

/**
 * O motivo gravado na consulta cancelada — é ele que o advogado lê na linha do
 * tempo da atividade, então diz de onde veio e o que a Triagem escreveu.
 */
export function motivoDaConsultaCancelada(
  acao: 'CONCLUIR' | 'CANCELAR',
  numero: number,
  situacao: SituacaoNoFechamento,
  texto: string | null,
): string {
  if (acao === 'CANCELAR') return texto ? `Atendimento #${numero} cancelado: ${texto}` : `Atendimento #${numero} cancelado.`;
  // COMECOU desde 15/09/2026: a triagem não afirma que a consulta não aconteceu,
  // só que a demanda se resolveu sem ela.
  const como = situacao === 'COMECOU'
    ? `Atendimento #${numero} concluído pela triagem sem a consulta`
    : `Atendimento #${numero} concluído antes da consulta`;
  return texto ? `${como}: ${texto}` : `${como}.`;
}
