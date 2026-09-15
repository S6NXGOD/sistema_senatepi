import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * PARCELA CANCELADA NO DOSSIÊ: neutra, sem riscado (15/09/2026).
 *
 * A regra de sempre: cancelamento nunca em vermelho nem riscado. O dossiê
 * riscava a parcela cancelada, e quem conferia não lia o valor. O mapa de cores
 * é constante interna do componente; o teste lê só o objeto `PARCELA_COR`,
 * sem os comentários, para não bater em texto explicativo.
 */
const FONTE = readFileSync(join(__dirname, 'dossie-drawer.tsx'), 'utf8').replace(/\r\n/g, '\n');

function mapaDeCores(): Record<string, string> {
  const inicio = FONTE.indexOf('const PARCELA_COR: Record<string, string> = {');
  const fim = FONTE.indexOf('};', inicio);
  expect(inicio).toBeGreaterThan(-1);
  const corpo = FONTE.slice(inicio, fim)
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'));
  const mapa: Record<string, string> = {};
  for (const linha of corpo) {
    const m = /^\s*([A-Z_]+):\s*'([^']*)',?\s*$/.exec(linha);
    if (m) mapa[m[1]] = m[2];
  }
  return mapa;
}

describe('cores das parcelas no dossiê', () => {
  it('cancelada é neutra: sem riscado e sem vermelho', () => {
    const cancelada = mapaDeCores().CANCELADO;
    expect(cancelada).toBe('bg-muted text-muted-foreground');
    expect(cancelada).not.toMatch(/line-through|red-|rose-/);
  });

  it('o mapa continua com as quatro situações', () => {
    expect(Object.keys(mapaDeCores()).sort()).toEqual(['CANCELADO', 'PAGO', 'PENDENTE', 'VENCIDO']);
  });
});
