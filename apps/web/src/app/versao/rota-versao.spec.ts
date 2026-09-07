import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROTA = readFileSync(join(__dirname, 'route.ts'), 'utf8');

/**
 * A rota é pública — o middleware só protege `/` e `/login`. O que ela responde
 * precisa continuar sendo APENAS o SHA curto, que já é público no repositório.
 * O risco real aqui não é o código de hoje: é o campo que alguém acrescenta
 * daqui a seis meses ("só para depurar") num endpoint sem autenticação.
 */
describe('a rota /versao da web', () => {
  it('expõe o SHA curto, e curto mesmo', () => {
    expect(ROTA).toContain('RAILWAY_GIT_COMMIT_SHA');
    expect(ROTA).toContain('.slice(0, 7)');
  });

  it('não devolve versão em cache', () => {
    expect(ROTA).toContain("'Cache-Control': 'no-store'");
    expect(ROTA).toContain("export const dynamic = 'force-dynamic'");
  });

  /** Nada de ambiente além do tenant, que já vai no HTML de toda página. */
  it('não vaza outras variáveis de ambiente', () => {
    const envs = ROTA.match(/process\.env\.[A-Z_]+/g) ?? [];
    expect(envs.sort()).toEqual(['process.env.NEXT_PUBLIC_TENANT', 'process.env.RAILWAY_GIT_COMMIT_SHA']);
  });
});
