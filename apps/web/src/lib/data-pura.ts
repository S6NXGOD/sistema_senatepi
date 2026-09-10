/**
 * DATA PURA — a que não tem hora, e por isso não pode ter fuso.
 *
 * O BUG. "Escala cadastrada na segunda aparecendo no domingo." Não era da
 * escala: era de TODA coluna `@db.Date` do sistema, e de todo mundo que a
 * lesse fora de UTC.
 *
 * Um `date` do Postgres não guarda instante nenhum — guarda "14 de setembro".
 * O Prisma o materializa como `2026-09-14T00:00:00.000Z`, e o JSON o entrega
 * assim. Aí `new Date(...).toLocaleDateString('pt-BR')` num navegador em
 * Teresina (UTC-3) resolve para 13/09 às 21h e escreve **13/09**. A data anda
 * um dia para trás, sempre, em qualquer fuso negativo.
 *
 * MEDIDO NA PRODUÇÃO EM 10/09/2026 — não é amostra, é o total:
 *
 *   escalas_advogados.data ................... 25 de 25    (30/09 → 29/09)
 *   parcelas.data_vencimento ................. 36 de 36    (20/09 → 19/09)
 *   parcelas.data_competencia ................ 36 de 36    (10/09 → 09/09)
 *   comunicacoes_djen.data_disponibilizacao .. 500 de 500  (04/12 → 03/12)
 *
 * Vencimento de carnê é documento que o filiado leva ao banco. Data de
 * disponibilização é de onde se conta prazo processual. Nenhum dos dois pode
 * errar por um dia.
 *
 * COMO ESTA FUNÇÃO É IMUNE: ela nunca constrói um `Date` a partir do instante.
 * Recorta `YYYY-MM-DD` do texto e reconstrói ao MEIO-DIA UTC — longe o
 * suficiente das duas bordas para nenhum fuso do planeta (de -12 a +14) mudar o
 * dia. A formatação ainda força `timeZone: 'UTC'`, que é o cinto além do
 * suspensório.
 *
 * QUANDO NÃO USAR: se o campo tem HORA de verdade (um compromisso às 09:00, um
 * `createdAt`), o fuso é essencial e o certo continua sendo `formatData` /
 * `formatHora` de `lib/agenda`. Converter um instante para UTC mostraria a hora
 * errada. Qual campo é de qual tipo está fixado em `data-pura.spec.ts`.
 */

/** Os quatro campos `@db.Date` do schema — a lista que o teste confere. */
export const CAMPOS_DE_DATA_PURA = [
  'escalas_advogados.data',
  'parcelas_cobranca.data_vencimento',
  'parcelas_cobranca.data_competencia',
  'comunicacoes_djen.data_disponibilizacao',
] as const;

const PADRAO: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
};

/** `YYYY-MM-DD` de qualquer forma que a data pura chegue (ISO completo ou não). */
function soODia(valor: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(valor).trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * Um `Date` seguro para uma data pura: meio-dia UTC.
 *
 * Meio-dia, e não meia-noite, é o detalhe que faz a coisa funcionar. Com
 * `T00:00:00Z` qualquer fuso negativo já cai no dia anterior — que É o bug.
 * Com `T12:00:00Z` sobram doze horas de folga para cada lado.
 */
export function dataPuraComoDate(valor: string | null | undefined): Date | null {
  if (!valor) return null;
  const dia = soODia(valor);
  return dia ? new Date(`${dia}T12:00:00.000Z`) : null;
}

/**
 * "20/09/2026" — e nunca "19/09/2026".
 *
 * Aceita opções do `Intl` para os casos com dia da semana ("segunda-feira,
 * 14/09"), mas `timeZone` é sempre UTC: quem chama não tem o direito de
 * reintroduzir o bug.
 */
export function formatDataPura(
  valor: string | null | undefined,
  opcoes?: Omit<Intl.DateTimeFormatOptions, 'timeZone'>,
): string {
  const d = dataPuraComoDate(valor);
  if (!d) return '—';
  return d.toLocaleDateString('pt-BR', { ...(opcoes ?? PADRAO), timeZone: 'UTC' });
}

/**
 * Quantos dias inteiros se passaram desde uma data pura, contando por
 * CALENDÁRIO de Teresina.
 *
 * `(Date.now() - new Date(dataPura)) / 86.400.000` erra por até um dia inteiro,
 * porque compara um instante com uma meia-noite UTC. Aqui os dois lados viram
 * dia de calendário antes de subtrair.
 */
export function diasDesdeDataPura(valor: string | null | undefined): number | null {
  const dia = valor ? soODia(valor) : null;
  if (!dia) return null;
  const hojeBR = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
  const ms = new Date(`${hojeBR}T12:00:00.000Z`).getTime() - new Date(`${dia}T12:00:00.000Z`).getTime();
  return Math.round(ms / 86_400_000);
}
