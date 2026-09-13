import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { senatepi } from '@/tenant/tenants/senatepi';
import { sindserm } from '@/tenant/tenants/sindserm';
import { QUANTIDADE_DE_TONS, corDasIniciais, hexParaRgb, iniciaisDe, indiceDaCor } from './iniciais';
import { corDaInstalacao } from './pdf-graficos';

/**
 * O MESMO ROSTO NA TELA E NO PAPEL — 13/09/2026.
 *
 * O PDF do uso passou a desenhar o cartão da pessoa com as iniciais quando não
 * há foto. A regra saiu de `avatar-pessoa.tsx` para uma função pura, lida pelos
 * dois: a mesma pessoa não pode ter uma cor na tela e outra no papel.
 */
describe('as iniciais e a cor da pessoa', () => {
  it('duas letras, sem o tratamento', () => {
    expect(iniciaisDe('Dra. Morgana Lima')).toBe('ML');
    expect(iniciaisDe('Dr. Matheus')).toBe('M');
    expect(iniciaisDe('  ana   paula souza ')).toBe('AP');
    expect(iniciaisDe('')).toBe('');
  });

  it('o tom é estável e cabe na paleta', () => {
    for (const nome of ['Ana', 'Dr. Bruno', 'Ivo', 'Conceição']) {
      const i = indiceDaCor(nome);
      expect(i).toBe(indiceDaCor(nome));
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(QUANTIDADE_DE_TONS);
    }
  });

  it('hex vira RGB; lixo vira null, nunca NaN', () => {
    expect(hexParaRgb('#1B7F0A')).toEqual([27, 127, 10]);
    expect(hexParaRgb('0F4C81')).toEqual([15, 76, 129]);
    expect(hexParaRgb('#abc')).toBeNull();
    expect(hexParaRgb(undefined)).toBeNull();
  });

  it('todo tom tem classe da tela e RGB do papel, sem NaN', () => {
    // Um nome por índice: procura até cobrir os sete tons.
    const vistos = new Map<number, ReturnType<typeof corDasIniciais>>();
    for (let k = 0; vistos.size < QUANTIDADE_DE_TONS && k < 500; k++) {
      const nome = `Pessoa ${k}`;
      vistos.set(indiceDaCor(nome), corDasIniciais(nome, sindserm.paleta));
    }
    expect(vistos.size).toBe(QUANTIDADE_DE_TONS);
    for (const cor of vistos.values()) {
      expect(cor.classe).toMatch(/^bg-[a-z]+-200 text-[a-z]+-900$/);
      expect([...cor.fundo, ...cor.texto].every((v) => Number.isInteger(v) && v >= 0 && v <= 255)).toBe(true);
    }
  });

  it('o primeiro tom é a cor da casa, lida da paleta de cada sindicato', () => {
    const nome = Array.from({ length: 200 }, (_, k) => `Nome ${k}`).find((x) => indiceDaCor(x) === 0)!;
    expect(corDasIniciais(nome, senatepi.paleta)).toEqual({
      classe: 'bg-brand-200 text-brand-900', fundo: [208, 226, 158], texto: [20, 94, 7],
    });
    expect(corDasIniciais(nome, sindserm.paleta).fundo).toEqual([191, 219, 240]);
  });

  /** A tela e o PDF leem a mesma função: uma segunda cópia da regra divergiria. */
  it('o avatar da tela usa a função, e não uma cópia', () => {
    const AVATAR = readFileSync(join(__dirname, '..', 'components/ui/avatar-pessoa.tsx'), 'utf8');
    expect(AVATAR).toContain("from '@/lib/iniciais'");
    expect(AVATAR).toContain('corDasIniciais(nome, tenant.paleta).classe');
    expect(AVATAR).not.toMatch(/function iniciaisDe\(/);
  });
});

/**
 * O PDF DO SINDSERM SAÍA VERDE — a cor estava cravada. Agora sai da paleta da
 * instalação; tom ausente cai no verde antigo, e nunca vira NaN.
 */
describe('a cor da instalação no papel', () => {
  it('SENATEPI continua com o verde de antes', () => {
    expect(corDaInstalacao(senatepi.paleta).principal).toEqual([27, 127, 10]);
  });

  it('SINDSERM sai no azul da casa', () => {
    const cores = corDaInstalacao(sindserm.paleta);
    expect(cores.principal).toEqual([15, 76, 129]);
    expect(cores.fundo).toEqual([240, 247, 252]);
    expect(cores.fundoForte).toEqual([221, 235, 248]);
  });

  it('paleta incompleta não quebra o documento', () => {
    const cores = corDaInstalacao({ '800': 'azul' });
    expect(Object.values(cores).flat().every((v) => Number.isFinite(v))).toBe(true);
    expect(cores.principal).toEqual([27, 127, 10]);
  });
});
