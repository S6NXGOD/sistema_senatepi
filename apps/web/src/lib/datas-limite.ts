/**
 * Limites das datas de PESSOA, espelhando os validadores da API
 * (apps/api/src/common/validators/data.validators.ts).
 *
 * Existem para o erro aparecer ANTES do envio: o `max`/`min` nativo do
 * `<input type="date">` já impede escolher a data no seletor, e o zod devolve a
 * mensagem quando alguém digita direto no campo. A API continua sendo a
 * autoridade — isto aqui é conveniência, não a trava.
 *
 * As duas regras:
 *   1. nenhuma data de fato consumado no futuro (nascimento, admissão, filiação);
 *   2. ninguém com mais de 100 anos — na prática é ano trocado na digitação.
 */

export const IDADE_MAXIMA_ANOS = 100;

/** Brasil sem horário de verão desde 2019 → offset fixo UTC-3. */
const OFFSET_BR_MS = 3 * 3_600_000;

/** 'AAAA-MM-DD' de hoje em Brasília — o `max` dos campos de data. */
export function hojeISO(): string {
  return new Date(Date.now() - OFFSET_BR_MS).toISOString().slice(0, 10);
}

/** 'AAAA-MM-DD' de 100 anos atrás — o `min` dos campos de nascimento. */
export function nascimentoMinimoISO(): string {
  const d = new Date(Date.now() - OFFSET_BR_MS);
  d.setUTCFullYear(d.getUTCFullYear() - IDADE_MAXIMA_ANOS);
  return d.toISOString().slice(0, 10);
}

/** Atributos prontos para um `<input type="date">` de data já ocorrida. */
export const LIMITES_DATA_PASSADA = { max: hojeISO() };

/** Atributos prontos para um `<input type="date">` de nascimento. */
export const LIMITES_NASCIMENTO = { max: hojeISO(), min: nascimentoMinimoISO() };

/** `true` quando a data não é futura. Vazio passa (quem cobra é o `required`). */
export function dataNaoFutura(valor?: string | null): boolean {
  if (!valor) return true;
  return valor.slice(0, 10) <= hojeISO();
}

/** `true` quando a data não é futura E não passa de 100 anos. */
export function nascimentoPlausivel(valor?: string | null): boolean {
  if (!valor) return true;
  const dia = valor.slice(0, 10);
  return dia <= hojeISO() && dia >= nascimentoMinimoISO();
}

/** Mensagens padronizadas — as mesmas do back, para não haver dois idiomas. */
export const MSG_DATA_FUTURA = 'A data não pode ser futura.';
export const MSG_IDADE_IMPLAUSIVEL = `Mais de ${IDADE_MAXIMA_ANOS} anos — confira o ano digitado.`;
