import { diaBR } from '../processos/utils/data-br.util';
import { ehDiaDeExpediente } from './feriados';

/**
 * DIAS ÚTEIS ENTRE DUAS DATAS — sábado e domingo não contam.
 *
 * POR QUE ISTO EXISTE. O painel media o silêncio do DJEN em HORAS, e o Diário
 * de Justiça não circula no fim de semana: conferido nas 1.408 publicações da
 * produção, **nenhuma** tem data de disponibilização de sábado ou domingo
 * (segunda 339, terça 201, quarta 322, quinta 271, sexta 275).
 *
 * Com corte em 48 horas, todo domingo à noite a home acusava a integração de
 * silenciosa — enquanto o próprio texto do aviso dizia que "fim de semana
 * explica silêncio curto". A tela contradizia a si mesma toda semana.
 *
 * FERIADO NACIONAL PASSOU A ENTRAR — 03/11/2026.
 *
 * O comentário antigo dizia que um feriado isolado geraria "um aviso apenas
 * adiantado, não errado". Errado ele estava: na terça de Finados o painel
 * anunciou "não recebe as publicações do Diário desde domingo, 01/11" — um
 * domingo, que nunca tem publicação, somado a uma segunda que foi feriado. A
 * faixa acusava dois dias de silêncio em que não havia uma linha a receber, e
 * quem lê isso vai procurar defeito onde não há.
 *
 * Entram só os NACIONAIS, que suspendem o expediente no país inteiro e dá para
 * calcular sem chutar. Feriado estadual, municipal e o recesso continuam fora,
 * e aí sim o aviso sai adiantado — ver `feriados.ts`.
 *
 * O DIA É O DIA DAQUI, NÃO O DO CONTÊINER.
 *
 * A primeira versão usava `getDate()`/`getDay()`, que leem o fuso do PROCESSO.
 * O contêiner do Railway roda em UTC (nada define `TZ` em lugar nenhum), então
 * a virada do dia acontecia às 21h de Brasília — e das 21h à meia-noite a conta
 * devolvia um dia a mais. Medido: último sucesso na segunda 05h (o horário do
 * cron do DJEN) e "agora" na terça 22h dava **2** dias úteis no contêiner e
 * **1** nesta máquina. A faixa dispararia uma noite inteira antes da hora —
 * exatamente o falso alarme que esta função existe para evitar. Passou
 * despercebido porque a máquina de desenvolvimento também é UTC-3.
 *
 * O offset vem de `data-br.util`, e não de uma constante nova aqui: aquele
 * arquivo existe justamente porque a regra de fuso já tinha sido copiada três
 * vezes neste projeto, e cópias de regra de fuso divergem em silêncio.
 */

export function diasUteisEntre(de: Date, ate: Date): number {
  if (ate <= de) return 0;
  let dias = 0;
  /*
    Cada ponta vira a meia-noite UTC do seu dia civil AQUI. Daí em diante a
    caminhada é UTC pura — sem fuso no meio, e por isso mesmo estável onde quer
    que o processo esteja hospedado.

    Caminha por DIA de calendário, e não por blocos de 24h: o que interessa é
    quantos dias de expediente passaram, não quantas voltas o relógio deu.
  */
  const cursor = new Date(`${diaBR(de)}T00:00:00Z`);
  const fim = new Date(`${diaBR(ate)}T00:00:00Z`);
  while (cursor < fim) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (ehDiaDeExpediente(cursor)) dias++;
  }
  return dias;
}
