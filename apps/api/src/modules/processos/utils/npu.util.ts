/**
 * NpuUtils — utilitários do Número Único de Processo (NPU/CNJ).
 *
 * Padrão CNJ (Resolução nº 65/2008): `NNNNNNN-DD.AAAA.J.TR.OOOO` — 20 dígitos.
 *   - 7 dígitos: sequencial
 *   - 2 dígitos: dígito verificador
 *   - 4 dígitos: ano de ajuizamento
 *   - 1 dígito : J  → segmento do Judiciário
 *   - 2 dígitos: TR → tribunal
 *   - 4 dígitos: OOOO → unidade de origem
 *
 * Permite DERIVAR a sigla do tribunal a partir do próprio NPU, evitando exigir a
 * sigla no payload de importação (o índice do DATAJUD é por tribunal).
 */
export class NpuUtils {
  /** Apenas os dígitos do NPU. */
  static digitos(npu: string): string {
    return (npu || '').replace(/\D/g, '');
  }

  /** Valida se o NPU tem os 20 dígitos do padrão CNJ. */
  static valido(npu: string): boolean {
    return this.digitos(npu).length === 20;
  }

  /** Justiça Estadual (J=8): código TR → UF (usado na sigla TJ<UF>). */
  private static readonly UF_ESTADUAL: Record<string, string> = {
    '01': 'AC', '02': 'AL', '03': 'AP', '04': 'AM', '05': 'BA', '06': 'CE',
    '07': 'DFT', '08': 'ES', '09': 'GO', '10': 'MA', '11': 'MT', '12': 'MS',
    '13': 'MG', '14': 'PA', '15': 'PB', '16': 'PR', '17': 'PE', '18': 'PI',
    '19': 'RJ', '20': 'RN', '21': 'RS', '22': 'RO', '23': 'RR', '24': 'SC',
    '25': 'SE', '26': 'SP', '27': 'TO',
  };

  /**
   * Deriva a sigla do tribunal a partir do NPU (dígitos J e TR).
   * Retorna `null` quando não é possível inferir com segurança — nesses casos o
   * chamador deve exigir a sigla explicitamente.
   */
  static siglaTribunal(npu: string): string | null {
    const d = this.digitos(npu);
    if (d.length !== 20) return null;

    const j = d[13]; // segmento do Judiciário
    const tr = d.slice(14, 16); // tribunal
    const trNum = Number.parseInt(tr, 10);

    switch (j) {
      case '3': // Superior Tribunal de Justiça
        return 'STJ';
      case '4': // Justiça Federal → TRF1..TRF6
        return trNum >= 1 && trNum <= 6 ? `TRF${trNum}` : null;
      case '5': // Justiça do Trabalho → TST (00) ou TRT1..TRT24
        return tr === '00' ? 'TST' : trNum >= 1 && trNum <= 24 ? `TRT${trNum}` : null;
      case '7': // Justiça Militar da União
        return 'STM';
      case '8': { // Justiça Estadual → TJ<UF>
        const uf = this.UF_ESTADUAL[tr];
        return uf ? `TJ${uf}` : null;
      }
      default:
        // STF, Justiça Eleitoral e Justiça Militar Estadual: exigir sigla explícita.
        return null;
    }
  }
}
