/** Gera matrícula no formato PREFIXO-AAAA-NNNNNN. */
export function gerarMatricula(prefixo: string, sequencial: number): string {
  const ano = new Date().getFullYear();
  const numero = String(sequencial).padStart(6, '0');
  return `${prefixo}-${ano}-${numero}`;
}

/**
 * O PRÓXIMO SEQUENCIAL, a partir do MAIOR JÁ EMITIDO.
 *
 * POR QUE ISTO EXISTE — e por que `count() + 1` não serve.
 *
 * Contar registros só acerta enquanto NADA for apagado. Na primeira exclusão o
 * contador anda para trás e devolve um número que já está num crachá: o índice
 * único recusa, e — como nada é inserido — a contagem NUNCA mais muda. O
 * cadastro para de funcionar de vez, não uma vez.
 *
 * Foi o que derrubou o cadastro de filiados em produção em 14/08/2026:
 * `Unique constraint failed on the fields: (matricula)`, repetido o dia inteiro,
 * em toda tentativa. Ver `FiliadosService.proximaMatricula`.
 *
 * ATRAVESSA OS ANOS de propósito: o ano faz parte do texto da matrícula, mas o
 * sequencial é único no cadastro inteiro. Retomar do 1 em janeiro colidiria com
 * o ano anterior.
 *
 * Ignora o que não estiver no padrão — matrícula da carga legada tem outro
 * formato, e deixá-la influenciar o contador daria saltos enormes ou, pior,
 * números negativos vindos de texto que só parece número.
 */
export function proximoSequencial(
  prefixo: string,
  matriculas: ReadonlyArray<string | null | undefined>,
): number {
  const padrao = new RegExp(`^${prefixo}-\\d{4}-(\\d+)$`);
  let maior = 0;
  for (const matricula of matriculas) {
    const n = Number(padrao.exec(matricula ?? '')?.[1]);
    if (Number.isSafeInteger(n) && n > maior) maior = n;
  }
  return maior + 1;
}

/** Mascara CPF: 123.456.789-00 -> ***.456.789-** */
export function mascararCpf(cpf?: string | null): string {
  if (!cpf) return '';
  const digitos = cpf.replace(/\D/g, '').padStart(11, '0');
  return `***.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-**`;
}
