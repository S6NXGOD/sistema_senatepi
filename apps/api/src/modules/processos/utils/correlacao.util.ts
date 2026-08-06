import { classificarMovimentacao } from './audiencia.util';
import { diaBR } from './data-br.util';

/**
 * Pareamento DataJud ↔ DJEN: qual publicação descreve qual movimentação.
 *
 * O PROBLEMA QUE ISTO RESOLVE
 * As duas fontes contam o MESMO fato de ângulos diferentes. O DataJud registra
 * "Expedição de documento" no dia 3; o DJEN publica, no dia 4, o teor daquela
 * expedição: "Intimo a parte autora a apresentar réplica no prazo de 15 dias".
 * Sem amarrar as duas, cada uma geraria a sua atividade — o advogado abriria a
 * agenda e encontraria duas tarefas para uma intimação só, e passaria a
 * desconfiar de todas.
 *
 * COMO A DUPLICATA É EVITADA, DE FATO
 * Não há mecanismo novo. `MovimentacaoProcessual.compromissoId` já é a trava de
 * idempotência do robô de prazos: uma movimentação carimbada é pulada, e o
 * pré-filtro nem a carrega. A correlação apenas passa a carimbar esse mesmo
 * campo a partir do DJEN — de modo que, chegue quem chegar primeiro, o segundo
 * encontra o fato já resolvido.
 *
 * Função pura: recebe listas de um único processo e devolve os pares. Sem
 * banco, sem rede — é a regra mais delicada da integração e precisa ser
 * testável linha a linha.
 */

/**
 * Janela de casamento, em dias.
 *
 * A publicação SAI DEPOIS do ato (o tribunal pratica, depois disponibiliza no
 * diário), então a diferença nunca é negativa — publicação anterior ao
 * movimento é outro fato, não o mesmo. Três dias corridos absorvem o fim de
 * semana: ato na sexta, disponibilização na segunda.
 */
const JANELA_DIAS = 3;
const DIA_MS = 24 * 3_600_000;

export interface MovimentacaoCorrelacionavel {
  id: string;
  dataMovimento: Date;
  descricao: string;
  detalhe?: string | null;
  conteudo?: string | null;
  codigoMovimento?: number | null;
  /** Já gerou atividade? Continua elegível — o cenário A enriquece. */
  compromissoId: string | null;
}

export interface ComunicacaoCorrelacionavel {
  id: string;
  dataDisponibilizacao: Date;
  /** Já pareada numa execução anterior. */
  movimentacaoId: string | null;
  /** A publicação designa pauta (`providencia === 'PREPARAR_AUDIENCIA'`). */
  ehPauta: boolean;
}

export interface ParCorrelacionado {
  comunicacaoId: string;
  movimentacaoId: string;
  /** Distância em dias — 0 quando ato e publicação caem no mesmo dia. */
  deltaDias: number;
}

/**
 * OS DOIS LADOS TÊM NATUREZA DIFERENTE — e tratá-los igual desloca tudo em um
 * dia, o que faria a janela inteira mentir.
 *
 * `dataMovimento` é TIMESTAMP: o ato ocorreu num instante, e o dia dele é o dia
 * em Teresina. Um ato às 22h de Teresina já é o dia seguinte em UTC.
 *
 * `dataDisponibilizacao` é coluna DATE: já é um dia de calendário, sem hora e
 * sem fuso. Converter fuso nela a empurraria para o dia anterior — a publicação
 * do dia 04 viraria 03, e "ato no dia 3, publicado no dia 4" apareceria como
 * diferença zero.
 */
function diaDoAto(d: Date): number {
  return new Date(`${diaBR(d)}T00:00:00.000Z`).getTime();
}

function diaDaPublicacao(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Pareia publicações e movimentações de UM processo.
 *
 * Uma comunicação `c` e uma movimentação `m` descrevem o mesmo fato quando:
 *
 *  1. `0 ≤ (dia de c − dia de m) ≤ 3`;
 *  2. `m` é um ato que ABRE PRAZO pelo classificador do DataJud — intimação,
 *     citação, publicação, despacho. Um "Recebimento" ou uma "Remessa" não é o
 *     que a publicação está comunicando;
 *  3. nenhuma das duas já está pareada.
 *
 * CASO ESPECIAL — PAUTA: se a publicação designa audiência, a condição 2 aceita
 * também movimentação de pauta. O texto do DJEN traz "designada para 15/08/2026
 * às 14h00" com muito mais frequência que o rótulo do DataJud, e deixar as duas
 * soltas criaria uma audiência pelo radar e uma preparação pelo DJEN.
 *
 * ATRIBUIÇÃO: entre os candidatos, vence o de MENOR distância; empate resolve
 * pelo id, para que duas execuções sobre os mesmos dados produzam os mesmos
 * pares. A atribuição é gulosa e um-para-um — uma publicação não descreve duas
 * movimentações, nem o contrário.
 */
export function correlacionar(
  comunicacoes: ComunicacaoCorrelacionavel[],
  movimentacoes: MovimentacaoCorrelacionavel[],
): ParCorrelacionado[] {
  const disponiveis = comunicacoes.filter((c) => !c.movimentacaoId);
  if (!disponiveis.length) return [];

  // Movimentações que outra publicação já reivindicou não entram na disputa.
  const jaTomadas = new Set(
    comunicacoes.map((c) => c.movimentacaoId).filter((id): id is string => !!id),
  );

  const elegiveis = movimentacoes
    .filter((m) => !jaTomadas.has(m.id))
    .map((m) => ({
      m,
      dia: diaDoAto(m.dataMovimento),
      gatilho: classificarMovimentacao(
        [m.descricao, m.detalhe, m.conteudo].filter(Boolean).join(' — '),
        m.codigoMovimento,
        m.dataMovimento,
      ).tipo,
    }));

  const candidatos: ParCorrelacionado[] = [];
  for (const c of disponiveis) {
    const diaPub = diaDaPublicacao(c.dataDisponibilizacao);
    for (const e of elegiveis) {
      const deltaDias = (diaPub - e.dia) / DIA_MS;
      if (deltaDias < 0 || deltaDias > JANELA_DIAS) continue;

      const ehAtoDePrazo = e.gatilho === 'PRAZO';
      const ehPautaDosDoisLados =
        c.ehPauta && (e.gatilho === 'AUDIENCIA' || e.gatilho === 'PERICIA');
      if (!ehAtoDePrazo && !ehPautaDosDoisLados) continue;

      candidatos.push({ comunicacaoId: c.id, movimentacaoId: e.m.id, deltaDias });
    }
  }

  candidatos.sort(
    (a, b) =>
      a.deltaDias - b.deltaDias ||
      a.comunicacaoId.localeCompare(b.comunicacaoId) ||
      a.movimentacaoId.localeCompare(b.movimentacaoId),
  );

  const pares: ParCorrelacionado[] = [];
  const comUsadas = new Set<string>();
  const movUsadas = new Set<string>();
  for (const par of candidatos) {
    if (comUsadas.has(par.comunicacaoId) || movUsadas.has(par.movimentacaoId)) continue;
    comUsadas.add(par.comunicacaoId);
    movUsadas.add(par.movimentacaoId);
    pares.push(par);
  }
  return pares;
}
