import { ehDiaDeExpediente } from '../dashboard/feriados';
import { diaDeCalendarioBR } from '../processos/utils/data-br.util';

/**
 * QUANDO UMA ATIVIDADE PERDE O SENTIDO — pedido do dono em 07/11/2026.
 *
 * *"Quero que essas atividades em que foi perdido prazo ou passou do time sejam
 * canceladas automaticamente pelo sistema, e coloque que foi por falta de
 * interação do advogado com a atividade e o prazo ou o sentido da atividade foi
 * perdido."*
 *
 * A regra anterior esperava 20 dias de expediente com a atividade parada, e a
 * agenda passava um mês mostrando coisa que já não servia para nada.
 *
 * O CUIDADO QUE ESTA REGRA PRECISA TER: A DATA DA TAREFA DO ROBÔ NÃO É O PRAZO.
 * ---------------------------------------------------------------------------
 * É o dia reservado para fazer, com folga: `diasParaLembrete` põe a tarefa dois
 * dias úteis antes do prazo citado, e a contagem do Diário ainda empurra mais um
 * — a publicação é o primeiro dia útil depois da disponibilização, e o prazo só
 * começa no seguinte (Lei 11.419/2006, art. 4º, §§ 3º e 4º). Cancelar quando o
 * dia marcado passa apagaria o lembrete com o prazo AINDA ABERTO: exatamente o
 * contrário do que foi pedido.
 *
 * POR ISSO HÁ DOIS RELÓGIOS
 *  · ATO DO DIÁRIO: o último dia em que o prazo ainda pode estar correndo —
 *    disponibilização + 1 + prazo, em dias úteis forenses, mais 2 dias de margem
 *    para o feriado local que a lista nacional não conhece. O ato que não diz
 *    prazo ganha 15 dias (o recursal do CPC), nunca menos.
 *  · O RESTO: o dia marcado mais uma semana de expediente, para quem fez e
 *    registra depois — e registrar depois é o normal aqui (ver a folga abaixo).
 *
 * O QUE NUNCA VENCE POR TEMPO: audiência, consulta, reunião e perícia. São fatos
 * com hora marcada no mundo — aconteceram ou não, e "cancelada" afirmaria que não
 * aconteceram, coisa que o sistema não tem como saber.
 */

/** O ato que não diz prazo ganha o maior prazo comum: 15 dias úteis (CPC, art. 1.003, § 5º). */
export const PRAZO_PRESUMIDO_DIAS = 15;
/** Feriado estadual e municipal, ponto facultativo: o que a lista nacional não sabe. */
export const MARGEM_DO_PRAZO_DIAS_UTEIS = 2;
/**
 * UMA SEMANA DE EXPEDIENTE depois do dia marcado, para a tarefa sem ato do Diário.
 *
 * O primeiro corte foi de UM dia, e a simulação contra a produção o derrubou:
 * das 33 tarefas do robô sem ato que alguém concluiu, 15 foram registradas mais
 * de um dia útil depois do marcado — o "Cadastrar ação do Diário" é concluído
 * em lote (sete delas exatamente 3 dias úteis depois). Cancelar no dia seguinte
 * apagaria trabalho que ia ser registrado.
 *
 *   folga ............. 1    2    3    5    7
 *   robô atropelado ... 15   15   5    2    1   (de 33)
 *   gente atropelada .. 3    2    2    2    2   (de 13)
 *
 * Cinco é o joelho da curva: depois dele o ganho é de uma tarefa. As duas de
 * gente que sobram foram concluídas 12 e 29 dias úteis depois.
 */
export const FOLGA_DO_DIA_MARCADO_DIAS_UTEIS = 5;
/** Fatos com hora no mundo: o sistema não sabe se aconteceram. */
export const NUNCA_VENCEM_POR_TEMPO = ['AUDIENCIA', 'CONSULTA_JURIDICA', 'REUNIAO', 'PERICIA'] as const;

/** CPC, art. 220: os prazos processuais ficam suspensos de 20/12 a 20/01. */
export function emRecessoForense(dia: Date): boolean {
  const mes = dia.getUTCMonth();
  const d = dia.getUTCDate();
  return (mes === 11 && d >= 20) || (mes === 0 && d <= 20);
}

/** Dia em que prazo processual corre: expediente forense e fora do recesso. */
export function contaParaPrazo(dia: Date): boolean {
  return ehDiaDeExpediente(dia) && !emRecessoForense(dia);
}

function diaSeguinte(dia: Date): Date {
  return new Date(Date.UTC(dia.getUTCFullYear(), dia.getUTCMonth(), dia.getUTCDate() + 1));
}

/** Soma `n` dias que contam a um DIA de calendário (meia-noite UTC). */
function somarDiasQueContam(dia: Date, n: number, conta: (d: Date) => boolean): Date {
  let d = dia;
  let restantes = n;
  while (restantes > 0) {
    d = diaSeguinte(d);
    if (conta(d)) restantes--;
  }
  return d;
}

export interface AtividadeComRelogio {
  tipo: string;
  /** O instante marcado na agenda. */
  inicio: Date;
  /** As publicações que originaram a tarefa; vazio para as demais. */
  publicacoes: { dataDisponibilizacao: Date; prazoMencionadoDias: number | null }[];
}

export type PontoSemVolta =
  /** `fimDoPrazo` é o que a frase cita; `ultimoDia` é o que decide (nunca antes da folga do dia marcado). */
  | { tipo: 'PRAZO_DO_ATO'; ultimoDia: Date; fimDoPrazo: Date; prazoDias: number; prazoCitado: boolean }
  | { tipo: 'DIA_MARCADO'; ultimoDia: Date; diaMarcado: Date };

/**
 * O último dia (meia-noite UTC, dia de Teresina) em que a atividade ainda faz
 * sentido — ou `null` para o que nunca vence por tempo.
 */
export function pontoSemVolta(a: AtividadeComRelogio): PontoSemVolta | null {
  if ((NUNCA_VENCEM_POR_TEMPO as readonly string[]).includes(a.tipo)) return null;

  const diaMarcado = diaDeCalendarioBR(a.inicio);
  const fimDaFolga = somarDiasQueContam(diaMarcado, FOLGA_DO_DIA_MARCADO_DIAS_UTEIS, ehDiaDeExpediente);
  if (!a.publicacoes.length) return { tipo: 'DIA_MARCADO', ultimoDia: fimDaFolga, diaMarcado };

  /*
    A PUBLICAÇÃO MAIS GENEROSA MANDA. Uma tarefa agrupa as cópias do mesmo ato,
    e cópia pode chegar em outro dia; errar para o lado de esperar mais é errar
    para o lado em que ninguém perde prazo por causa do sistema.
  */
  let maisTarde: Extract<PontoSemVolta, { tipo: 'PRAZO_DO_ATO' }> | null = null;
  for (const p of a.publicacoes) {
    const prazoDias = p.prazoMencionadoDias ?? PRAZO_PRESUMIDO_DIAS;
    const fimDoPrazo = somarDiasQueContam(
      p.dataDisponibilizacao,
      prazoDias + 1 + MARGEM_DO_PRAZO_DIAS_UTEIS,
      contaParaPrazo,
    );
    if (!maisTarde || fimDoPrazo > maisTarde.fimDoPrazo) {
      maisTarde = {
        tipo: 'PRAZO_DO_ATO', ultimoDia: fimDoPrazo, fimDoPrazo,
        prazoDias, prazoCitado: p.prazoMencionadoDias != null,
      };
    }
  }
  /*
    A TAREFA QUE NASCEU DEPOIS DO PRAZO (ato antigo trazido pelo histórico) ainda
    ganha a folga do dia marcado: ninguém pode encontrar cancelada, ao abrir a
    agenda, uma tarefa que nasceu ontem. A frase continua citando o fim do prazo,
    que é o fato.
  */
  return fimDaFolga > maisTarde!.fimDoPrazo ? { ...maisTarde!, ultimoDia: fimDaFolga } : maisTarde;
}

/** Já passou do ponto? Compara DIAS de Teresina: o último dia inteiro ainda vale. */
export function perdeuOSentido(ponto: PontoSemVolta | null, agora: Date): boolean {
  return !!ponto && diaDeCalendarioBR(agora) > ponto.ultimoDia;
}

const ddmm = (dia: Date) =>
  `${String(dia.getUTCDate()).padStart(2, '0')}/${String(dia.getUTCMonth() + 1).padStart(2, '0')}`;

/**
 * A FRASE DO CANCELAMENTO, nas palavras que o dono pediu — e sem afirmar o que o
 * sistema não sabe.
 *
 * Ela diz o que aconteceu (o prazo terminou, ou o dia passou, e ninguém mexeu) e
 * o que isso significa (o prazo ou o sentido da atividade se perdeu). Não diz que
 * a peça deixou de ser feita: ela pode ter sido protocolada sem que ninguém
 * registrasse aqui, e por isso a frase termina dizendo como corrigir.
 */
export function fraseDaPerda(
  ponto: PontoSemVolta,
  responsavel: { nome: string; role: string },
  nemEntrou: boolean,
): string {
  const primeiroNome = responsavel.nome.split(' ')[0];
  const de = responsavel.role === 'ADVOGADO'
    ? `do advogado responsável (${primeiroNome})`
    : `de quem era responsável (${primeiroNome})`;
  const oQuePassou = ponto.tipo === 'PRAZO_DO_ATO'
    ? (ponto.prazoCitado
        ? `o prazo de ${ponto.prazoDias} dia(s) que o ato menciona terminou até ${ddmm(ponto.fimDoPrazo)}`
        : `o prazo presumido de ${ponto.prazoDias} dias úteis (o ato não diz prazo) terminou até ${ddmm(ponto.fimDoPrazo)}`)
    : `o dia marcado, ${ddmm(ponto.diaMarcado)}, passou`;
  return (
    `Cancelada pelo sistema por falta de interação ${de}: ${oQuePassou} sem que ninguém ` +
    'iniciasse, anotasse ou concluísse a atividade, e o prazo ou o sentido dela se perdeu.' +
    (ponto.tipo === 'PRAZO_DO_ATO'
      ? ' A conta é uma estimativa com folga: dias úteis, feriados nacionais e recesso forense.'
      : '') +
    (nemEntrou ? ` ${primeiroNome} não entrou no sistema desde que ela foi criada.` : '') +
    ' Se ela foi cumprida fora do sistema, reabra e conclua.'
  );
}
