import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatarData(data?: string | Date | null): string {
  if (!data) return '-';
  return new Date(data).toLocaleDateString('pt-BR');
}

/**
 * Texto pronto para comparar: minúsculo e sem acento.
 *
 * Serve aos filtros que rodam NO NAVEGADOR (combobox de cidade, de UF), onde
 * a lista já está em memória e não faz sentido ir ao servidor. Quem digita
 * "sao raimundo" precisa achar "São Raimundo Nonato", e ninguém digita til
 * enquanto procura.
 *
 * A busca do servidor tem sua própria versão disto (api/common/utils/
 * busca.util.ts), com a mesma regra de acento — as duas são independentes de
 * propósito: esta filtra lista curta em memória, aquela alimenta consulta SQL.
 */
export function normalizarTexto(valor?: string | null): string {
  return (valor ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

export function mascararCpf(cpf?: string | null): string {
  if (!cpf) return '';
  const d = cpf.replace(/\D/g, '').padStart(11, '0');
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}
