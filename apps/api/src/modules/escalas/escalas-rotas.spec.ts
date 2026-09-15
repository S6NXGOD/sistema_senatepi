import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { PermissionsGuard } from '../../common/permissions/permissions.guard';
import { EscalasController } from './escalas.controller';

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
      'GET /escalas/meses',
      'GET /escalas',
      'GET /escalas/:id/consultas',
      'POST /escalas/copia',
      'POST /escalas',
      'PATCH /escalas/:id',
      'DELETE /escalas/copia/:loteId',
      'DELETE /escalas/:id',
    ]);
  });

  /*
    A EXCEÇÃO À TRAVA DE EXCLUSÃO É UMA SÓ (15/09/2026). `@DadosProprios()` tira
    a rota da regra "só o Administrador apaga". Ele tem de estar no desfazer da
    cópia, e em nenhuma outra rota deste controller: no controller inteiro, o
    plantão de qualquer um poderia ser apagado pela Coordenação.
  */
  it('só o desfazer da cópia escapa da trava de exclusão', () => {
    expect(fonte.match(/@DadosProprios\(\)/g)).toHaveLength(1);
    expect(fonte).toMatch(/@Delete\('copia\/:loteId'\)\s*@DadosProprios\(\)\s*desfazerCopia\(/);
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

  /*
    O GUARD DE VERDADE, com o controller de verdade: a Coordenação (escalas
    EDITAR) desfaz a cópia e continua sem apagar plantão; o Advogado (escalas
    VISUALIZAR) não desfaz nada, porque a matriz continua valendo.
  */
  describe('o PermissionsGuard nas duas exclusões', () => {
    const guard = new PermissionsGuard(new Reflector());
    const pedido = (handler: 'desfazerCopia' | 'remover', role: UserRole) =>
      ({
        getHandler: () => EscalasController.prototype[handler],
        getClass: () => EscalasController,
        switchToHttp: () => ({ getRequest: () => ({ method: 'DELETE', user: { id: 'u1', role, permissoes: null } }) }),
      }) as never;

    it('Coordenação: desfaz a cópia, mas não apaga plantão', () => {
      expect(guard.canActivate(pedido('desfazerCopia', UserRole.COORDENACAO))).toBe(true);
      expect(() => guard.canActivate(pedido('remover', UserRole.COORDENACAO)))
        .toThrow('Apenas o Administrador pode excluir registros do sistema.');
    });

    it('Advogado, que só vê a escala: nem o desfazer', () => {
      expect(() => guard.canActivate(pedido('desfazerCopia', UserRole.ADVOGADO)))
        .toThrow(/somente visualização em "Escalas dos Advogados"/);
    });
  });

  it('o web chama as três rotas novas pelos caminhos declarados', () => {
    const web = readFileSync(path.resolve(__dirname, '../../../../web/src/lib/escalas.ts'), 'utf8');
    expect(web).toMatch(/api\.get\('\/escalas\/copia'/);
    expect(web).toMatch(/api\.post\('\/escalas\/copia'/);
    expect(web).toMatch(/api\.get\(`\/escalas\/\$\{escalaId\}\/consultas`/);
    expect(web).toMatch(/api\.delete\(`\/escalas\/copia\/\$\{encodeURIComponent\(loteId\)\}`/);
  });

  /*
    O NOME DO CAMPO É O MESMO DOS DOIS LADOS (integração da rodada 4): o web lia
    `removidas` e a API devolve `apagados`, e o aviso caía sempre na frase sem
    número. O desfazer da página conta `apagados` de `desfazerCopia`.
  */
  it('o desfazer da cópia: o web lê `apagados`, o nome que o serviço devolve', () => {
    const servico = semComentarios(readFileSync(path.join(__dirname, 'escalas.service.ts'), 'utf8'));
    const lib = semComentarios(readFileSync(path.resolve(__dirname, '../../../../web/src/lib/escalas.ts'), 'utf8'));
    const pagina = semComentarios(
      readFileSync(path.resolve(__dirname, '../../../../web/src/app/(dashboard)/escalas/page.tsx'), 'utf8'),
    );
    expect(servico).toMatch(/return \{ ok: true, apagados: n, jaApagados: decisao\.jaApagados \}/);
    expect(lib).toMatch(/desfazerCopia\(loteId: string\): Promise<\{ ok: boolean; apagados\?: number/);
    expect(pagina).toMatch(/avisoDaCopiaDesfeita\(r\?\.apagados, c\.destino\)/);
    expect(pagina).not.toMatch(/\bremovidas\b/);
  });
});
