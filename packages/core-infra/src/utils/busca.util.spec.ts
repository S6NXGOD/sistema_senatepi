import { normalizarBusca, termosDeBusca } from './busca.util';

/**
 * A normalização existe em DUAS implementações: esta, em TypeScript, e
 * `senatepi_normalizar_busca()` no banco (migração
 * 20260802210000_busca_normalizada), usada pelo gatilho que preenche
 * `busca_normalizada`.
 *
 * Se as duas divergirem, a busca não encontra e NÃO dá erro — o pior tipo de
 * defeito. Estes casos são o contrato entre elas: o mesmo conjunto roda contra
 * o Postgres em `npm run test:busca-sql`.
 */
describe('normalizarBusca', () => {
  it('remove acentos do português', () => {
    expect(normalizarBusca('ANA CÉLIA SOUSA BRITO SALES')).toBe('ana celia sousa brito sales');
    expect(normalizarBusca('TAINARA VIANA DE ASSUNÇÃO')).toBe('tainara viana de assuncao');
    expect(normalizarBusca('JOÃO ÂNGELO MÜLLER')).toBe('joao angelo muller');
  });

  it('ignora a caixa', () => {
    expect(normalizarBusca('MiReLa')).toBe('mirela');
  });

  it('transforma pontuação em espaço, não em vazio', () => {
    // "sen2026000129" impediria achar pelo pedaço "000129".
    expect(normalizarBusca('SEN-2026-000129')).toBe('sen 2026 000129');
    expect(normalizarBusca('005.636.633-75')).toBe('005 636 633 75');
    expect(normalizarBusca("MARIA D'ÁVILA")).toBe('maria d avila');
  });

  it('colapsa espaços e apara as pontas', () => {
    expect(normalizarBusca('  mirela   jesus  ')).toBe('mirela jesus');
  });

  it('aceita nulo e vazio sem quebrar', () => {
    expect(normalizarBusca(null)).toBe('');
    expect(normalizarBusca(undefined)).toBe('');
    expect(normalizarBusca('   ')).toBe('');
    expect(normalizarBusca('!!!')).toBe('');
  });
});

describe('termosDeBusca', () => {
  it('quebra em palavras', () => {
    expect(termosDeBusca('mirela jesus')).toEqual(['mirela', 'jesus']);
  });

  it('não devolve termo vazio', () => {
    expect(termosDeBusca('   ')).toEqual([]);
    expect(termosDeBusca(null)).toEqual([]);
  });

  it('quebra o CPF mascarado em pedaços que casam com os dígitos guardados', () => {
    // A coluna guarda "00563663375"; cada pedaço está contido nela.
    const termos = termosDeBusca('005.636.633-75');
    expect(termos).toEqual(['005', '636', '633', '75']);
    expect(termos.every((t) => '00563663375'.includes(t))).toBe(true);
  });
});

describe('o caso que motivou a mudança', () => {
  const NOME = 'MIRELA CARVALHO DE JESUS';
  const guardado = normalizarBusca(`${NOME} SEN-2026-000129`);

  // Cada busca abaixo falhava antes: acento e ordem das palavras.
  it.each([
    ['mirela', 'trecho simples'],
    ['MIRELA', 'em maiúsculas'],
    ['Mire', 'pedaço da palavra'],
    ['mirela jesus', 'nome e sobrenome'],
    ['jesus mirela', 'ordem invertida'],
    ['000129', 'pedaço da matrícula'],
    ['  mirela  ', 'com espaços sobrando'],
  ])('encontra com "%s" (%s)', (digitado) => {
    const termos = termosDeBusca(digitado);
    expect(termos.length).toBeGreaterThan(0);
    expect(termos.every((t) => guardado.includes(t))).toBe(true);
  });
});
