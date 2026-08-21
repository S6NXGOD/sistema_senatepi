import { AREAS_JURIDICAS, categoriaValida, normalizarCategoria } from './areas.catalogo';

/**
 * A categoria é texto no banco, como as etiquetas eram. O que a separa delas é
 * ESTA validação — sem ela, o campo repetiria o defeito de "Urgente", que
 * conviveu em quatro grafias e não filtrava nada.
 */
describe('categoria (área jurídica)', () => {
  it('vazio é válido — a categoria é opcional', () => {
    expect(normalizarCategoria(undefined)).toBeNull();
    expect(normalizarCategoria('')).toBeNull();
    expect(normalizarCategoria('   ')).toBeNull();
  });

  it('aceita o slug exato', () => {
    expect(normalizarCategoria('TRABALHISTA')).toBe('TRABALHISTA');
  });

  /** A tela manda o slug, mas quem chega por API digita como fala. */
  it.each([
    ['trabalhista', 'TRABALHISTA'],
    ['Previdenciario', 'PREVIDENCIARIO'],
    ['etico disciplinar', 'ETICO_DISCIPLINAR'],
    ['sindical-coletivo', 'SINDICAL_COLETIVO'],
  ])('normaliza "%s" para %s', (entrada, esperado) => {
    expect(normalizarCategoria(entrada)).toBe(esperado);
  });

  /**
   * FALHA EM VEZ DE ACEITAR — é o ponto todo. Aceitar em silêncio é como a
   * etiqueta virou quatro. A mensagem traz as opções porque quem chega por API
   * não tem a lista da tela.
   */
  it('recusa o que não existe, dizendo o que existe', () => {
    expect(() => normalizarCategoria('Tributário')).toThrow(/não existe/i);
    expect(() => normalizarCategoria('Tributário')).toThrow(/TRABALHISTA/);
  });

  it('categoriaValida aceita nulo e os slugs do catálogo', () => {
    expect(categoriaValida(null)).toBe(true);
    expect(categoriaValida('CIVEL')).toBe(true);
    expect(categoriaValida('INVENTADA')).toBe(false);
  });

  it('todo slug é MAIÚSCULO_COM_UNDERLINE — é o que a normalização produz', () => {
    for (const a of AREAS_JURIDICAS) expect(a.slug).toMatch(/^[A-Z]+(_[A-Z]+)*$/);
  });

  it('não há slug repetido', () => {
    const slugs = AREAS_JURIDICAS.map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  /** A cor alimenta o selo na tela; sem ela o chip sai sem estilo. */
  it('toda área tem nome, cor e ajuda preenchidos', () => {
    for (const a of AREAS_JURIDICAS) {
      expect(a.nome.trim().length).toBeGreaterThan(0);
      expect(a.cor.trim().length).toBeGreaterThan(0);
      expect(a.ajuda.trim().length).toBeGreaterThan(0);
    }
  });
});
