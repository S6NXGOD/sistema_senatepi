import { Prisma, StatusCompromisso } from '@prisma/client';
import { inicioDoDiaBR } from '../processos/utils/data-br.util';

/**
 * OS RECORTES DA AGENDA — calculados no SERVIDOR, e por uma regra só.
 *
 * O quadro baixava a agenda inteira sem intervalo e recortava "Hoje", "7 dias"
 * e "Em aberto" no navegador. A API ordena por início e corta em 500, ou seja,
 * entregava as 500 MAIS ANTIGAS: no dia em que o acervo passasse do limite, a
 * aba padrão diria "nada para hoje" em silêncio. Hoje são 92 atividades
 * (medido em 12/09/2026) e o robô cria atividade todo dia.
 *
 * E havia três definições de "atrasada" no ar — o sino, o painel e a barra de
 * alertas da agenda (+3h, em vermelho). Aqui ficam as definições que valem, e
 * o PAINEL importa daqui: o número que ele mostra e a aba que o link abre
 * saem da mesma função (memória "o link leva o recorte").
 *
 * COMO COMBINAR: sempre dentro de um `AND: [...]`, nunca espalhando dois
 * objetos (`{ ...a, ...b }`). Dois `OR` no mesmo objeto se sobrescrevem e o
 * filtro some sem erro — já custou uma varredura inteira neste projeto. Por
 * isso os recortes que precisam de `OR` já vêm embrulhados em `AND`.
 *
 * DIA É O DE TERESINA (`inicioDoDiaBR`): o contêiner roda em UTC, e às 21h
 * daqui o dia dele já virou.
 */

const DIA_MS = 86_400_000;

export const RECORTES = ['hoje', 'atrasadas', 'atencao', '7dias', 'aberto', 'todos'] as const;
export type Recorte = (typeof RECORTES)[number];

export const ehRecorte = (v: unknown): v is Recorte =>
  typeof v === 'string' && (RECORTES as readonly string[]).includes(v);

/** "Todos" não é o acervo desde 2024: é o que ainda importa — 60 dias para trás, ou aberto. */
export const DIAS_PARA_TRAS_EM_TODOS = 60;

export const STATUS_ABERTOS: StatusCompromisso[] = [
  StatusCompromisso.PENDENTE,
  StatusCompromisso.EM_ANDAMENTO,
];

/**
 * Os tipos que têm HORA MARCADA com alguém do outro lado.
 *
 * Tarefa ("Elaborar manifestação") tem início às 9h por convenção do robô, não
 * porque alguém espera a pessoa às 9h. É por isso que ela não "choca" com uma
 * audiência às 9h30 (ver `conflitos`) e que o cronômetro esquecido só vale
 * para estes tipos (D7).
 */
export const TIPOS_COM_HORA = ['CONSULTA_JURIDICA', 'REUNIAO', 'AUDIENCIA', 'PERICIA'] as const;

export interface LimitesDoDia {
  /** 00:00 de hoje em Teresina. */
  hojeIni: Date;
  /** 00:00 de amanhã em Teresina. */
  hojeFim: Date;
  /** 00:00 do dia seguinte a hoje+7 — "7 dias" inclui o sétimo dia inteiro. */
  fimDosSeteDias: Date;
  /** 00:00 de 60 dias atrás. */
  inicioDeTodos: Date;
}

export function limitesDoDia(agora: Date = new Date()): LimitesDoDia {
  const hojeIni = inicioDoDiaBR(agora);
  return {
    hojeIni,
    hojeFim: new Date(hojeIni.getTime() + DIA_MS),
    fimDosSeteDias: new Date(hojeIni.getTime() + 8 * DIA_MS),
    inicioDeTodos: new Date(hojeIni.getTime() - DIAS_PARA_TRAS_EM_TODOS * DIA_MS),
  };
}

/** PENDENTE ou EM_ANDAMENTO, sem corte de data. */
export function recorteAberto(): Prisma.CompromissoWhereInput {
  return { status: { in: STATUS_ABERTOS } };
}

/**
 * FICOU PARA TRÁS: aberta, e o dia já virou. É a régua do sino desde 08/09 —
 * a que não admite discussão (ninguém defende que a tarefa de ontem esteja em
 * dia). O que é de hoje com a hora passada fica em `recortePassaramDaHora`.
 */
export function recorteAtrasadas(agora: Date = new Date()): Prisma.CompromissoWhereInput {
  const { hojeIni } = limitesDoDia(agora);
  return { status: { in: STATUS_ABERTOS }, inicio: { lt: hojeIni } };
}

/** Passou da hora marcada, mas ainda é hoje — informação, não alarme. */
export function recortePassaramDaHora(agora: Date = new Date()): Prisma.CompromissoWhereInput {
  const { hojeIni } = limitesDoDia(agora);
  return { status: { in: STATUS_ABERTOS }, inicio: { gte: hojeIni, lt: agora } };
}

/** O que pede atenção agora: ficou para trás + passou da hora hoje. A mesma soma do painel. */
export function recorteAtencao(agora: Date = new Date()): Prisma.CompromissoWhereInput {
  return { AND: [{ OR: [recorteAtrasadas(agora), recortePassaramDaHora(agora)] }] };
}

/**
 * HOJE É O TRABALHO DE HOJE, MAIS O QUE SAIU HOJE.
 *
 * INCLUI O QUE FICOU PARA TRÁS: a faixa do topo acusava "2 atrasadas" e a
 * agenda abria na aba Hoje sem elas — era preciso saber que moravam em
 * "Em aberto". Aberta com início até o fim de hoje entra, as antigas inclusive.
 *
 * E O SEGUNDO RAMO DEIXOU DE SER A DATA (18/09/2026). Era "qualquer situação
 * com início HOJE", para a concluída às 10h continuar no quadro do dia. Só que
 * a data da atividade e o dia em que ela foi fechada são coisas diferentes:
 *
 *   "Por que essas tarefas estão aparecendo no filtro de hoje sendo que foram
 *    concluídas no dia 15?" — o dono, 18/09/2026.
 *
 * Ele estava certo. As TRÊS atividades com data de hoje na produção daquele dia
 * haviam sido fechadas no dia 15: remarcadas para o 18 e concluídas antes. Não
 * eram trabalho de hoje nem fecho de hoje — eram ruído nas duas leituras.
 *
 * Agora o segundo ramo pergunta pelo CARIMBO: fechada ou cancelada hoje, seja
 * qual for a data dela. Com isso a concluída de manhã continua no quadro (que
 * era o objetivo), a de três dias atrás sai, e a que venceu semana passada mas
 * foi resolvida hoje passa a aparecer — que é o que "saiu hoje" quer dizer.
 */
export function recorteHoje(agora: Date = new Date()): Prisma.CompromissoWhereInput {
  const { hojeIni, hojeFim } = limitesDoDia(agora);
  const fechadoHoje = { gte: hojeIni, lt: hojeFim };
  return {
    AND: [
      {
        OR: [
          // O trabalho: aberta e já devida.
          { status: { in: STATUS_ABERTOS }, inicio: { lt: hojeFim } },
          // O que saiu hoje. `canceladoEm` entra junto: cancelar é um desfecho,
          // e some da tela de amanhã como qualquer outro.
          { concluidoEm: fechadoHoje },
          { canceladoEm: fechadoHoje },
        ],
      },
    ],
  };
}

/** Os próximos 7 dias, pela mesma lógica de Hoje: as atrasadas abertas entram. */
export function recorteSeteDias(agora: Date = new Date()): Prisma.CompromissoWhereInput {
  const { hojeIni, fimDosSeteDias } = limitesDoDia(agora);
  return {
    AND: [
      {
        OR: [
          { status: { in: STATUS_ABERTOS }, inicio: { lt: fimDosSeteDias } },
          { inicio: { gte: hojeIni, lt: fimDosSeteDias } },
        ],
      },
    ],
  };
}

/** Os últimos 60 dias e o futuro, mais qualquer aberta antiga — nada aberto some. */
export function recorteTodos(agora: Date = new Date()): Prisma.CompromissoWhereInput {
  const { inicioDeTodos } = limitesDoDia(agora);
  return {
    AND: [{ OR: [{ inicio: { gte: inicioDeTodos } }, { status: { in: STATUS_ABERTOS } }] }],
  };
}

export function whereDoRecorte(recorte: Recorte, agora: Date = new Date()): Prisma.CompromissoWhereInput {
  switch (recorte) {
    case 'hoje':
      return recorteHoje(agora);
    case 'atrasadas':
      return recorteAtrasadas(agora);
    case 'atencao':
      return recorteAtencao(agora);
    case '7dias':
      return recorteSeteDias(agora);
    case 'aberto':
      return recorteAberto();
    case 'todos':
      return recorteTodos(agora);
  }
}

/* ------------------------------------------------------------------------ */
/* A janela do tempo e a página por cursor (14/09/2026, D20 da rodada 3)     */
/* ------------------------------------------------------------------------ */

/**
 * PARA QUE LADO DO TEMPO A LISTA OLHA.
 *
 * O que tornava a aba Todas inútil não era o volume (89 atividades no acervo
 * inteiro em 14/09/2026, a mais antiga de 06/08): era a ORDEM. Crescente, ela
 * abria 60 dias atrás, e o hoje ficava no meio da lista. A lista por dia do
 * celular divide Todas em duas:
 *  · ADIANTE — o que começa hoje ou depois, mais toda aberta de dia anterior
 *    (o que ficou para trás continua pedindo mão, então mora em Próximas);
 *  · ANTERIORES — fechada (concluída ou cancelada) de dia anterior.
 *
 * As duas são COMPLEMENTARES sobre o acervo inteiro — o complemento de
 * "começa hoje ou está aberta" é "começou antes e está fechada", porque a
 * situação só tem quatro valores. Somadas a qualquer recorte, repartem o
 * recorte sem sobra e sem repetição: Próximas + Anteriores = Todas.
 *
 * Fechada é `in [CONCLUIDO, CANCELADO]`, nunca `not in` abertos: `not` do
 * Prisma não traz a linha nula (memória "not em coluna nula").
 */
export const JANELAS = ['adiante', 'anteriores'] as const;
export type Janela = (typeof JANELAS)[number];

export const STATUS_FECHADOS: StatusCompromisso[] = [
  StatusCompromisso.CONCLUIDO,
  StatusCompromisso.CANCELADO,
];

export function whereDaJanela(janela: Janela, agora: Date = new Date()): Prisma.CompromissoWhereInput {
  const { hojeIni } = limitesDoDia(agora);
  if (janela === 'anteriores') {
    return { inicio: { lt: hojeIni }, status: { in: STATUS_FECHADOS } };
  }
  return { AND: [{ OR: [{ inicio: { gte: hojeIni } }, { status: { in: STATUS_ABERTOS } }] }] };
}

/**
 * ANTERIORES VEM DO MAIS RECENTE PARA O MAIS ANTIGO — "Ontem", depois
 * anteontem. Assim a página seguinte nunca entra acima do que a pessoa já leu.
 * Sem janela, a ordem de sempre (crescente), que o web antigo e o calendário
 * leem.
 */
export type Sentido = 'asc' | 'desc';

export const sentidoDaJanela = (janela?: Janela | null): Sentido =>
  janela === 'anteriores' ? 'desc' : 'asc';

/**
 * O ID DESEMPATA, SEMPRE. O robô grava muitas tarefas às 9h em ponto: com a
 * ordem só por início, duas atividades do mesmo instante podiam trocar de
 * lugar entre uma consulta e outra, e a página seguinte repetiria uma e
 * pularia a outra. Tipado como array mutável pelo mesmo motivo de
 * `EQUIPE_ORDER` (o Prisma não aceita `readonly` em `orderBy`).
 */
export function ordemDaListagem(janela?: Janela | null): Prisma.CompromissoOrderByWithRelationInput[] {
  const sentido = sentidoDaJanela(janela);
  return [{ inicio: sentido }, { id: sentido }];
}

/** Sem `limite`, a listagem de sempre: 500. Com ele, de 1 a 200. */
export const LIMITE_SEM_PAGINA = 500;
export const LIMITE_MAXIMO_DA_PAGINA = 200;

/**
 * O CURSOR É `<início do último item em ISO>_<id>` — keyset, nunca offset.
 *
 * Com o robô criando e remarcando atividades o dia inteiro, "pule as 50
 * primeiras" repete ou pula itens entre uma página e outra. "Depois de
 * (início, id)" não: o que já foi lido fica para trás mesmo que entre coisa
 * nova antes. O id da atividade é UUID (schema.prisma, `Compromisso.id`).
 */
export const FORMATO_DO_CURSOR =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z_[0-9a-fA-F-]{36}$/;

export interface Cursor {
  inicio: Date;
  id: string;
}

/** O cursor que continua depois deste item — a mesma conta que o web faz. */
export const cursorDe = (item: { inicio: Date | string; id: string }): string =>
  `${new Date(item.inicio).toISOString()}_${item.id}`;

/** Lê o cursor; nulo quando o texto não é um cursor válido. */
export function lerCursor(texto: string | null | undefined): Cursor | null {
  if (!texto || !FORMATO_DO_CURSOR.test(texto)) return null;
  const corte = texto.indexOf('_');
  const inicio = new Date(texto.slice(0, corte));
  if (Number.isNaN(inicio.getTime())) return null;
  return { inicio, id: texto.slice(corte + 1) };
}

/** O que vem DEPOIS do cursor, no sentido da lista. Já embrulhado em AND. */
export function whereDoCursor(cursor: Cursor, sentido: Sentido): Prisma.CompromissoWhereInput {
  const depois = sentido === 'desc' ? 'lt' : 'gt';
  return {
    AND: [
      {
        OR: [
          { inicio: { [depois]: cursor.inicio } },
          { inicio: cursor.inicio, id: { [depois]: cursor.id } },
        ],
      },
    ],
  };
}

/**
 * NPU só entra na busca a partir de 6 dígitos. Com menos, "Prazo 15" casaria
 * todo processo com "15" no número e a lista ficaria cheia de ruído.
 */
export const DIGITOS_MINIMOS_PARA_NPU = 6;

/**
 * A BUSCA ACHA O CASO DO JEITO QUE O ADVOGADO LEMBRA DELE.
 *
 * Buscava só título e nome do filiado — e o título do robô é uma categoria
 * ("Verificação de Intimação / Prazo"), não uma identidade. Quem procura lembra
 * "aquele contra a Prefeitura de X" ou tem o NPU colado do e-mail do tribunal.
 *
 * O NPU é gravado só com dígitos, então a pontuação da busca é descartada.
 * Parte e NPU só entram para quem vê Processos: achar atividades pelo nome da
 * parte é saber quem litiga naquele processo, que é o dado cortado para a
 * Triagem (ver `leitorVeProcessos` no serviço).
 */
export function filtroDaBusca(
  texto: string,
  alcance: { processos: boolean } = { processos: true },
): Prisma.CompromissoWhereInput {
  const busca = texto.trim();
  const ou: Prisma.CompromissoWhereInput[] = [
    { titulo: { contains: busca, mode: 'insensitive' } },
    { filiado: { nomeCompleto: { contains: busca, mode: 'insensitive' } } },
  ];
  if (alcance.processos) {
    ou.push({ processo: { partes: { some: { nome: { contains: busca, mode: 'insensitive' } } } } });
    const digitos = busca.replace(/\D/g, '');
    if (digitos.length >= DIGITOS_MINIMOS_PARA_NPU) {
      ou.push({ processo: { numeroCNJ: { contains: digitos } } });
    }
  }
  return { OR: ou };
}

/** A forma da resposta de `GET /compromissos/recortes` — um `count()` por aba. */
export interface ContagemDosRecortes {
  hoje: number;
  atrasadas: number;
  atencao: number;
  seteDias: number;
  aberto: number;
  todos: number;
  /** Abertas marcadas como urgentes — o botão "Urgentes" é um só (D10). */
  urgentes: number;
  /**
   * As duas metades de Todas (14/09/2026): `todos` = `todosAdiante` +
   * `todosAnteriores`, por construção (`whereDaJanela`). É o número do seletor
   * "Próximas | Anteriores" da lista por dia; o web antigo ignora os dois.
   */
  todosAdiante: number;
  todosAnteriores: number;
}
