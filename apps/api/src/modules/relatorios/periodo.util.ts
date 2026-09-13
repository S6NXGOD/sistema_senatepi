import { diaBR, instanteDoTextoBR } from '../processos/utils/data-br.util';

/** Trinta dias é o período que a coordenação olha; o resto se escolhe na tela. */
export const DIAS_PADRAO = 30;

const DIA_MS = 24 * 3_600_000;

/**
 * O PERÍODO PEDIDO PELA TELA, em instantes que os serviços entendem.
 *
 * Os dois relatórios fazem a mesma conta sobre o que sai daqui: começam em
 * `inicioDoDiaBR(de)` e fecham no fim do dia de `ate`. Com `new Date('AAAA-MM-DD')`
 * a conta andava um dia para trás — ver `instanteDoTextoBR`.
 *
 * Período invertido é erro de digitação, não pedido: inverte em silêncio em vez
 * de devolver tabela vazia e deixar a pessoa procurando o que errou.
 */
export function periodoDoFiltro(
  q: { de?: string; ate?: string },
  agora = new Date(),
): { de: Date; ate: Date } {
  const ate = q.ate ? instanteDoTextoBR(q.ate) : agora;
  const de = q.de ? instanteDoTextoBR(q.de) : new Date(ate.getTime() - DIAS_PADRAO * DIA_MS);
  return de <= ate ? { de, ate } : { de: ate, ate: de };
}

/**
 * AS DUAS DATAS DO NOME DA PLANILHA — o primeiro e o ÚLTIMO dia contados.
 *
 * O `ate` que os serviços devolvem é exclusivo (o instante em que o dia seguinte
 * começa), e recortar o texto ISO errava as duas pontas: o começo lido em UTC e
 * o fim um dia depois do escolhido. "2026-08-13 - 2026-09-13" para quem pediu
 * até 12/09 é o tipo de detalhe que faz desconfiar da planilha inteira.
 */
export function diasDoNomeDoArquivo(periodo: { de: string; ate: string }): [string, string] {
  return [diaBR(new Date(periodo.de)), diaBR(new Date(new Date(periodo.ate).getTime() - 1))];
}
