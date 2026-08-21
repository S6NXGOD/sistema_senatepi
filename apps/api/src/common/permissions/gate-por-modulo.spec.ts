import { readFileSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';

/**
 * TODO MÓDULO GATEADO POR TENANT TAMBÉM PRECISA SER GATEADO POR PERMISSÃO.
 *
 * O BUG QUE ISTO IMPEDE, e ele passou meses no ar.
 *
 * `@ModuloTenant('x')` e `@Modulo('x')` parecem a mesma coisa e gravam chaves
 * de metadado DIFERENTES: a primeira responde "esta instalação tem o módulo?",
 * a segunda, "este usuário pode?". Dezenove controllers tinham só a primeira.
 * O `PermissionsGuard` procurava `@Modulo`, não encontrava, e caía no `@Roles`
 * — quer dizer, **a matriz de permissões que o administrador configura na tela
 * era decorativa** nesses módulos, incluindo `filiados` e `colaboradores`.
 *
 * Medido em 21/08/2026, contra a API rodando: um usuário TRIAGEM com
 * `filiados: SEM_ACESSO` na matriz EDITOU um filiado e recebeu HTTP 200.
 *
 * O que torna esse erro perigoso não é a sutileza — é o SILÊNCIO. Nada falha,
 * nada aparece no log; a tela de permissões continua bonita e sem efeito. Só um
 * teste que compara os dois decoradores pega, e é este.
 */
const RAIZ = path.resolve(__dirname, '../../modules');

function arquivosTs(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const p = path.join(dir, nome);
    if (statSync(p).isDirectory()) return arquivosTs(p);
    return p.endsWith('.ts') && !p.endsWith('.spec.ts') ? [p] : [];
  });
}

/** Cada ocorrência de @ModuloTenant e o @Modulo que a acompanha (ou não). */
function ocorrencias(src: string) {
  const linhas = src.split('\n');
  const achados: Array<{ linha: number; tenant: string; permissao?: string }> = [];
  for (let i = 0; i < linhas.length; i++) {
    const m = /^\s*@ModuloTenant\('([a-z-]+)'\)/.exec(linhas[i]);
    if (!m) continue;
    // O @Modulo pareado fica coladinho — antes ou depois, ignorando comentários.
    let permissao: string | undefined;
    for (const j of [i - 1, i + 1, i + 2, i + 3]) {
      const p = /^\s*@Modulo\('([a-z-]+)'\)/.exec(linhas[j] ?? '');
      if (p) { permissao = p[1]; break; }
    }
    achados.push({ linha: i + 1, tenant: m[1], permissao });
  }
  return achados;
}

describe('gate por módulo', () => {
  const arquivos = arquivosTs(RAIZ).filter((f) => readFileSync(f, 'utf8').includes('@ModuloTenant('));

  it('há controllers gateados por tenant (o teste não está vazio à toa)', () => {
    expect(arquivos.length).toBeGreaterThan(10);
  });

  it('TODO @ModuloTenant tem um @Modulo ao lado', () => {
    const faltando: string[] = [];
    for (const f of arquivos) {
      for (const o of ocorrencias(readFileSync(f, 'utf8'))) {
        if (!o.permissao) {
          faltando.push(`${path.relative(RAIZ, f)}:${o.linha} → @ModuloTenant('${o.tenant}') sem @Modulo`);
        }
      }
    }
    expect(faltando).toEqual([]);
  });

  /**
   * Chaves diferentes nos dois decoradores significam "a instalação precisa do
   * módulo A, mas a permissão conferida é a do módulo B" — quase sempre um
   * copiar-e-colar, e o tipo de coisa que só aparece quando alguém reclama de
   * acesso indevido.
   */
  it('o @Modulo usa a MESMA chave do @ModuloTenant', () => {
    const divergentes: string[] = [];
    for (const f of arquivos) {
      for (const o of ocorrencias(readFileSync(f, 'utf8'))) {
        if (o.permissao && o.permissao !== o.tenant) {
          divergentes.push(`${path.relative(RAIZ, f)}:${o.linha} → tenant '${o.tenant}' × permissão '${o.permissao}'`);
        }
      }
    }
    expect(divergentes).toEqual([]);
  });
});
