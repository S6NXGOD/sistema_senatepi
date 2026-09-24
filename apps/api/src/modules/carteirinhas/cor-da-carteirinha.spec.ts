import { COR_RESERVA, coresDaCarteirinha, paraRgb, tomClaro } from './cor-da-carteirinha.util';
import { TENANTS } from '../../tenant/tenant.config';

/**
 * "ESSE É O VISUAL PARA O SENATEPI E O VISUAL DOS OUTROS TENANTS, COMO FARIA?"
 * — o dono, 24/09/2026.
 *
 * Não havia visual dos outros. A carteirinha cravava no código o verde
 * `#1B7F0A` e duas linhas com o nome do sindicato dos enfermeiros — a
 * carteirinha do SINDSERM sairia verde, com o nome errado. O dado para
 * consertar já existia em `tenant.config` desde sempre.
 */

describe('a cor da carteirinha sai do tenant', () => {
  it('reconhece hex de seis dígitos, com ou sem #', () => {
    expect(paraRgb('#1B7F0A')).toEqual([27, 127, 10]);
    expect(paraRgb('1b7f0a')).toEqual([27, 127, 10]);
  });

  it('e recusa o resto em vez de inventar uma cor', () => {
    for (const lixo of ['', '  ', 'verde', '#FFF', '#12345', null, undefined]) {
      expect(paraRgb(lixo)).toBeNull();
    }
  });

  /**
   * A DERIVAÇÃO FICA NA FAMÍLIA DA COR. O par que estava cravado à mão era
   * `#1B7F0A` + `#4FA11B` — o claro é o mesmo verde, mais luminoso, e continua
   * SATURADO. Por isso o passo é em HSL: misturar branco daria `#6bac60`, um
   * verde lavado que não se parece com o desenho aprovado.
   */
  it('o tom claro do verde do SENATEPI continua verde, e mais claro', () => {
    expect(tomClaro('#1B7F0A')).toBe('#27b80e');
  });

  it('e o do azul do SINDSERM acompanha, sem ninguém configurar nada', () => {
    expect(tomClaro('#0F4C81')).toBe('#156cb8');
  });

  /** O matiz não pode escorregar: claro de verde é verde, de azul é azul. */
  it('o tom claro preserva o matiz', () => {
    const matiz = (hex: string) => {
      const [r, g, b] = paraRgb(hex)!.map((c) => c / 255);
      const max = Math.max(r, g, b); const min = Math.min(r, g, b); const d = max - min;
      if (!d) return 0;
      const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return Math.round(h * 60);
    };
    for (const cor of ['#1B7F0A', '#0F4C81', '#800020']) {
      expect(Math.abs(matiz(tomClaro(cor)!) - matiz(cor))).toBeLessThanOrEqual(2);
    }
  });

  it('o tom claro é sempre mais claro que a cor de origem', () => {
    for (const cor of ['#1B7F0A', '#0F4C81', '#000000', '#800020']) {
      const [r, g, b] = paraRgb(cor)!;
      const [cr, cg, cb] = paraRgb(tomClaro(cor))!;
      expect(cr + cg + cb).toBeGreaterThan(r + g + b);
    }
  });

  /**
   * SEM COR DECLARADA, GRAFITE — nunca o verde de outro sindicato, que é
   * exatamente o defeito que este arquivo existe para não repetir.
   */
  it('cliente sem cor cai no grafite, não na cor de outro', () => {
    for (const lixo of [null, 'roxo', '']) {
      const c = coresDaCarteirinha(lixo);
      expect(c.forte).toBe(COR_RESERVA);
      // O tom claro é o grafite clareado — o cartão continua tendo dois níveis.
      expect(c.clara).not.toBe(COR_RESERVA);
      expect(paraRgb(c.clara)).not.toBeNull();
    }
  });
});

/**
 * E O QUE TORNA ISTO VERDADE PARA SEMPRE: todo cliente do registro precisa ter
 * as duas coisas que a carteirinha lê. Um sindicato novo que entre sem `nome`
 * ou sem `corInstitucional` reprova aqui, e não no PDF de alguém.
 */
describe('todo cliente tem o que a carteirinha precisa', () => {
  it.each(Object.keys(TENANTS))('%s declara nome, nomeCurto, sigla e cor', (id) => {
    const t = TENANTS[id];
    expect(t.nome.trim().length).toBeGreaterThan(10);
    expect(t.nomeCurto.trim().length).toBeGreaterThan(5);
    expect(t.sigla.trim()).toBeTruthy();
    expect(paraRgb(t.corInstitucional)).not.toBeNull();
  });

  /** E o nome curto cabe nas duas linhas do cabeçalho do cartão. */
  it.each(Object.keys(TENANTS))('%s tem nome curto que cabe no cabeçalho', (id) => {
    expect(TENANTS[id].nomeCurto.length).toBeLessThanOrEqual(60);
  });
});
