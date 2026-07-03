import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatarData(data?: string | Date | null): string {
  if (!data) return '-';
  return new Date(data).toLocaleDateString('pt-BR');
}

export function mascararCpf(cpf?: string | null): string {
  if (!cpf) return '';
  const d = cpf.replace(/\D/g, '').padStart(11, '0');
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}
