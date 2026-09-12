import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PANORAMA = readFileSync(join(__dirname, 'page.tsx'), 'utf8');
const PROCESSOS = readFileSync(join(__dirname, '../processos/page.tsx'), 'utf8');

/**
 * NÚMERO QUE MUDA QUANDO SE CLICA NELE — medido em 12/09/2026.
 *
 * "De que lado estamos" contava todos os status numa tela que fala em "149
 * processos ativos": os três cartões somavam 184, e "31 representando" abria
 * uma lista de 27. Os cartões de réu e de pedido tinham o mesmo furo — contam o
 * acervo ativo e abriam a lista com os encerrados junto. O link passou a levar
 * o recorte que o número contou.
 */
describe('os links do Panorama levam o recorte que contaram', () => {
  it('de que lado estamos', () => {
    for (const papel of ['AUTOR', 'REPRESENTANDO', 'REU']) {
      expect(PANORAMA).toContain(`href="/processos?nossoPapel=${papel}&status=ATIVO"`);
    }
  });

  it('o mesmo réu e o mesmo pedido', () => {
    expect(PANORAMA).toContain(
      'href={`/processos?parteExternaId=${c.parteExternaId}&status=ATIVO`}',
    );
    expect(PANORAMA).toContain(
      'href={`/processos?assunto=${encodeURIComponent(d.assunto)}&status=ATIVO`}',
    );
  });

  /** Link velho ou colado à mão não pode abrir tela vazia. */
  it('a lista de processos entende o status da URL e ignora o que não existe', () => {
    expect(PROCESSOS).toMatch(/useFiltroPorUrl\(\s*'status',/);
    expect(PROCESSOS).toContain('if ((STATUS_PROCESSO_ORDEM as string[]).includes(v)) {');
  });
});
