import {
  CONTRASTE_AA, TONS_COM_TEXTO_BRANCO, contraste, derivarPaleta, hexParaRgb,
  legivelComBranco, paletaParaCanaisCss, rgbParaHex,
} from './paleta';

describe('leitura de cor', () => {
  it('aceita as três formas que uma pessoa digita', () => {
    expect(hexParaRgb('#1B7F0A')).toEqual([27, 127, 10]);
    expect(hexParaRgb('1B7F0A')).toEqual([27, 127, 10]);
    expect(hexParaRgb('  #1b7f0a  ')).toEqual([27, 127, 10]);
  });

  it('expande a forma curta', () => {
    expect(hexParaRgb('#0F0')).toEqual([0, 255, 0]);
  });

  it('recusa o que não é cor', () => {
    expect(hexParaRgb('')).toBeNull();
    expect(hexParaRgb('azul')).toBeNull();
    expect(hexParaRgb('#12345')).toBeNull();
    expect(hexParaRgb('#GGGGGG')).toBeNull();
  });

  it('vai e volta sem perder o valor', () => {
    expect(rgbParaHex(27, 127, 10)).toBe('#1B7F0A');
  });
});

describe('contraste', () => {
  it('reproduz os extremos conhecidos da WCAG', () => {
    expect(contraste('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
    expect(contraste('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
  });

  it('reprova texto branco sobre amarelo — o caso que motiva a derivação', () => {
    expect(legivelComBranco('#FFE600')).toBe(false);
  });
});

describe('derivarPaleta', () => {
  it('devolve os dez degraus, sem faltar nenhum', () => {
    const p = derivarPaleta('#1B7F0A')!;
    expect(Object.keys(p).sort((a, b) => Number(a) - Number(b)))
      .toEqual(['50', '100', '200', '300', '400', '500', '600', '700', '800', '900']);
  });

  /**
   * O degrau faltante era um bug real: o Tailwind não emite classe para tom
   * inexistente, e `bg-brand-700 text-white` virava branco no branco.
   */
  it('todo degrau é uma cor válida', () => {
    const p = derivarPaleta('#0F4C81')!;
    for (const hex of Object.values(p)) expect(hexParaRgb(hex)).not.toBeNull();
  });

  it('vai do claro ao escuro, sem inverter no meio', () => {
    const p = derivarPaleta('#0F4C81')!;
    const luz = (hex: string) => {
      const [r, g, b] = hexParaRgb(hex)!;
      return r + g + b;
    };
    const tons = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
    for (let i = 1; i < tons.length; i++) {
      expect(luz(p[String(tons[i])])).toBeLessThan(luz(p[String(tons[i - 1])]));
    }
  });

  /** É a promessa que o recurso faz a quem escolhe a cor. */
  it.each([
    ['verde institucional', '#1B7F0A'],
    ['azul institucional', '#0F4C81'],
    ['amarelo berrante', '#FFE600'],
    ['lima clara', '#B6FF00'],
    ['rosa claro', '#FFC0CB'],
    ['branco', '#FFFFFF'],
    ['vermelho', '#E10600'],
  ])('%s: os tons de fundo sólido passam em AA com texto branco', (_nome, cor) => {
    const p = derivarPaleta(cor)!;
    for (const tom of TONS_COM_TEXTO_BRANCO) {
      expect(contraste(p[String(tom)], '#FFFFFF')).toBeGreaterThanOrEqual(CONTRASTE_AA);
    }
  });

  it('preserva a matiz — é ela que identifica a marca', () => {
    const p = derivarPaleta('#0F4C81')!;
    const [r, g, b] = hexParaRgb(p['600'])!;
    expect(b).toBeGreaterThan(r); // continua azul
    expect(b).toBeGreaterThan(g);
  });

  it('cinza continua cinza, sem inventar matiz', () => {
    const p = derivarPaleta('#808080')!;
    const [r, g, b] = hexParaRgb(p['500'])!;
    expect(Math.abs(r - g)).toBeLessThanOrEqual(1);
    expect(Math.abs(g - b)).toBeLessThanOrEqual(1);
  });

  it('devolve nulo quando não é cor', () => {
    expect(derivarPaleta('roxo')).toBeNull();
    expect(derivarPaleta('')).toBeNull();
  });
});

describe('paletaParaCanaisCss', () => {
  /**
   * Canais separados por espaço, e não hexadecimal: é o que permite ao Tailwind
   * compor opacidade. Com `#1B7F0A` dentro da variável, `bg-brand-900/30` — que
   * existe no código — quebraria.
   */
  it('devolve canais separados por espaço', () => {
    expect(paletaParaCanaisCss({ 800: '#1B7F0A' })).toEqual({ '--brand-800': '27 127 10' });
  });

  it('ignora valor inválido em vez de gerar CSS quebrado', () => {
    expect(paletaParaCanaisCss({ 800: 'azul' })).toEqual({});
  });
});
