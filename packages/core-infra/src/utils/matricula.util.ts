/** Gera matrícula no formato PREFIXO-AAAA-NNNNNN (sequencial por contagem). */
export function gerarMatricula(prefixo: string, sequencial: number): string {
  const ano = new Date().getFullYear();
  const numero = String(sequencial).padStart(6, '0');
  return `${prefixo}-${ano}-${numero}`;
}

/** Mascara CPF: 123.456.789-00 -> ***.456.789-** */
export function mascararCpf(cpf?: string | null): string {
  if (!cpf) return '';
  const digitos = cpf.replace(/\D/g, '').padStart(11, '0');
  return `***.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-**`;
}
