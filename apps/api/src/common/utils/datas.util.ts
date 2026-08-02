/**
 * Datas de CALENDÁRIO (nascimento, admissão, desligamento…).
 *
 * O problema que isto resolve: `new Date('1982-06-24')` cria meia-noite **UTC**.
 * Como o sistema é usado no Piauí (UTC-3) e a tela formata com
 * `toLocaleDateString('pt-BR')`, esse instante volta como **23/06/1982** — um
 * dia a menos. Foi exatamente o que travou o recadastramento por link: a ficha
 * mostrava 23/06 e o desafio esperava 24/06.
 *
 * Convenção adotada: guardar meia-noite de Brasília (03:00Z). É a mesma que a
 * importação inicial da base já usava (363 dos 365 filiados), então:
 *   - `toLocaleDateString('pt-BR')` no navegador mostra o dia certo;
 *   - `toISOString().slice(0, 10)` no servidor devolve o mesmo dia certo.
 *
 * O offset é fixo em -03:00 de propósito. O Brasil não tem mais horário de
 * verão, e mesmo nas datas antigas em que tinha (UTC-2) o horário local cai em
 * 01:00 — nunca atravessa para o dia anterior.
 */

/** Meia-noite de Brasília, em UTC. */
const OFFSET_BRASILIA = 'T03:00:00.000Z';

/** Aceita 'YYYY-MM-DD', ISO completo ou Date; devolve o instante canônico. */
export function dataCalendario(valor: string | Date): Date;
export function dataCalendario(valor: string | Date | null | undefined): Date | undefined;
export function dataCalendario(valor: string | Date | null | undefined): Date | undefined {
  if (valor === null || valor === undefined || valor === '') return undefined;
  const dia = diaDe(valor);
  return dia ? new Date(`${dia}${OFFSET_BRASILIA}`) : undefined;
}

/**
 * Versão para campos que aceitam limpeza: `null` entra como `null`
 * (apaga no banco), `undefined` como `undefined` (não mexe).
 */
export function dataCalendarioOuNulo(valor: string | Date | null | undefined): Date | null | undefined {
  if (valor === undefined) return undefined;
  if (valor === null || valor === '') return null;
  return dataCalendario(valor) ?? null;
}

/**
 * O dia (YYYY-MM-DD) que uma data de calendário representa.
 *
 * Considera as duas convenções que convivem na base: o dia em UTC e o dia em
 * Brasília. Registros gravados antes desta correção podem estar em meia-noite
 * UTC; comparar pelos dois evita recusar um filiado que digitou certo.
 */
export function diasPossiveis(valor: Date | null | undefined): string[] {
  if (!valor) return [];
  const utc = valor.toISOString().slice(0, 10);
  const brasilia = new Date(valor.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
  return utc === brasilia ? [utc] : [utc, brasilia];
}

/** Extrai 'YYYY-MM-DD' de uma string ISO/`Date` sem passar por fuso. */
function diaDe(valor: string | Date): string | null {
  if (valor instanceof Date) {
    return Number.isNaN(valor.getTime()) ? null : valor.toISOString().slice(0, 10);
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor.trim());
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
