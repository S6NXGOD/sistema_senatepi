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
 * FERIADO NÃO ENTRA, de propósito. Não há calendário forense no sistema, e
 * chutar feriado nacional erraria o que importa aqui — os recessos e os
 * feriados locais que suspendem o expediente em cada tribunal. Contar só o fim
 * de semana já elimina o falso positivo semanal, que era o problema real; um
 * feriado isolado ainda pode gerar um aviso, e aí ele está apenas adiantado,
 * não errado.
 */
export function diasUteisEntre(de: Date, ate: Date): number {
  if (ate <= de) return 0;
  let dias = 0;
  // Caminha por DIA de calendário, e não por blocos de 24h: o que interessa é
  // quantos dias de expediente passaram, não quantas voltas o relógio deu.
  const cursor = new Date(de.getFullYear(), de.getMonth(), de.getDate());
  const fim = new Date(ate.getFullYear(), ate.getMonth(), ate.getDate());
  while (cursor < fim) {
    cursor.setDate(cursor.getDate() + 1);
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) dias++;
  }
  return dias;
}
