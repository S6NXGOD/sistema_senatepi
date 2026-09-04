/**
 * Fuso de Teresina, num lugar só.
 *
 * Estas três funções viviam duplicadas: `OFFSET_BR_MS` em `audiencia.util.ts` e
 * `inicioDoDiaBR`/`diaBR` privadas dentro de `audiencias.service.ts`. Quando o
 * robô de prazos passou a precisar de `diaBR` para não criar duas audiências no
 * mesmo dia, a escolha era copiar pela terceira vez ou extrair. Duas cópias de
 * uma regra de fuso é como as duas regras de classificação que já custaram caro
 * neste módulo: elas divergem em silêncio.
 *
 * Brasil sem horário de verão desde 2019 → offset fixo UTC-3.
 */
export const OFFSET_BR_MS = 3 * 3_600_000;

/** Meia-noite de hoje em Teresina, como instante real (UTC). */
export function inicioDoDiaBR(base = new Date()): Date {
  const br = new Date(base.getTime() - OFFSET_BR_MS);
  return new Date(Date.UTC(br.getUTCFullYear(), br.getUTCMonth(), br.getUTCDate()) + OFFSET_BR_MS);
}

/**
 * Chave "dia em Teresina" (yyyy-mm-dd).
 *
 * É por ela que se decide se dois eventos caem no MESMO dia — comparar
 * `Date` cru colocaria a audiência das 23h de Teresina no dia seguinte, porque
 * em UTC ela já virou.
 */
export function diaBR(d: Date): string {
  return new Date(d.getTime() - OFFSET_BR_MS).toISOString().slice(0, 10);
}

/**
 * HORA EM QUE O ROBÔ AGENDA — nove da manhã de Teresina, sempre.
 *
 * Os robôs usavam `setHours(9, 0, 0, 0)`, que resolve no fuso do PROCESSO —
 * uma configuração de ambiente, não do código. A produção mostrou o estrago em
 * 03/09/2026: na MESMA tabela, uma tarefa às 09:00 UTC (06:00 de Teresina) e
 * quatro às 12:00 UTC (09:00 de Teresina). Duas noções de "nove da manhã"
 * convivendo, e a agenda mostrando prazo às seis da manhã para quem chega às
 * oito.
 *
 * O resto do sistema já resolvia isso com `OFFSET_BR_MS`; os robôs eram a
 * exceção.
 */
export function noveDaManhaBR(dia: Date): Date {
  return new Date(inicioDoDiaBR(dia).getTime() + 9 * 3_600_000);
}

/**
 * NENHUMA TAREFA NASCE VENCIDA.
 *
 * O robô calculava "hoje às 9h" mesmo rodando às 20h — e a tarefa entrava na
 * agenda já na lista de atrasadas, com onze horas de atraso no instante do
 * nascimento. Medido em 03/09/2026: QUATRO das cinco atividades do DJEN
 * nasceram assim. Não é que o dia acabou sem alguém fazer; elas nunca tiveram
 * um minuto de validade, e o alerta "4 atividades com horário vencido" na home
 * era autogerado.
 *
 * Empurra para as nove da manhã do próximo dia ÚTIL. A data do compromisso é
 * quando SENTAR para fazer, não o prazo processual — o prazo o sistema não
 * calcula, e o aviso de atraso continua escrito na descrição.
 */
export function proximoHorarioUtilBR(candidato: Date, agora = new Date()): Date {
  const alvo = candidato > agora ? candidato : new Date(agora.getTime() + 24 * 3_600_000);
  const d = noveDaManhaBR(alvo);
  // Sábado e domingo empurram para segunda: ninguém abre o processo no fim de
  // semana, e a tarefa entraria na segunda já marcada como atrasada.
  while (ehFimDeSemanaBR(d)) d.setTime(d.getTime() + 24 * 3_600_000);
  return d > agora ? d : new Date(agora.getTime() + 3_600_000);
}

/** Dia da semana no fuso de Teresina — 0 domingo, 6 sábado. */
export function ehFimDeSemanaBR(d: Date): boolean {
  const dia = new Date(d.getTime() - OFFSET_BR_MS).getUTCDay();
  return dia === 0 || dia === 6;
}
