import { readFileSync } from 'node:fs';
import * as path from 'node:path';

/**
 * AS ROTAS DA ESCALA, NA ORDEM EM QUE O NEST AS REGISTRA (14/09/2026).
 *
 * `GET /escalas/copia` e `GET /escalas/:id/consultas` convivem porque não
 * existe `GET /escalas/:id`. Se um dia alguém criar essa rota ANTES de
 * `copia`, "copia" vira um id e a prévia da cópia some sem erro nenhum — foi
 * assim que `vinculos-pendentes` ficou fora do ar (memória "rotas que
 * colidem"). O spec geral (`common/rotas-que-colidem.spec.ts`) pega a sombra
 * entre controllers; este trava a ordem dentro do da escala e a matriz como
 * única política: controller com `@Modulo` não tem `@Roles`.
 */
const semComentarios = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const fonte = semComentarios(readFileSync(path.join(__dirname, 'escalas.controller.ts'), 'utf8'));

const rotas = [...fonte.matchAll(/@(Get|Post|Patch|Delete)\((?:\s*'([^']*)'\s*)?\)/g)].map(
  (m) => `${m[1].toUpperCase()} /escalas${m[2] ? `/${m[2]}` : ''}`,
);

describe('rotas de /escalas', () => {
  it('são exatamente estas, nesta ordem', () => {
    expect(rotas).toEqual([
      'GET /escalas/advogados',
      'GET /escalas/plantao',
      'GET /escalas/copia',
      'GET /escalas',
      'GET /escalas/:id/consultas',
      'POST /escalas/copia',
      'POST /escalas',
      'PATCH /escalas/:id',
      'DELETE /escalas/:id',
    ]);
  });

  it('todo GET com literal vem antes do primeiro GET com parâmetro', () => {
    const gets = rotas.filter((r) => r.startsWith('GET '));
    const primeiroComParametro = gets.findIndex((r) => r.includes('/:'));
    const literaisDepois = gets.slice(primeiroComParametro).filter((r) => !r.includes('/:'));
    expect(literaisDepois).toEqual([]);
  });

  it('a matriz é a única política: @Modulo e nenhum @Roles', () => {
    expect(fonte).toMatch(/@Modulo\('escalas'\)/);
    expect(fonte).not.toMatch(/@Roles\(/);
  });

  it('o web chama as três rotas novas pelos caminhos declarados', () => {
    const web = readFileSync(path.resolve(__dirname, '../../../../web/src/lib/escalas.ts'), 'utf8');
    expect(web).toMatch(/api\.get\('\/escalas\/copia'/);
    expect(web).toMatch(/api\.post\('\/escalas\/copia'/);
    expect(web).toMatch(/api\.get\(`\/escalas\/\$\{escalaId\}\/consultas`/);
  });
});
