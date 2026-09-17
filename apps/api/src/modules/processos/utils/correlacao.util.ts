import { classificarMovimentacao } from './audiencia.util';
import { diaBR } from './data-br.util';
import {
  DIAS_CASAMENTO_PUBLICACAO_ANTES, DIAS_CASAMENTO_PUBLICACAO_DEPOIS,
} from './janela-do-robo.util';

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
 * Janela de casamento, em dias — e ela não é simétrica (17/09/2026).
 *
 * A regra anterior dizia: "a publicação SAI DEPOIS do ato, então diferença
 * negativa é outro fato". Isso descreve o papel do cartório, não a ordem em que
 * os dois dados chegam ao nosso banco. O DJEN publica o teor em D+0; o DataJud
 * registra o mesmo ato com mediana de 62 dias de atraso. Na prática o TEOR
 * CHEGA PRIMEIRO, e a regra antiga mandava ignorá-lo.
 *
 * MEDIDO NA PRODUÇÃO — 294 movimentações de publicação/intimação dos últimos 60
 * dias:
 *
 *   com publicação do Diário até 5 dias ANTES do ato .... 153  ← era ignorado
 *   com publicação até 3 dias DEPOIS ..................... 94  ← já casava
 *   com publicação mais de 5 dias antes .................. 26
 *   sem publicação nenhuma no processo .................... 5
 *
 * Das 153, CENTO E SEIS viraram tarefa cega — "Verificação de Intimação /
 * Prazo", sem dizer o que fazer — com o texto do ato já gravado no banco, a
 * cinco dias dali. O mesmo fato contado duas vezes, e quem ficava de fora era
 * justamente o lado que sabia o que o juízo pediu.
 *
 * OS DOIS LADOS TÊM TAMANHOS DIFERENTES, de propósito:
 *  - DEPOIS: 3 dias, como sempre foi. É a demora entre praticar e disponibilizar
 *    no diário, e três dias corridos absorvem o fim de semana (ato na sexta,
 *    publicação na segunda).
 *  - ANTES: 5 dias. É o atraso do índice do CNJ em relação ao diário. A massa
 *    cabe em cinco (153) e a cauda fica fora (26). Esticar mais passaria a
 *    juntar ato com ato: num processo movimentado, a intimação de segunda e a
 *    de sexta são fatos diferentes, e um par errado é pior que par nenhum.
 */
/*
  OS DOIS NÚMEROS MORAM EM `janela-do-robo.util.ts`, com o porquê inteiro. Aqui
  eram literais locais, e o arquivo que existe para ser o dono dos números do
  robô descrevia uma janela simétrica que já não era a do ar.
*/
const JANELA_ANTES_DIAS = DIAS_CASAMENTO_PUBLICACAO_ANTES;
const JANELA_DEPOIS_DIAS = DIAS_CASAMENTO_PUBLICACAO_DEPOIS;
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
 *  1. `−5 ≤ (dia de c − dia de m) ≤ 3` — a publicação pode ser anterior ao ato,
 *     porque o diário chega em D+0 e o índice do CNJ demora (ver a janela);
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
 * ATRIBUIÇÃO: entre os candidatos, vence o de MENOR distância em módulo (agora
 * há os dois sinais); empate resolve pela publicação que veio DEPOIS do ato e,
 * em seguida, pelo id, para que duas execuções sobre os mesmos dados produzam
 * os mesmos pares. A atribuição é gulosa e um-para-um — uma publicação não
 * descreve duas movimentações, nem o contrário.
 *
 * `movimentacoesJaPareadas` é o que o BANCO já sabe: os andamentos que
 * publicações de outras execuções descrevem. Ver o comentário de `jaTomadas`.
 */
export function correlacionar(
  comunicacoes: ComunicacaoCorrelacionavel[],
  movimentacoes: MovimentacaoCorrelacionavel[],
  movimentacoesJaPareadas: Iterable<string> = [],
  /**
   * Teto do lado ANTES, para quem PAGA CARO por um par errado.
   *
   * A passada que grava `movimentacao.compromissoId` silencia o andamento para
   * sempre; ela aperta este lado (`DIAS_ADOCAO_DO_ATO_POSTERIOR`). Os demais
   * chamadores só enriquecem e usam a janela cheia.
   */
  janelaAntesDias: number = JANELA_ANTES_DIAS,
): ParCorrelacionado[] {
  const disponiveis = comunicacoes.filter((c) => !c.movimentacaoId);
  if (!disponiveis.length) return [];

  /*
    MOVIMENTAÇÃO QUE OUTRA PUBLICAÇÃO JÁ REIVINDICOU NÃO ENTRA NA DISPUTA — e
    até 17/09/2026 esta frase não era verdade no ar.

    O conjunto saía do PRÓPRIO array de entrada, e os três chamadores filtram
    por `movimentacaoId: null` antes de chamar (dois deles mandam `null` fixo no
    lugar do campo). O `filter` corria sobre uma lista em que nenhuma linha tem
    par: o conjunto era SEMPRE VAZIO, e a função só enxergava o lote da vez. A
    publicação de hoje podia reapontar o andamento que a publicação da semana
    passada já descreve.

    Agora o que está gravado entra por fora, lido do banco pelo chamador, e a
    derivação do próprio lote continua para quem passar uma lista misturada.
    A ordem importa: isto é pré-requisito da propagação de decisão — parear
    errado com a propagação ligada carimba a decisão de um ato no andamento de
    outro, que é bem pior que não parear.
  */
  const jaTomadas = new Set<string>(movimentacoesJaPareadas);
  for (const c of comunicacoes) if (c.movimentacaoId) jaTomadas.add(c.movimentacaoId);

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
      if (deltaDias > JANELA_DEPOIS_DIAS || deltaDias < -janelaAntesDias) continue;

      const ehAtoDePrazo = e.gatilho === 'PRAZO';
      const ehPautaDosDoisLados =
        c.ehPauta && (e.gatilho === 'AUDIENCIA' || e.gatilho === 'PERICIA');
      if (!ehAtoDePrazo && !ehPautaDosDoisLados) continue;

      candidatos.push({ comunicacaoId: c.id, movimentacaoId: e.m.id, deltaDias });
    }
  }

  candidatos.sort(
    (a, b) =>
      // A distância é em MÓDULO desde 17/09/2026: com a janela dos dois lados,
      // ordenar pelo valor com sinal poria a publicação de cinco dias antes na
      // frente da que saiu no dia seguinte ao ato.
      Math.abs(a.deltaDias) - Math.abs(b.deltaDias) ||
      // Mesma distância dos dois lados (o diário do dia 9 e o do dia 11 para o
      // ato do dia 10): vence o que saiu DEPOIS, que é a ordem em que o juízo
      // pratica e só então divulga. Sem este degrau o desempate viraria sorteio
      // pelo id.
      b.deltaDias - a.deltaDias ||
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

/**
 * A DECISÃO DO DIÁRIO PROPAGADA PARA A MOVIMENTAÇÃO PAREADA (17/09/2026).
 *
 * Quando o teor e o andamento descrevem o mesmo fato, decidir duas vezes é
 * decidir duas vezes errado: o robô do DataJud abre "Verificação de Intimação /
 * Prazo" sem saber o que o juízo pediu (48 criadas, 32 canceladas, e 9 das 11
 * concluídas fechadas com "não havia peça a fazer"), enquanto o lado que leu o
 * texto já tinha resolvido.
 *
 * SÓ PROPAGA O QUE FOI DECIDIDO LENDO O TEOR. Esta é a linha inteira deste
 * arquivo, e ela separa duas naturezas:
 *
 *  - DECISÃO DE LEITURA: o texto do ato diz que a ordem é da outra parte, que
 *    aquilo é a cópia de um ato já decidido, que não há providência nenhuma a
 *    tomar, ou que virou tarefa/proposta. Vale para o fato, venha por onde
 *    vier — logo vale para o andamento irmão.
 *
 *  - DECISÃO DE RELÓGIO: `NOTICIA_VELHA` e `FORA_DA_JANELA` não falam do ato,
 *    falam de QUANDO ele chegou a nós. Propagá-las calaria o único lado que
 *    ainda poderia avisar: o andamento que o DataJud entregou hoje, dentro da
 *    janela, seria dispensado por causa da idade de uma publicação que talvez
 *    nem devesse ter sido lida. Trocar tarefa inútil por SILÊNCIO é o erro que
 *    esta frente veio desfazer, e é por isso que a lista é branca (só entra o
 *    que está escrito aqui) e não preta.
 *
 * ESTE ARQUIVO DIZ QUAIS DECISÕES ATRAVESSAM, e só isso. O que vai escrito na
 * coluna é `MOTIVOS_DO_ROBO.TEOR_NO_DIARIO`, vocabulário da frente irmã
 * (`automacao-prazos.service.ts`), que já o deixou reservado com o nome desta
 * aqui no comentário. Um vocabulário, um dono.
 *
 * E O ID DA PUBLICAÇÃO IRMÃ não vira texto dentro do motivo: ele já está no
 * VÍNCULO. Todo caminho que carimba também grava `comunicacaoDjen.movimentacaoId`
 * — inclusive o "nada a fazer", desde hoje —, e a ficha lê o teor pela relação
 * `movimentacao.comunicacoes`, que a leitura de movimentações já traz ao lado de
 * `avaliadoMotivo`. Um id repetido dentro de uma string seria uma segunda
 * verdade sobre o mesmo par, livre para divergir da primeira.
 */
export const DECISOES_DO_TEOR = [
  /** O texto mostra que a ordem é da parte contrária. */
  'ORDEM_DA_OUTRA_PARTE',
  /** Outra cópia do mesmo ato (mesmo link) já foi decidida. */
  'COPIA_DO_MESMO_ATO',
  /** Classificado e sem nada a fazer — lista de distribuição, edital. */
  'SEM_PROVIDENCIA',
  /** O teor virou atividade na agenda (nova, herdada ou enriquecida). */
  'VIROU_TAREFA',
  /** O teor está na caixa do advogado, esperando gente. */
  'VIROU_PROPOSTA',
] as const;

export type DecisaoDoTeor = (typeof DECISOES_DO_TEOR)[number];

/**
 * As que NUNCA propagam. Não são usadas para decidir nada aqui — a lista de
 * cima já é branca —, existem para o teste poder cobrá-las pelo nome e para
 * quem ler o arquivo saber que a omissão é deliberada.
 */
export const DECISOES_DE_RELOGIO = ['NOTICIA_VELHA', 'FORA_DA_JANELA'] as const;

/**
 * ESTA DECISÃO PODE ATRAVESSAR PARA O ANDAMENTO PAREADO?
 *
 * Lista BRANCA, e é isso que faz a garantia valer: um caminho novo que invente
 * um motivo e esqueça de pensar no assunto simplesmente não carimba, e o pior
 * que acontece é o andamento continuar sendo avaliado — que é o estado de hoje.
 * Com lista preta, o esquecimento produziria silêncio, que é o dano.
 */
export function aDecisaoDoDiarioAtravessa(
  decisao: string | null | undefined,
): decisao is DecisaoDoTeor {
  return !!decisao && (DECISOES_DO_TEOR as readonly string[]).includes(decisao);
}
