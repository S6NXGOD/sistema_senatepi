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

/**
 * O NPU DENTRO DE TEXTO GRAVADO.
 *
 * A formatação só existia no front, e as atividades que o robô cria carregam o
 * número dentro da DESCRIÇÃO — texto puro, que não passa por componente
 * nenhum. O advogado lia "Processo 00013414120255220004" na agenda: impossível
 * de conferir de bater o olho, impossível de comparar com a capa dos autos, e
 * nem dá para colar no PJe sem editar antes.
 */
describe('NpuUtils.formatar', () => {
  it('aplica a máscara do CNJ', () => {
    expect(NpuUtils.formatar('00013414120255220004')).toBe('0001341-41.2025.5.22.0004');
  });

  it('é idempotente — NPU já mascarado sai igual', () => {
    expect(NpuUtils.formatar('0001341-41.2025.5.22.0004')).toBe('0001341-41.2025.5.22.0004');
  });

  /**
   * Texto de tarefa NUNCA pode virar `undefined` por causa de um número fora do
   * padrão: a descrição é o que explica ao advogado o que fazer.
   */
  it('devolve a entrada intacta quando não são 20 dígitos', () => {
    expect(NpuUtils.formatar('123')).toBe('123');
    expect(NpuUtils.formatar('processo administrativo')).toBe('processo administrativo');
  });

  it('vira string vazia quando não há número — o chamador usa `|| "(rascunho)"`', () => {
    expect(NpuUtils.formatar(null)).toBe('');
    expect(NpuUtils.formatar(undefined)).toBe('');
    expect(NpuUtils.formatar('')).toBe('');
  });
});
