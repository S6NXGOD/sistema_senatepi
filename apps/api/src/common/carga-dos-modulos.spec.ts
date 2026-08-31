import { readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';

/**
 * TODO CONTROLLER TEM DE CARREGAR.
 *
 * O caso que criou este arquivo, em 31/08/2026: acrescentei um DTO ao
 * `POST /importacoes/processos/:id/confirmar` e o declarei no FIM do arquivo,
 * depois da classe do controller. O `tsc --noEmit` passou sem uma queixa. A
 * API não subia:
 *
 *   ReferenceError: Cannot access 'ConfirmarImportacaoProcessosDto'
 *   before initialization
 *
 * A causa é o `emitDecoratorMetadata`. O `@Body() body?: Dto` faz o TypeScript
 * emitir `__metadata('design:paramtypes', [..., Dto])` no momento em que a
 * CLASSE do controller é definida — ou seja, antes de a declaração do DTO, lá
 * embaixo, ter sido inicializada. É um erro de ORDEM no arquivo, invisível para
 * o verificador de tipos e fatal na carga.
 *
 * Nenhum teste da suíte instanciava a aplicação, então a única forma de
 * descobrir era o deploy falhar. Este arquivo apenas EXIGE cada módulo: é
 * barato, não precisa de banco, e pega toda a família do defeito — ordem de
 * declaração, importação circular, decorador que explode na carga.
 */
const RAIZ = path.resolve(__dirname, '..');

function varrer(dir: string, sufixos: string[], achados: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const alvo = path.join(dir, nome);
    if (statSync(alvo).isDirectory()) {
      varrer(alvo, sufixos, achados);
    } else if (sufixos.some((s) => nome.endsWith(s)) && !nome.endsWith('.spec.ts')) {
      achados.push(alvo);
    }
  }
  return achados;
}

const arquivos = varrer(RAIZ, ['.controller.ts', '.module.ts']);

describe('carga dos módulos', () => {
  it('a varredura encontrou os arquivos (o teste não passa por estar vazio)', () => {
    expect(arquivos.length).toBeGreaterThan(20);
  });

  it.each(arquivos.map((a) => [path.relative(RAIZ, a), a]))('%s carrega', (_rel, alvo) => {
    expect(() => require(alvo as string)).not.toThrow();
  });
});
