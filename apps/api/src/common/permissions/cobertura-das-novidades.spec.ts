import { readFileSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { MODULO_KEYS, PRESETS_PERFIL, nivelEfetivo } from './permissoes.constants';

/**
 * A MATRIZ ACOMPANHOU AS FUNCIONALIDADES NOVAS?
 *
 * O modo de falhar aqui é sempre o mesmo e é silencioso: alguém acrescenta um
 * controller, esquece o `@Modulo`, o `PermissionsGuard` não encontra a chave e
 * cai no `@Roles` — quer dizer, a matriz que o administrador configura na tela
 * deixa de valer NAQUELE módulo, sem erro nenhum. Já aconteceu em dezenove
 * controllers de uma vez (ver `gate-por-modulo.spec.ts`).
 *
 * Este arquivo cobre o outro lado: as rotas e telas criadas depois daquela
 * varredura, e as exceções que são exceções DE PROPÓSITO.
 */
const RAIZ = path.resolve(__dirname, '../../modules');

function arquivosTs(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const p = path.join(dir, nome);
    if (statSync(p).isDirectory()) return arquivosTs(p);
    return p.endsWith('.ts') && !p.endsWith('.spec.ts') ? [p] : [];
  });
}

/**
 * Controllers que NÃO passam pela matriz, e a razão de cada um. Qualquer
 * controller fora desta lista tem de ter `@Modulo` — é o que o teste cobra.
 */
const SEM_MATRIZ: Record<string, string> = {
  auth: 'Login: precisa responder antes de existir usuário.',
  health: 'Sonda de infraestrutura, pública por definição.',
  sala: 'Check-in de evento por QR: `@Public()`, com regra própria.',
  'identidade-visual': 'Marca da instalação: leitura pública, escrita só do ADMINISTRADOR.',
  anexos: 'O anexo herda o módulo do PAI — quem autoriza é o `AnexoDoModuloGuard`.',
  profile: 'Autoatendimento: `@DadosProprios()` restringe ao usuário do token.',
  'portal-empresa': 'Realm separado: a empresa contribuinte não é usuário do sistema.',
  'portal-empresa/auth': 'Login do realm da empresa.',
};

describe('todo controller passa pela matriz, ou está na lista de exceções', () => {
  const controllers = arquivosTs(RAIZ)
    .flatMap((p) => {
      const src = readFileSync(p, 'utf8');
      return [...src.matchAll(/@Controller\(([^)]*)\)/g)].map((m) => {
        const antes = src.slice(0, m.index);
        const modulos = [...antes.matchAll(/@Modulo\('([a-z-]+)'\)/g)];
        return {
          arquivo: path.relative(RAIZ, p).replace(/\\/g, '/'),
          rota: m[1].trim().replace(/^'|'$/g, ''),
          temModulo: modulos.length > 0,
        };
      });
    });

  it('encontra os controllers (o teste não passa por varrer nada)', () => {
    expect(controllers.length).toBeGreaterThan(40);
  });

  it.each(controllers.map((c) => [c.rota, c.arquivo, c.temModulo] as const))(
    '/%s (%s) está gateado ou é exceção declarada',
    (rota, _arquivo, temModulo) => {
      const ehExcecao = Object.keys(SEM_MATRIZ).includes(rota);
      expect(`${rota}: gateado=${temModulo} excecao=${ehExcecao}`).toMatch(
        /gateado=true|excecao=true/,
      );
    },
  );
});

/**
 * AS FUNCIONALIDADES NOVAS, uma a uma. Cada linha diz qual módulo governa a
 * rota — e o teste falha se ela mudar de casa sem alguém decidir.
 */
describe('as rotas novas moram no módulo certo', () => {
  const ler = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8');

  it('a fila de vínculos é do módulo processos', () => {
    const src = ler('processos/partes.controller.ts');
    expect(src).toContain("@Modulo('processos')");
    // `partes/` na frente NÃO é enfeite: sem ele, `@Get(':id')` de
    // `ProcessosController` — registrado antes — engole a rota. Ver
    // `rotas-que-colidem.spec.ts`.
    expect(src).toContain("@Get('partes/vinculos-pendentes')");
    expect(src).toContain("@Post('partes/vinculos-pendentes/aplicar')");
    // TRIAGEM tem processos SEM_ACESSO: não vê nem a fila nem a aplicação.
    expect(nivelEfetivo('TRIAGEM' as never, {}, 'processos')).toBe('SEM_ACESSO');
    // O advogado edita processo, então resolve o vínculo — é trabalho dele.
    expect(nivelEfetivo('ADVOGADO' as never, {}, 'processos')).toBe('EDITAR');
  });

  it('a sugestão de filiado é leitura do módulo processos', () => {
    const src = ler('processos/partes.controller.ts');
    expect(src).toContain("@Get('partes/:parteId/sugestoes-filiado')");
  });

  it('a auditoria é do módulo auditoria, e só para quem coordena', () => {
    const src = ler('auditoria/auditoria.module.ts');
    expect(src).toContain("@Modulo('auditoria')");
    expect(src).toContain('@Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)');
    expect(PRESETS_PERFIL.ADVOGADO.auditoria).toBe('SEM_ACESSO');
    expect(PRESETS_PERFIL.TRIAGEM.auditoria).toBe('SEM_ACESSO');
    expect(PRESETS_PERFIL.COORDENACAO.auditoria).toBe('VISUALIZAR');
  });

  /**
   * A AUDITORIA NÃO SE ESCREVE PELA API. Registro que a própria aplicação sabe
   * alterar não serve de prova de nada — não há POST, PATCH nem DELETE ali, e
   * o único jeito de isso mudar é alguém apagar este teste.
   */
  it('a auditoria é somente leitura', () => {
    const src = ler('auditoria/auditoria.module.ts');
    for (const verbo of ['@Post(', '@Patch(', '@Put(', '@Delete(']) {
      expect(`${verbo} em auditoria: ${src.includes(verbo)}`).toBe(`${verbo} em auditoria: false`);
    }
  });

  it('o assunto do atendimento é do módulo atendimentos', () => {
    const src = ler('atendimentos/atendimentos.controller.ts');
    expect(src).toContain("@Modulo('atendimentos')");
    // O balcão classifica: é ele quem conversa com a pessoa.
    expect(PRESETS_PERFIL.TRIAGEM.atendimentos).toBe('EDITAR');
  });
});

describe('a matriz continua íntegra', () => {
  it('nenhum perfil ficou sem valor para algum módulo', () => {
    for (const [perfil, matriz] of Object.entries(PRESETS_PERFIL)) {
      for (const chave of MODULO_KEYS) {
        expect(`${perfil}.${chave}=${matriz[chave]}`).not.toContain('undefined');
      }
    }
  });

  /**
   * O ADMINISTRADOR EDITA TUDO — e é ele, só ele, quem apaga (o
   * `PermissionsGuard` barra todo DELETE dos demais). Um módulo novo que
   * nascesse fora do preset dele daria o absurdo de o administrador não
   * conseguir usar a própria instalação.
   */
  it('o administrador alcança todo módulo', () => {
    for (const chave of MODULO_KEYS) {
      expect(`${chave}=${PRESETS_PERFIL.ADMINISTRADOR[chave]}`).toBe(`${chave}=EDITAR`);
    }
  });

  /**
   * `organizacoes` ESPELHA `processos` em todo perfil: é a mesma tabela por
   * outra porta. Divergir daria o absurdo de quem edita a parte dentro do
   * processo não poder corrigir o nome dela no cadastro.
   */
  it('organizações acompanha processos em todos os perfis', () => {
    for (const [perfil, matriz] of Object.entries(PRESETS_PERFIL)) {
      expect(`${perfil}: ${matriz.organizacoes}`).toBe(`${perfil}: ${matriz.processos}`);
    }
  });
});
