import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import { parteContrariaDoProcesso } from './identidade-do-processo';
import type { ProcessoRef } from '@/lib/agenda';

const proc = (partes: ProcessoRef['partes'], extra: Partial<ProcessoRef> = {}): ProcessoRef => ({
  id: 'p1',
  numeroCNJ: '00010002620225220002',
  partes,
  ...extra,
});

/**
 * QUEM É A PARTE CONTRÁRIA — a metade que identifica o caso.
 *
 * Nosso lado é previsível: ou é o sindicato (ação institucional), ou é o
 * filiado, que o cartão já mostra numa linha própria. O que muda de processo
 * para processo, e portanto o que distingue dois cartões de mesmo título, é
 * contra quem se litiga.
 */
describe('parte contrária', () => {
  it('é a primeira PASSIVO — a ordenação do back garante que é a principal', () => {
    const p = proc([
      { nome: 'SENATEPI', polo: 'ATIVO' },
      { nome: 'Município de Agricolândia', polo: 'PASSIVO' },
      { nome: 'Estado do Piauí', polo: 'PASSIVO' },
    ]);
    expect(parteContrariaDoProcesso(p)).toBe('Município de Agricolândia');
  });

  it('ignora terceiros — não é contra eles que se litiga', () => {
    const p = proc([
      { nome: 'Maria da Silva', polo: 'ATIVO' },
      { nome: 'Ministério Público', polo: 'TERCEIRO' },
      { nome: 'Hospital Getúlio Vargas', polo: 'PASSIVO' },
    ]);
    expect(parteContrariaDoProcesso(p)).toBe('Hospital Getúlio Vargas');
  });

  /**
   * O caso pré-processual não tem partes cadastradas e nem NPU; o rótulo do
   * caso é tudo que existe, e ainda diz mais do que nada.
   */
  it('sem réu, cai no rótulo do caso', () => {
    const p = proc([{ nome: 'SENATEPI', polo: 'ATIVO' }], { titulo: 'Reajuste da categoria' });
    expect(parteContrariaDoProcesso(p)).toBe('Reajuste da categoria');
  });

  it('sem nada útil, devolve null para o chamador não desenhar separador solto', () => {
    expect(parteContrariaDoProcesso(proc([{ nome: 'SENATEPI', polo: 'ATIVO' }]))).toBeNull();
    expect(parteContrariaDoProcesso(proc([]))).toBeNull();
    expect(parteContrariaDoProcesso(null)).toBeNull();
    expect(parteContrariaDoProcesso(undefined)).toBeNull();
  });

  /**
   * O payload é opcional no tipo (nem toda tela manda partes). Sem esta
   * guarda, uma resposta antiga em cache derrubaria o cartão inteiro.
   */
  it('aguenta um processo sem o campo `partes`', () => {
    expect(parteContrariaDoProcesso({ id: 'p1', numeroCNJ: null })).toBeNull();
  });
});

/**
 * O DETALHE QUE FAZ A LINHA CABER NUM CELULAR.
 *
 * "SINDICATO DOS ENFERMEIROS E TÉCNICOS DE ENFERMAGEM DO ESTADO DO PIAUÍ ×
 * Município de Agricolândia" não cabe em 300px. Com um `truncate` comum, o que
 * some é o FIM — exatamente o réu, a única metade que diferencia um cartão do
 * outro. O autor tem de ceder o espaço, não o réu.
 */
describe('a truncagem come a parte previsível', () => {
  const FONTE = readFileSync(
    path.join(__dirname, 'identidade-do-processo.tsx'),
    'utf8',
  );

  it('o autor encolhe (`min-w-0 truncate`)', () => {
    const bloco = FONTE.slice(FONTE.indexOf('O autor cede espaço'));
    expect(bloco.slice(0, 400)).toContain('min-w-0 truncate');
  });

  it('o réu não encolhe (`shrink-0`) e tem teto de largura', () => {
    const bloco = FONTE.slice(FONTE.indexOf('O RÉU É O QUE DIFERENCIA'));
    expect(bloco.slice(0, 500)).toContain('shrink-0');
    // Sem teto, um réu de nome quilométrico esmagaria o autor até sobrar nada.
    expect(bloco.slice(0, 500)).toMatch(/max-w-\[\d+%\]/);
  });
});
