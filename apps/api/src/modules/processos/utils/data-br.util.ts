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
 * O DIA DO CALENDÁRIO em Teresina, na forma que uma coluna `date` guarda.
 *
 * IRMÃ DE `inicioDoDiaBR`, E DIFERENTE DELA — a confusão entre as duas custa
 * caro, então: `inicioDoDiaBR` devolve o INSTANTE em que o dia começa em
 * Teresina (03:00 UTC); esta devolve o DIA, à meia-noite UTC, que é exatamente
 * como o Postgres materializa uma coluna `date`. Comparar uma coluna `date` com
 * `inicioDoDiaBR` marca o vencimento de HOJE como vencido, porque 00:00 < 03:00.
 *
 * Use esta quando o outro lado da comparação for `date` (dia contra dia); use
 * `inicioDoDiaBR` quando for `timestamp` (instante contra instante).
 *
 * Nasceu do robô de cobranças: ele usava `getUTCDate()` sobre o relógio do
 * contêiner (UTC) e marcava as parcelas como VENCIDO às 21:00 do próprio dia do
 * vencimento. As três parcelas VENCIDO da produção têm esse carimbo.
 */
export function diaDeCalendarioBR(base = new Date()): Date {
  const br = new Date(base.getTime() - OFFSET_BR_MS);
  return new Date(Date.UTC(br.getUTCFullYear(), br.getUTCMonth(), br.getUTCDate()));
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
 * PRIMEIRO DIA DO MÊS, à meia-noite daqui.
 *
 * `d.setDate(1); d.setHours(0,0,0,0)` resolvia no fuso do PROCESSO — no
 * contêiner, em UTC, isso é 21h do último dia do mês ANTERIOR. O "novos no mês"
 * do painel começava a contar três horas cedo e levava junto quem se filiou na
 * virada.
 *
 * `Date.UTC` aceita mês negativo e vira o ano sozinho — por isso `mesesAtras`
 * não precisa de conta de calendário aqui.
 */
export function inicioDoMesBR(base = new Date(), mesesAtras = 0): Date {
  const [ano, mes] = diaBR(base).split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1 - mesesAtras, 1) + OFFSET_BR_MS);
}

/**
 * Chave "mês em Teresina" (yyyy-mm), para agrupar gráfico.
 *
 * `getMonth()` responde no fuso do processo: um cadastro feito às 22h do dia 31
 * caía no mês seguinte no ar e no mês certo aqui.
 */
export function mesBR(d: Date): string {
  return diaBR(d).slice(0, 7);
}

/**
 * IDADE EM ANOS COMPLETOS, pelo calendário daqui.
 *
 * Comparar `getMonth()/getDate()` dos dois lados mistura o fuso do processo com
 * uma data de nascimento que é dia de calendário puro. Nas três últimas horas
 * do dia, no ar, o servidor já estava no dia seguinte — e quem faz aniversário
 * amanhã aparecia um ano mais velho hoje à noite.
 */
export function idadeEmAnosBR(nascimento: Date, referencia = new Date()): number {
  const [a1, m1, d1] = diaBR(nascimento).split('-').map(Number);
  const [a2, m2, d2] = diaBR(referencia).split('-').map(Number);
  let idade = a2 - a1;
  if (m2 < m1 || (m2 === m1 && d2 < d1)) idade--;
  return idade;
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

/**
 * O FUSO OFICIAL DO SISTEMA, escrito uma vez.
 *
 * Havia duas grafias no ar — `America/Sao_Paulo` na agenda e
 * `America/Fortaleza` nos anexos. Dão o mesmo resultado hoje (os dois são
 * UTC-3 e o Brasil não tem horário de verão desde 2019), mas duas grafias são
 * duas regras: no dia em que uma delas mudar, metade do sistema muda junto e a
 * outra metade não. Os crons já usam Fortaleza; o resto passa a usar também.
 */
export const FUSO_BR = 'America/Fortaleza';

/**
 * FORMATAR NO SERVIDOR — e por que isto precisou existir.
 *
 * `d.toLocaleDateString('pt-BR')` sem `timeZone` resolve no fuso do PROCESSO. O
 * contêiner do Railway roda em UTC, então tudo que o servidor escreve sai três
 * horas adiantado — e, entre 21h e 23h59 de Teresina, no DIA ERRADO.
 *
 * Auditado em 10/09/2026: das 28 formatações de data no servidor, **26 não
 * passavam `timeZone`**. Não era tela: era o que fica gravado —
 *
 *   PDF de carteirinha ......... data de filiação e validade
 *   PDF de certificado ......... datas do evento
 *   dossiê do processo ......... "emitido em", datas das peças
 *   CSV da auditoria ........... hora de cada registro
 *   lista de presença .......... hora do check-in
 *   descrição de tarefa do robô  data do andamento
 *
 * Um `toLocaleString` desses mostrava 17:04 num certificado emitido às 14:04.
 *
 * Para coluna `@db.Date` (data pura, sem hora) NÃO use estas: elas aplicariam
 * o offset a um valor que já é meia-noite UTC e voltariam um dia. Data pura no
 * servidor se compara com `diaBR`, que recorta o texto. No lado web a regra
 * equivalente é `lib/data-pura.ts`.
 */
export function formatarDataBR(d: Date | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('pt-BR', { timeZone: FUSO_BR });
}

/**
 * "10 de setembro de 2026" — a data por extenso dos DOCUMENTOS.
 *
 * A ficha de filiação e o termo de recadastramento assinam com a data do dia.
 * Sem `timeZone`, das 21h em diante o PDF saía assinado com a data de amanhã.
 */
export function formatarDataExtensoBR(d: Date | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('pt-BR', {
    timeZone: FUSO_BR,
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

/** "10/09/2026 14:04" no fuso de Teresina. */
export function formatarDataHoraBR(d: Date | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleString('pt-BR', {
    timeZone: FUSO_BR,
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

/**
 * SOMA DIAS ÚTEIS A UM DIA DE CALENDÁRIO — e a assinatura mudou de propósito.
 *
 * Ela morava em `automacao-prazos.service.ts` e pulava o fim de semana com
 * `d.getDay()`, que responde no fuso do PROCESSO. No contêiner (UTC) isso
 * significava:
 *
 *   · para uma coluna `date` (meia-noite UTC) ....... CERTO por acidente
 *   · para um instante de verdade .................... ERRADO na faixa
 *     00:00–03:00 UTC, que é 21h–23h59 de Teresina do dia anterior
 *
 * Medido na produção com `TZ=UTC` (o do contêiner): **113 de 2.000
 * movimentações** (5,7%) davam um prazo diferente do correto — e o exemplo
 * medido erra por DOIS dias, não um: `2026-08-03T02:20Z` devolvia 09/08 em vez
 * de 07/08.
 *
 * A ambiguidade era a doença: a mesma função recebia os dois tipos de valor e
 * não tinha como saber qual era. Agora o contrato é explícito — ela recebe um
 * DIA DE CALENDÁRIO à meia-noite UTC (o que `diaDeCalendarioBR` devolve, e o
 * que uma coluna `date` já é) e lê o dia da semana com `getUTCDay()`. Quem tem
 * um instante converte antes; quem tem uma coluna `date` passa direto.
 *
 * Feriado não entra: a lista varia por comarca e este prazo é um LEMBRETE de
 * conferência, não a contagem oficial — errar para menos seria pior do que
 * lembrar um dia antes.
 */
export function somarDiasUteisEmCalendario(diaBase: Date, dias: number): Date {
  const d = new Date(diaBase);
  let restantes = dias;
  while (restantes > 0) {
    d.setTime(d.getTime() + 24 * 3_600_000);
    const semana = d.getUTCDay();
    if (semana !== 0 && semana !== 6) restantes--;
  }
  return d;
}

/**
 * O ANO CORRENTE EM TERESINA — e não o do contêiner.
 *
 * `new Date().getFullYear()` no contêiner (UTC) vira o ano às 21h de 31 de
 * dezembro. A carteirinha emitida às 22h daquele dia sairia numerada
 * `CART-2027-...` estando ainda em 2026, e com validade um ano deslocada. É uma
 * janela de três horas por ano — e é exatamente o tipo de erro que ninguém
 * consegue explicar quando aparece.
 */
export function anoBR(base = new Date()): number {
  return new Date(base.getTime() - OFFSET_BR_MS).getUTCFullYear();
}

/**
 * UM ANO A PARTIR DE AGORA, contado pelo calendário daqui.
 *
 * `d.setFullYear(d.getFullYear() + 1)` lê e escreve no fuso do processo. Na
 * virada do ano isso desloca a validade da carteirinha em doze meses.
 */
export function daquiAUmAnoBR(base = new Date()): Date {
  const br = new Date(base.getTime() - OFFSET_BR_MS);
  return new Date(
    Date.UTC(
      br.getUTCFullYear() + 1,
      br.getUTCMonth(),
      br.getUTCDate(),
      br.getUTCHours(),
      br.getUTCMinutes(),
      br.getUTCSeconds(),
    ) + OFFSET_BR_MS,
  );
}
