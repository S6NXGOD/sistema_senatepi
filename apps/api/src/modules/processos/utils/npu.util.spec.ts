import { NpuUtils } from './npu.util';

/**
 * O tribunal superior mora num ÍNDICE SEPARADO do DataJud, com o mesmo NPU.
 * Sem esta derivação, o recurso ao TST não existe para o sistema — foi o que
 * fez o 0001000-26.2022.5.22.0002 mostrar "2 instâncias" havendo três.
 */
describe('NpuUtils.tribunalSuperior', () => {
  it('processo do TRT sobe ao TST', () => {
    // 0001000-26.2022.5.22.0002 — o caso real que revelou a falta.
    expect(NpuUtils.tribunalSuperior('00010002620225220002')).toBe('TST');
  });

  it('processo que JÁ está no TST (TR=00) não sobe mais', () => {
    expect(NpuUtils.tribunalSuperior('00010002620225000002')).toBeNull();
  });

  it('processo estadual sobe ao STJ', () => {
    // 0831236-24.2023.8.18.0140 (TJPI).
    expect(NpuUtils.tribunalSuperior('08312362420238180140')).toBe('STJ');
  });

  it('processo federal sobe ao STJ', () => {
    expect(NpuUtils.tribunalSuperior('00012345620234013300')).toBe('STJ');
  });

  /**
   * O STF fica de fora porque NÃO HÁ ÍNDICE: `api_publica_stf` responde
   * `index_not_found_exception` (conferido em 07/08/2026). Não é omissão nossa
   * — o CNJ não publica.
   */
  it('não inventa STF nem outros segmentos sem índice', () => {
    expect(NpuUtils.tribunalSuperior('00012345620236160001')).toBeNull(); // eleitoral
    expect(NpuUtils.tribunalSuperior('00012345620237000001')).toBeNull(); // militar da União
  });

  it('NPU inválido devolve null em vez de chutar', () => {
    expect(NpuUtils.tribunalSuperior('123')).toBeNull();
    expect(NpuUtils.tribunalSuperior('')).toBeNull();
  });

  it('aceita NPU com máscara', () => {
    expect(NpuUtils.tribunalSuperior('0001000-26.2022.5.22.0002')).toBe('TST');
  });
});
