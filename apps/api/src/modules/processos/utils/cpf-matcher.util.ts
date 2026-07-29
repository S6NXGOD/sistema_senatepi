/**
 * CpfMatcherUtils — desmascaramento inteligente de CPF das partes do DATAJUD.
 *
 * O DATAJUD devolve o CPF das partes com máscara de privacidade
 * (ex.: `***.123.456-**`), ocultando parte dos dígitos. Quando o processo está
 * vinculado a um Filiado do nosso sistema, comparamos o trecho VISÍVEL da máscara
 * com o CPF real desse filiado: havendo "match perfeito" (todos os dígitos
 * visíveis coincidem), sabemos que aquela parte é o próprio filiado e podemos
 * exibir o CPF completo — informação que já possuímos internamente.
 *
 * LGPD (Lei nº 13.709/2018 — Diário Oficial da União): o desmascaramento usa
 * EXCLUSIVAMENTE o CPF do próprio filiado vinculado (titular já conhecido do
 * sindicato), com finalidade legítima de representação/defesa jurídica
 * (art. 7º). Jamais inferimos ou completamos CPFs de terceiros: partes que não
 * casam com o CPF do filiado permanecem mascaradas exatamente como vieram.
 */

export interface ParteComDocumento {
  nome?: string | null;
  documento?: string | null;
}

export class CpfMatcherUtils {
  /** Extrai apenas os dígitos de um CPF. */
  private static digitos(valor?: string | null): string {
    return (valor || '').replace(/\D/g, '');
  }

  /**
   * Normaliza uma máscara de CPF preservando a POSIÇÃO dos dígitos visíveis e
   * marcando os ocultos com `*`. Remove pontuação de formatação.
   * Ex.: `"***.123.456-**"` → `"***123456**"` (11 posições).
   */
  static normalizarMascara(mascara?: string | null): string {
    return (mascara || '')
      .trim()
      .replace(/[.\-/\s]/g, '') // remove separadores de formatação
      .replace(/[xX•#]/g, '*'); // aceita outros marcadores de oculto
  }

  /**
   * Verifica se um CPF real "encaixa" perfeitamente na máscara do DATAJUD.
   * Compara posição a posição: cada dígito VISÍVEL da máscara precisa coincidir
   * com o dígito do CPF real na mesma posição. Exige um mínimo de dígitos
   * visíveis para evitar falso-positivo com máscaras muito abertas.
   */
  static confere(mascara: string | null | undefined, cpfReal: string | null | undefined): boolean {
    const m = this.normalizarMascara(mascara);
    const real = this.digitos(cpfReal);
    if (real.length !== 11 || m.length !== 11) return false;

    let visiveis = 0;
    for (let i = 0; i < 11; i++) {
      const c = m[i];
      if (c === '*') continue; // dígito oculto: não compara
      if (c < '0' || c > '9') return false; // caractere inesperado na máscara
      if (c !== real[i]) return false; // dígito visível diverge → não é a mesma pessoa
      visiveis++;
    }
    // Confiança mínima: pelo menos 4 dígitos visíveis coincidindo.
    return visiveis >= 4;
  }

  /** Formata 11 dígitos como CPF (`000.000.000-00`). */
  static formatar(cpf: string | null | undefined): string | null {
    const d = this.digitos(cpf);
    if (d.length !== 11) return null;
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9, 11)}`;
  }

  /**
   * Desmascara: se a máscara corresponde ao CPF real (match perfeito), devolve o
   * CPF completo formatado. Caso contrário, devolve `null` (identidade não
   * confirmada — mantenha o valor mascarado original).
   */
  static desmascarar(
    mascara: string | null | undefined,
    cpfReal: string | null | undefined,
  ): string | null {
    if (!this.confere(mascara, cpfReal)) return null;
    return this.formatar(cpfReal);
  }

  /**
   * Aplica o desmascaramento na lista de partes retornada do DATAJUD usando o CPF
   * do filiado vinculado ao processo. Apenas a parte cujo documento mascarado
   * casar com o CPF do filiado é desmascarada (`documentoDesmascarado: true`);
   * as demais partes permanecem intactas.
   */
  static aplicar<T extends ParteComDocumento>(
    partes: T[],
    cpfFiliado: string | null | undefined,
  ): Array<T & { documentoDesmascarado?: boolean }> {
    const real = this.digitos(cpfFiliado);
    if (!Array.isArray(partes) || real.length !== 11) {
      return (Array.isArray(partes) ? partes : []) as Array<T & { documentoDesmascarado?: boolean }>;
    }
    return partes.map((p) => {
      const completo = this.desmascarar(p?.documento, real);
      return completo ? { ...p, documento: completo, documentoDesmascarado: true } : p;
    });
  }
}
