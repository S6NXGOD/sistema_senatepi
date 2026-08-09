/**
 * CNPJ — normalização, validação e formatação.
 *
 * Validar antes de chamar a BrasilAPI evita gastar requisição (e tempo do
 * usuário) com número digitado errado, e dá uma mensagem melhor do que o 404
 * genérico do serviço externo.
 */

/** Remove máscara: '12.345.678/0001-95' → '12345678000195'. */
export function apenasDigitosCnpj(valor: string | null | undefined): string {
  return (valor ?? '').replace(/\D/g, '');
}

/**
 * Valida os dois dígitos verificadores (módulo 11).
 * Rejeita também os repetidos (00000000000000, 11111111111111, …), que passam
 * no cálculo mas não existem na Receita.
 */
export function cnpjValido(valor: string | null | undefined): boolean {
  const d = apenasDigitosCnpj(valor);
  if (d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false;

  const digito = (base: string, pesos: number[]): number => {
    const soma = pesos.reduce((acc, peso, i) => acc + Number(base[i]) * peso, 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  const dv1 = digito(d, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const dv2 = digito(d, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return dv1 === Number(d[12]) && dv2 === Number(d[13]);
}

/** '12345678000195' → '12.345.678/0001-95' (devolve o original se não tiver 14 dígitos). */
export function formatarCnpj(valor: string | null | undefined): string {
  const d = apenasDigitosCnpj(valor);
  if (d.length !== 14) return valor ?? '';
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}
