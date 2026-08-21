import { readFileSync } from 'node:fs';
import * as path from 'node:path';

/**
 * TRAVAS DE SEGURANÇA — as que um refactor distraído desfaz sem perceber.
 *
 * Estes casos não testam comportamento em tempo de execução: testam que
 * DECISÕES continuam escritas no código. É de propósito. Cada um deles nasceu
 * de uma falha encontrada na auditoria OWASP de 14/08/2026, e o que os torna
 * úteis é justamente reprovar quando alguém, meses depois, "limpa" uma linha
 * que parecia decorativa.
 *
 * É o mesmo espírito de `tenants.conformidade.spec.ts`: a diferença entre
 * "está escrito no documento" e "não passa".
 */

const RAIZ = path.resolve(__dirname, '../..');
const ler = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8');

describe('cabeçalhos e superfície HTTP', () => {
  const main = ler('src/main.ts');

  it('o Helmet está instalado na aplicação', () => {
    expect(main).toMatch(/import helmet from 'helmet'/);
    expect(main).toMatch(/app\.use\(\s*helmet\(/);
  });

  /**
   * O padrão do Helmet é `same-origin`, e o front roda em OUTRO domínio.
   * Ligar o padrão faria o navegador recusar toda foto e todo logo vindos da
   * API — a tela inteira ficaria sem imagem. Se alguém "consertar" isto para
   * ficar mais seguro, quebra a produção.
   */
  it('crossOriginResourcePolicy segue DESLIGADO (o front é outro domínio)', () => {
    expect(main).toMatch(/crossOriginResourcePolicy:\s*false/);
  });

  /** Credencial viaja em query string na sala virtual — sem isto ela vaza no Referer. */
  it('Referrer-Policy está definida', () => {
    expect(main).toMatch(/referrerPolicy/);
    expect(main).toMatch(/strict-origin-when-cross-origin/);
  });

  /**
   * A pasta de uploads guarda documento pessoal e é servida sem autenticação.
   * Estes quatro cabeçalhos são a única proteção que resta enquanto for assim.
   */
  it('o diretório de uploads é servido com CSP, nosniff, noindex e no-store', () => {
    expect(main).toMatch(/default-src 'none'; sandbox/);
    expect(main).toMatch(/X-Content-Type-Options/);
    expect(main).toMatch(/X-Robots-Tag/);
    expect(main).toMatch(/no-store/);
    expect(main).toMatch(/dotfiles:\s*'deny'/);
  });
});

describe('força bruta nas telas de credencial', () => {
  const auth = ler('src/modules/auth/auth.controller.ts');

  /**
   * O teto global é 120/min — 172.800 tentativas por dia a partir de um IP.
   * O portal patronal e a colônia já tinham limite próprio; o login da equipe,
   * que é o alvo de maior valor, não tinha.
   */
  it('login, recuperação e redefinição têm limite próprio', () => {
    const throttles = auth.match(/@Throttle\(/g) ?? [];
    expect(throttles.length).toBeGreaterThanOrEqual(3);
  });

  it('o limite do login é mais apertado que o global de 120/min', () => {
    const m = /@Throttle\(\{ default: \{ limit: (\d+), ttl: 60_000 \} \}\)\s*\n\s*@HttpCode\(200\)\s*\n\s*login/.exec(auth);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeLessThan(120);
  });

  it('o desafio público do recadastramento tem limite', () => {
    const rec = ler('src/modules/recadastramento/link-recadastramento.controller.ts');
    expect(rec).toMatch(/@Throttle\(/);
  });
});

describe('trilha de auditoria', () => {
  const service = ler('src/modules/auth/auth.service.ts');

  /**
   * Antes, só o login BEM-SUCEDIDO era auditado — e trilha que só guarda
   * sucesso não responde "tentaram entrar antes?".
   */
  it('a tentativa de login recusada é registrada', () => {
    expect(service).toMatch(/registrarLoginRecusado/);
    expect(service).toMatch(/sucesso: false/);
  });

  /** Registrar a senha errada vaza a senha certa (ela vem na tentativa seguinte). */
  it('a senha tentada NUNCA entra no registro', () => {
    const trecho = /registrarLoginRecusado[\s\S]*?^\s{2}\}/m.exec(service)?.[0] ?? '';
    expect(trecho).not.toMatch(/dto\.senha|senhaTentada|password/i);
  });
});

describe('upload de arquivo', () => {
  /**
   * A CADEIA QUE ESTAVA ABERTA: o MIME era validado, mas a extensão gravada
   * saía do nome enviado pelo usuário — e é a extensão que decide o
   * `Content-Type` servido por `express.static`. Um PDF chamado `laudo.svg`
   * virava SVG executável na origem da API.
   */
  it.each([
    ['src/modules/filiados/filiados.service.ts', 'filiados'],
    ['src/modules/colaboradores/colaboradores.service.ts', 'colaboradores'],
    ['src/modules/anexos/anexos.service.ts', 'anexos'],
  ])('%s deriva a extensão do MIME validado, não do nome enviado', (arquivo) => {
    const src = ler(arquivo);
    const trechoDoc = src.slice(Math.max(0, src.indexOf('documentos/') - 900), src.indexOf('documentos/') + 200);
    // Nenhum caminho de documento pode montar a extensão a partir do nome.
    expect(trechoDoc).not.toMatch(/originalname\s*\.\s*split\('\.'\)/);
  });

  it('os dois módulos de documento validam o tipo antes de gravar', () => {
    expect(ler('src/modules/filiados/filiados.service.ts')).toMatch(/MIME_PERMITIDOS\[arquivo\.mimetype\]/);
    expect(ler('src/modules/colaboradores/colaboradores.service.ts')).toMatch(/MIME_DOCUMENTO\[arquivo\.mimetype\]/);
  });

  /** Upload sem teto enche o volume do Railway — indisponibilidade, não só sujeira. */
  it('nenhum FileInterceptor fica sem limite de tamanho', () => {
    const arquivos = [
      'src/modules/filiados/filiados.controller.ts',
      'src/modules/colaboradores/colaboradores.controller.ts',
      'src/modules/dependentes/dependentes.module.ts',
      'src/modules/anexos/anexos.controller.ts',
      'src/modules/recadastramento/link-recadastramento.controller.ts',
    ];
    for (const a of arquivos) {
      const src = ler(a);
      const semLimite = /FileInterceptor\(\s*'[^']+'\s*\)/g.exec(src);
      expect(`${a}: ${semLimite?.[0] ?? 'ok'}`).toBe(`${a}: ok`);
    }
  });
});

describe('armazenamento', () => {
  /**
   * Hoje toda chave é montada pelo servidor, então não há ataque conhecido —
   * mas a distância entre isto e gravação arbitrária em disco é UMA linha.
   */
  it('o caminho local é conferido contra escape do diretório', () => {
    const st = ler('../../packages/core-infra/src/storage/storage.service.ts');
    expect(st).toMatch(/caminhoLocalSeguro/);
    expect(st).toMatch(/escapa do diretório/);
    // E o join cru não pode voltar.
    expect(st).not.toMatch(/path\.join\(this\.localDir, key\)/);
  });
});
