import { OFFSET_BR_MS } from './data-br.util';

/**
 * DOIS TIPOS DE TEMPO NO MESMO CAMPO — e o que acontece quando se esquece disso.
 *
 * 24/09/2026: *"Na listagem, diz que a última movimentação do processo foi
 * ontem. Mas fui ver e teve publicação do DJEN hoje."* Estava certo, e o defeito
 * era de um dia inteiro no dado que mais corre prazo.
 *
 * `ultimaMovimentacao` escolhe a mais nova entre três fontes, e elas não guardam
 * a mesma coisa:
 *
 *   DataJud (`data_movimento`) ......... `timestamp` — um INSTANTE
 *   nota da equipe (`created_at`) ...... `timestamp` — um INSTANTE
 *   Diário (`data_disponibilizacao`) ... `date`      — um DIA DE CALENDÁRIO
 *
 * O Prisma materializa o `date` como `2026-09-24T00:00:00.000Z`. Duas coisas
 * quebram por causa disso:
 *
 * **Na tela.** Formatado em Teresina (UTC−3), `24/09 00:00Z` é `23/09 às 21h`.
 * A coluna escrevia "23/09 · ontem" para a intimação publicada hoje. É o mesmo
 * defeito que `lib/data-pura` no web já documenta para as quatro colunas
 * `@db.Date` do sistema — faltava dizer a ele QUAL das três datas é pura.
 *
 * **Na comparação.** Meia-noite UTC do dia D fica ANTES de uma nota escrita no
 * dia D−1 às 22h de Teresina (que em UTC é o dia D às 01h). A publicação perdia
 * para o que veio antes dela.
 *
 * A regra abaixo resolve a segunda: a data pura disputa como o **fim do seu dia
 * em Teresina**. Nada do mesmo dia é mais novo que ela — que é exatamente o que
 * "disponibilizado no dia D" significa quando não se sabe a hora, e é o que faz
 * a publicação com prazo ganhar do andamento burocrático do mesmo dia.
 */

export interface CandidatoAMovimentacao {
  data: Date;
  /** `true` só para a data que veio de uma coluna `@db.Date`. */
  diaPuro: boolean;
}

const DIA_MS = 86_400_000;

/**
 * O instante que representa este candidato na disputa pela "mais nova".
 *
 * Instante: ele mesmo. Dia de calendário: o último milissegundo daquele dia em
 * Teresina.
 */
export function paraComparar(c: CandidatoAMovimentacao): number {
  const t = c.data.getTime();
  if (!c.diaPuro) return t;
  /*
    `t` é a meia-noite UTC do dia D. O fim do dia D em Teresina (UTC−3) é
    `D+1 T02:59:59.999Z` — ou seja, `t + 24h + 3h - 1ms`. Sai do relógio do
    processo de propósito: a conta é aritmética pura sobre o offset do Brasil,
    como o resto de `data-br.util`.
  */
  return t + DIA_MS + OFFSET_BR_MS - 1;
}
