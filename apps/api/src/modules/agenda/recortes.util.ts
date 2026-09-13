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
 * HOJE INCLUI O QUE FICOU PARA TRÁS.
 *
 * A faixa do topo acusava "2 atrasadas" e a agenda abria na aba Hoje sem elas —
 * era preciso saber que moravam em "Em aberto". Agora: aberta com início até o
 * fim de hoje (as antigas inclusive, no topo pela ordem de início) + qualquer
 * situação com início hoje, para a concluída às 10h continuar no quadro do dia.
 */
export function recorteHoje(agora: Date = new Date()): Prisma.CompromissoWhereInput {
  const { hojeIni, hojeFim } = limitesDoDia(agora);
  return {
    AND: [
      {
        OR: [
          { status: { in: STATUS_ABERTOS }, inicio: { lt: hojeFim } },
          { inicio: { gte: hojeIni, lt: hojeFim } },
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
}
