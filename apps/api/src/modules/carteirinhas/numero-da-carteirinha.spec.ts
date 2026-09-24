import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { proximoSequencial } from '@core/infra';

/** O fonte sem comentários — negativa mira CÓDIGO, nunca a prosa que explica. */
const semComentario = (rel: string) =>
  readFileSync(join(__dirname, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * "EMITIR CARTEIRINHA TAMBÉM NÃO ACONTECE NADA." — o dono, 24/09/2026.
 *
 * Acontecia **HTTP 500**, e o log dizia
 * `Unique constraint failed on the fields: (numero)`.
 *
 * MEDIDO NA PRODUÇÃO:
 *
 *   carteirinhas emitidas ..... 5.654
 *   maior número .............. CART-2026-007166
 *   o que o código tentava .... CART-2026-005655   ← já existia
 *
 * A carga de 03/07/2026 numerou pela MATRÍCULA, com buracos, então a contagem
 * ficou 1.512 números atrás do maior. E o defeito **nunca se corrige sozinho**:
 * o `create` falha, nada é gravado, o `count()` não muda e a tentativa seguinte
 * colide igual. Emitir carteirinha estava quebrado para os 173 ativos sem uma.
 *
 * É LETRA POR LETRA O INCIDENTE DA MATRÍCULA DE 14/08/2026 — o mesmo
 * `count() + 1`, o mesmo "depois de errar nunca mais acerta", um dia de
 * cadastro parado. A regra correta já existia e tinha teste; faltava ser usada.
 */
describe('o número da carteirinha segue a MAIOR já emitida', () => {
  it('a carga com buracos não engana o contador', () => {
    // O caso real: 5.654 registros, o maior é o 7166.
    const emitidas = ['CART-2026-000001', 'CART-2026-005655', 'CART-2026-007166'];
    expect(proximoSequencial('CART', emitidas)).toBe(7167);
  });

  it('e uma exclusão não faz a numeração andar para trás', () => {
    expect(proximoSequencial('CART', ['CART-2026-000001', 'CART-2026-000003'])).toBe(4);
  });

  /** Número fora do padrão (carga legada) não pode saltar a sequência. */
  it('ignora número fora do padrão', () => {
    expect(proximoSequencial('CART', ['CART-antigo-9999', 'CART-2026-000002', null])).toBe(3);
  });

  it('cadastro vazio começa no 1', () => {
    expect(proximoSequencial('CART', [])).toBe(1);
  });
});

/**
 * OS IRMÃOS, CONTADOS. Consertar só o `emitir` deixaria o importador quebrando
 * do mesmo jeito — ele também partia de `count()`, e para o número da
 * carteirinha nem tinha o `do/while` que salvava a matrícula.
 */
describe('nenhum gerador de número volta a contar linhas', () => {
  it.each([
    ['carteirinhas.module.ts', '../carteirinhas/carteirinhas.module.ts'],
    ['importacao.service.ts', '../importacao/importacao.service.ts'],
    ['filiados.service.ts', '../filiados/filiados.service.ts'],
  ])('%s usa proximoSequencial, e não count()', (_nome, rel) => {
    const fonte = semComentario(rel);
    expect(fonte).toContain('proximoSequencial(');
    expect(fonte).not.toMatch(/carteirinha\.count\(\)/);
    expect(fonte).not.toMatch(/filiado\.count\(\)\s*;/);
  });

  /** E a emissão reage à corrida em vez de devolver 500 na cara de quem clicou. */
  it('emitir recalcula o número quando dois clicam junto', () => {
    const fonte = semComentario('./carteirinhas.module.ts');
    expect(fonte).toContain('comNumeroLivre');
    expect(fonte).toContain('TENTATIVAS_NUMERO');
    expect(fonte).toContain('ConflictException');
  });
});
