import { readFileSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { RecadastroPublicoController } from '../modules/recadastramento/link-recadastramento.controller';
import { RecadastroPublicoDto } from '../modules/recadastramento/dto/recadastro-publico.dto';

/**
 * TRAVAS DE SEGURANÇA — as que um refactor distraído desfaz sem perceber.
 *
 * Estes casos não testam comportamento em tempo de execução: testam que
 * DECISÕES continuam escritas no código. É de propósito. Cada um deles nasceu
 * de uma falha encontrada nas auditorias OWASP de 14 e 21/08/2026, e o que os torna
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

describe('credencial da sala virtual', () => {
  /**
   * O `presencaId` autoriza VOTAR. No caminho ou na query ele entrava no
   * histórico do navegador e no log de acesso — e a sala é usada em computador
   * compartilhado, onde a próxima pessoa votaria no lugar da anterior.
   */
  it('a sessão tem rota que recebe a credencial por CABEÇALHO', () => {
    const c = ler('src/modules/eventos/checkin.controller.ts');
    expect(c).toMatch(/CABECALHO_PRESENCA/);
    expect(c).toMatch(/@Get\(':eventoId\/sessao'\)/);
  });

  it('o ao-vivo lê o cabeçalho antes da query', () => {
    const c = ler('src/modules/eventos/plenario.controller.ts');
    expect(c).toMatch(/presencaHeader\?\.trim\(\) \|\| presencaQuery/);
  });

  it('o front manda a credencial em cabeçalho, nunca na URL', () => {
    const lib = readFileSync(
      path.join(RAIZ, '../../apps/web/src/lib/eventos.ts'), 'utf8',
    );
    expect(lib).toMatch(/'X-Presenca-Id'/);
    // A montagem antiga por query string não pode voltar.
    expect(lib).not.toMatch(/\?presencaId=\$\{/);
  });
});

describe('uploads servidos', () => {
  const main = ler('src/main.ts');

  /** Sem o porteiro, a assinatura da URL seria enfeite: o static serviria igual. */
  it('há porteiro conferindo a assinatura ANTES do static', () => {
    expect(main).toMatch(/urlAssinadaValida/);
    const posGuarda = main.indexOf('urlAssinadaValida');
    const posStatic = main.indexOf('useStaticAssets');
    expect(posGuarda).toBeGreaterThan(-1);
    expect(posGuarda).toBeLessThan(posStatic);
  });

  /** 403 confirmaria que o arquivo existe e transformaria a rota num oráculo. */
  it('recusa com 404, e não 403', () => {
    const trecho = main.slice(main.indexOf("app.use('/uploads'"), main.indexOf('useStaticAssets'));
    expect(trecho).toMatch(/status\(404\)/);
    expect(trecho).not.toMatch(/status\(403\)/);
  });
});

describe('validade do access token', () => {
  const service = ler('src/modules/auth/auth.service.ts');

  /**
   * Trocar só o PADRÃO não resolveria: a variável já está definida em produção
   * como 30d e venceria o código. Por isso o teto é imposto aqui.
   */
  it('há teto imposto pelo código, não só um padrão', () => {
    expect(service).toMatch(/ACCESS_TOKEN_TETO_HORAS/);
    // O que importa é o que o CÓDIGO faz, não o que o comentário cita: o
    // comentário explica de onde viemos e menciona o valor antigo de propósito.
    expect(service).toMatch(/expiresIn: this\.validadeDoAccessToken\(\)/);
  });

  it('o teto é de no máximo 12 horas', () => {
    const m = /ACCESS_TOKEN_TETO_HORAS = (\d+)/.exec(service);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeLessThanOrEqual(12);
  });
});

describe('habilitação pela mesa', () => {
  /**
   * CPF sozinho autoriza voto, e não há segundo fator possível: medido na base,
   * 5,1% dos filiados têm data de nascimento e 0,1% têm telefone. A saída é
   * humana — e reusa o caminho dos homônimos, que já existe e já é exercitado.
   */
  it('a chave existe e vem DESLIGADA por padrão', () => {
    const cfg = ler('src/modules/eventos/configuracoes-evento.ts');
    expect(cfg).toMatch(/exigirHabilitacaoDaMesa: boolean/);
    expect(cfg).toMatch(/exigirHabilitacaoDaMesa: false/);
  });

  it('ligada, a presença nasce sem vínculo — é o que segura o voto', () => {
    const c = ler('src/modules/eventos/checkin.service.ts');
    expect(c).toMatch(/filiadoId: exigeMesa \? null : filiado\.id/);
  });

  /** Sem isto, cada reentrada criaria uma presença nova e inflaria o quórum. */
  it('a reentrada reaproveita a presença ainda não vinculada', () => {
    const c = ler('src/modules/eventos/checkin.service.ts');
    expect(c).toMatch(/filiadoId: null, cpfInformado: digitos/);
  });
});

/**
 * ATRIBUIÇÃO EM MASSA NA ROTA PÚBLICA DO RECADASTRO — achado de 12/09/2026.
 *
 * `POST /recadastro/:token/enviar` tipava o corpo como `UpdateFiliadoDto & {...}`.
 * Interseção vira metatipo `Object`, e o ValidationPipe do Nest (v10) PULA
 * metatipo `Object`: whitelist e forbidNonWhitelisted não rodavam. Quem tinha o
 * link gravava `situacao`, `matricula` e até `cobrancas: { deleteMany: {} }`.
 *
 * Este bloco não confere texto: roda o pipe de verdade, com a mesma
 * configuração de `main.ts`, contra o metatipo que a rota declara.
 */
describe('o corpo público do recadastro passa pela validação', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
  const metatipo = () =>
    Reflect.getMetadata('design:paramtypes', RecadastroPublicoController.prototype, 'enviar')[1];
  const validar = (corpo: unknown) =>
    pipe.transform(corpo, { type: 'body', metatype: metatipo(), data: '' });

  /** O que a página pública (recadastro/[token]/page.tsx) manda hoje. */
  const DA_PAGINA = {
    cpfConfirmacao: '12345678900',
    dataNascimentoConfirmacao: '1980-05-10',
    nomeCompleto: 'MARIA DA SILVA',
    cpf: '12345678900',
    rg: '1234567',
    ufRg: 'PI',
    dataNascimento: '1980-05-10',
    sexo: 'FEMININO',
    telefonePrincipal: '(86) 99999-8888',
    email: 'maria@exemplo.org',
    cep: '64000-000',
    endereco: 'Rua A',
    numero: '10',
    bairro: 'Centro',
    cidade: 'Teresina',
    estado: 'PI',
    dataAdmissao: '2010-03-01',
    dependentes: [{ tipo: 'FILHO', nome: 'JOÃO', cpf: '98765432100', dataNascimento: '2012-01-01' }],
    vinculos: [{ empresa: 'HOSPITAL', cargo: 'Técnica', matricula: '123', ordem: 1 }],
  };

  it('a rota declara a CLASSE, não `Object`', () => {
    expect(metatipo()).toBe(RecadastroPublicoDto);
  });

  it('o que a página pública envia continua passando', async () => {
    const r = await validar(DA_PAGINA);
    expect(r).toBeInstanceOf(RecadastroPublicoDto);
    expect(r.nomeCompleto).toBe('MARIA DA SILVA');
  });

  it.each([
    ['situacao (reativar-se pulando a porta)', { situacao: 'ATIVO' }],
    ['cobrancas com escrita aninhada', { cobrancas: { deleteMany: {} } }],
    ['historico com escrita aninhada', { historico: { deleteMany: {} } }],
    ['matricula', { matricula: '000001' }],
    ['qrToken', { qrToken: 'forjado' }],
    ['fotoKey', { fotoKey: 'uploads/de-outro.webp' }],
    ['modalidadeContribuicao', { modalidadeContribuicao: 'AVULSO' }],
    ['vinculoFuncional', { vinculoFuncional: 'APOSENTADO' }],
  ])('recusa %s com 400', async (_nome, extra) => {
    await expect(validar({ ...DA_PAGINA, ...extra })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('o item aninhado também passa pela whitelist (dependente e vínculo)', async () => {
    await expect(
      validar({ ...DA_PAGINA, dependentes: [{ ...DA_PAGINA.dependentes[0], filiadoId: 'outro' }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    // Desconto em folha e organização do vínculo são decisão da equipe.
    await expect(
      validar({ ...DA_PAGINA, vinculos: [{ empresa: 'HOSPITAL', descontoEmFolha: true }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      validar({ ...DA_PAGINA, vinculos: [{ empresa: 'HOSPITAL', parteExternaId: 'org-1' }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      validar({ ...DA_PAGINA, vinculos: [{ empresa: 'HOSPITAL', ordem: { set: 1 } }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

/**
 * NENHUM `@Body()` TIPADO COMO INTERSEÇÃO, em controller nenhum.
 *
 * Contado em 12/09/2026: havia UM (o do recadastro público, consertado em 13/09).
 * A varredura cobre todo `.ts` com `@Controller(`, inclusive os que moram em
 * `*.module.ts`, e ignora comentários.
 */
describe('corpo de rota nunca é interseção de tipos', () => {
  const SRC = path.join(RAIZ, 'src');
  const arquivos = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = path.join(dir, n);
      if (statSync(p).isDirectory()) return arquivos(p);
      return p.endsWith('.ts') && !p.endsWith('.spec.ts') ? [p] : [];
    });
  const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const controllers = arquivos(SRC)
    .map((p) => ({ p, src: semComentarios(readFileSync(p, 'utf8')) }))
    .filter((a) => a.src.includes('@Controller('));

  /** `@Body() dto: A & {`, `@Body('x') y: A & B` — até a vírgula ou o parêntese do parâmetro. */
  const INTERSECAO = /@Body\([^)]*\)\s*\w+\??\s*:\s*[^,)=]*?&/g;

  it('a varredura encontra os controllers', () => {
    expect(controllers.length).toBeGreaterThan(40);
  });

  it('zero corpos tipados como interseção', () => {
    const achados = controllers.flatMap((a) =>
      [...a.src.matchAll(INTERSECAO)].map((m) => `${path.relative(SRC, a.p)}: ${m[0].replace(/\s+/g, ' ')}`),
    );
    expect(achados).toEqual([]);
  });

  it('o detector pega a forma que abriu o buraco', () => {
    const antigo = '@Body() dto: UpdateFiliadoDto & {\n cpfConfirmacao?: string;\n },';
    expect(antigo.match(INTERSECAO)).toHaveLength(1);
    expect('@Body() dto: RecadastroPublicoDto,'.match(INTERSECAO)).toBeNull();
  });
});
