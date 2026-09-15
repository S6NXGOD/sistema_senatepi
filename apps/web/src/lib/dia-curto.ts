/**
 * "qua, 16/09" — o dia curto, igual em toda tela que lista dias.
 *
 * UMA FUNÇÃO SÓ (15/09/2026). Havia duas `rotuloCurtoDoDia` com o mesmo nome e
 * assinaturas diferentes: a da Agenda pedia o dia de hoje (para pôr o ano quando
 * não é o corrente) e a da Escala não pedia nada. Quem importasse a errada
 * recebia outro formato sem erro de tipo que avisasse. Esta aceita as duas
 * formas: sem `hojeYmd`, nunca mostra o ano, que é o que a Escala fazia.
 *
 * Conta sobre o dia puro (Date.UTC), então não anda de dia em fuso nenhum.
 * Aceita 'AAAA-MM-DD' e também o ISO de coluna `@db.Date` ('2026-09-29T00:00:00.000Z'):
 * vale o texto do dia, nunca o instante. Texto que não é dia volta como veio.
 */
const DIAS_DA_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

export function rotuloCurtoDoDia(dia: string, hojeYmd?: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dia));
  if (!m) return dia;
  const [, ano, mes, d] = m;
  const semana = DIAS_DA_SEMANA[new Date(Date.UTC(+ano, +mes - 1, +d)).getUTCDay()];
  const comAno = !!hojeYmd && ano !== hojeYmd.slice(0, 4);
  return comAno ? `${semana}, ${d}/${mes}/${ano}` : `${semana}, ${d}/${mes}`;
}
