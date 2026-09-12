import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const TELA = readFileSync(join(__dirname, 'page.tsx'), 'utf8');
const LIB = readFileSync(join(__dirname, '../../../lib/djen.ts'), 'utf8');

/**
 * "18 EM 7 DIAS · VER TODAS" ABRIA AS 2.066 PUBLICAÇÕES — medido em 12/09/2026.
 *
 * A tela não tinha filtro de data e não lia a URL: todo atalho de outra tela
 * caía no acervo inteiro. E "sem tarefa" não era fila — juntava o que o robô
 * dispensou com motivo e o que ninguém decidiu.
 */
describe('publicações por período e pela fila de decisão', () => {
  it('lê ?dias= e ?situacao= da URL, dentro de um Suspense', () => {
    expect(TELA).toMatch(/useFiltroPorUrl\(\s*'dias',/);
    expect(TELA).toMatch(/useFiltroPorUrl\(\s*'situacao',/);
    expect(TELA).toContain('<Suspense');
    expect(TELA).toContain('<Publicacoes />');
  });

  /** Link velho ou colado à mão não pode filtrar por um valor que não existe. */
  it('ignora valor desconhecido vindo da URL', () => {
    expect(TELA).toContain('if (JANELAS.some((j) => String(j.dias) === v)) {');
    expect(TELA).toContain('if (v in SITUACAO_LABEL) {');
  });

  /** Filtro que não vira ficha é filtro que ninguém sabe que aplicou. */
  it('a data é filtro, ficha removível e parte da consulta', () => {
    expect(TELA).toContain('aria-label="Filtrar por data"');
    expect(TELA).toContain("chave: 'dias',");
    expect(TELA).toContain('dias: dias ? Number(dias) : undefined,');
    expect(TELA).toContain(
      '[busca, providencia, tribunal, situacao, onde, soMeus, citaAdvogado, dias, pagina]',
    );
    expect(TELA).toContain("setDias('');");
    expect(LIB).toContain('dias?: number;');
  });

  it('a fila de decisão é uma opção própria', () => {
    expect(TELA).toContain('<option value="SEM_DECISAO">Esperando decisão</option>');
    expect(LIB).toContain("situacao?: 'COM_TAREFA' | 'SEM_TAREFA' | 'SEM_DECISAO';");
  });
});
