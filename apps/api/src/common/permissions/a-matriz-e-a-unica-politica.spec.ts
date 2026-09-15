import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PRESETS_PERFIL, nivelEfetivo } from './permissoes.constants';

/**
 * A MATRIZ É A ÚNICA POLÍTICA — e este arquivo existe para que continue sendo.
 *
 * O QUE ACONTECEU. O administrador marcou `usuarios: EDITAR` para a coordenação
 * na tela de permissões, ela clicou em "Novo usuário" e recebeu **"Forbidden
 * resource"**. Nada na tela explicava, e nada na matriz resolvia: o
 * `UsuariosController` inteiro era `@Roles(UserRole.ADMINISTRADOR)`, um segundo
 * portão que roda ANTES do `PermissionsGuard` e que a matriz não alcança.
 *
 * Não era um caso isolado. Auditado em 10/09/2026:
 *
 *   @Roles de CLASSE (atropelam o módulo inteiro) ....  4
 *     · usuarios ... ADMINISTRADOR      ← o erro relatado
 *     · cobrancas .. ADMINISTRADOR, COORDENACAO
 *     · financeiro . ADMINISTRADOR, COORDENACAO
 *     · anexos ..... sem @Modulo, gate real é o AnexoDoModuloGuard (segue)
 *   @Roles de ROTA ................................... 68
 *
 * Setenta e um lugares onde a tela de permissões prometia uma coisa e o servidor
 * fazia outra. E o pior não era a recusa: era não haver como descobrir o porquê.
 *
 * A REGRA QUE FICA, e que este teste protege:
 *
 *   1. Controller com @Modulo NÃO pode ter @Roles. A matriz decide.
 *   2. A única exceção dentro de um módulo é @OperacaoDeSistema(), que é
 *      explícita, tem mensagem própria e é CONTADA aqui — se o número crescer,
 *      alguém está recriando o @Roles com outro nome.
 *   3. @Roles sobrevive só onde NÃO existe @Modulo (o anexo, que herda o módulo
 *      do pai em tempo de execução).
 *   4. Recusa nenhuma pode ser muda: todo 403 nomeia o que faltou.
 */

const RAIZ = join(__dirname, '../..');

/**
 * TODO ARQUIVO COM `@Controller(`, e não só `*.controller.ts` — mudou em 13/09/2026.
 *
 * A primeira versão filtrava pelo nome do arquivo, e o `@Roles` do recadastro
 * presencial sobreviveu dentro de `recadastramento.module.ts` com este teste
 * verde (9/9). Um advogado com `filiados: EDITAR` na matriz preenchia o
 * formulário inteiro e levava "Esta rota é exclusiva do(s) perfil(is)". A
 * varredura agora é a mesma do `gate-por-modulo.spec.ts`: todo `.ts` que não é
 * spec e declara controller.
 */
function controllers(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return controllers(p);
    if (!p.endsWith('.ts') || p.endsWith('.spec.ts')) return [];
    return readFileSync(p, 'utf8').includes('@Controller(') ? [p] : [];
  });
}

/** Comentário não é decorador: `@Modulo(` citado na prosa não faz um arquivo "ter módulo". */
const semComentarios = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * A DÍVIDA QUE A VARREDURA NOVA ACHOU — fora do território de quem a ampliou.
 *
 * Contada em 13/09/2026, com a regra valendo para `*.module.ts`:
 *   · acessos.module.ts ..... POST acessos/validar      ADMIN, COORDENACAO, TRIAGEM
 *   · presencas.module.ts ... POST validacao/qr         ADMIN, COORDENACAO, TRIAGEM
 *   · auditoria.module.ts ... GET  auditoria (3 rotas)  ADMIN, COORDENACAO
 * (o do recadastramento saiu na mesma data.) Cada um é uma segunda política
 * que a tela de permissões não mostra. A lista SÓ PODE ENCOLHER: quem tirar o
 * `@Roles` de um deles apaga a linha; quem acrescentar um arquivo aqui está
 * recriando o defeito que este teste existe para impedir.
 *
 * MAIS DOIS QUE A REGEX NÃO VIA (13/09/2026) — escritos na MESMA linha do verbo
 * (`@Post('emitir') @Roles(...)`), eles passavam com o teste verde:
 *   · carteirinhas.module.ts  POST carteirinhas/emitir  ADMIN, COORDENACAO
 *   · eventos.module.ts ..... POST e PATCH eventos      ADMIN, COORDENACAO
 *                             GET  eventos/:id/impacto  ADMIN
 *                             DELETE eventos/:id        ADMIN (a trava global já cobre)
 * NÃO SAÍRAM AQUI, porque tirar muda quem pode, e a decisão é do dono do sistema.
 * Medido na produção em 13/09/2026: sem o `@Roles` da carteirinha, 4 usuários
 * TRIAGEM e 1 ADVOGADO que têm `filiados: EDITAR` passariam a emitir — e a
 * matriz não sabe dizer "edita filiado mas não emite carteirinha". Em eventos,
 * ninguém fora de ADMINISTRADOR e COORDENACAO tem `eventos: EDITAR` hoje, e o
 * que mudaria é o impacto (só do Administrador) abrir para quem tiver
 * `eventos: VISUALIZAR`.
 */
const ROLES_COM_MODULO_A_TIRAR = [
  'acessos.module.ts',
  'auditoria.module.ts',
  'carteirinhas.module.ts',
  'eventos.module.ts',
  'presencas.module.ts',
];

/**
 * USA O DECORADOR, NAO A PALAVRA — e a primeira versao deste arquivo caiu nisso.
 *
 * `src.includes('@Roles(')` acusou `usuarios.controller.ts`, que nao tem
 * decorador nenhum: tem o COMENTARIO que explica por que o `@Roles` saiu de la.
 * E a quinta vez que uma assercao negativa desta base bate na prosa em portugues
 * em vez do codigo.
 *
 * O CONSERTO SEGUINTE ERROU PARA O OUTRO LADO (13/09/2026). Exigir inicio de
 * linha deixava passar o decorador escrito depois do verbo, e dois arquivos
 * escaparam assim. A regra agora e: em qualquer ponto do CODIGO, desde que venha
 * no comeco da linha ou depois de um espaco. A prosa ja sai antes, por
 * `semComentarios`; e `x@Roles(` colado nao e decorador.
 */
const USO_DE_ROLES = /(^|\s)@Roles\(/m;

const ARQUIVOS = controllers(RAIZ).map((p) => {
  const src = readFileSync(p, 'utf8');
  return { nome: p.split(/[\\/]/).pop()!, caminho: p, src, codigo: semComentarios(src) };
});

describe('a matriz é a única política de módulo', () => {
  it('existe controller para auditar (a varredura não deu vazio por engano)', () => {
    expect(ARQUIVOS.length).toBeGreaterThan(20);
    expect(ARQUIVOS.filter((a) => a.codigo.includes('@Modulo(')).length).toBeGreaterThan(15);
    // Os controllers que moram em *.module.ts ENTRARAM na varredura.
    expect(ARQUIVOS.filter((a) => a.nome.endsWith('.module.ts')).length).toBeGreaterThanOrEqual(8);
  });

  /**
   * A TRAVA PRINCIPAL. Se alguém acrescentar um `@Roles` num controller que já
   * tem `@Modulo`, este teste falha com o nome do arquivo — antes de virar um
   * "Forbidden resource" que ninguém consegue explicar.
   */
  it('nenhum controller com @Modulo usa @Roles (fora a dívida contada)', () => {
    const infratores = ARQUIVOS.filter(
      (a) => a.codigo.includes('@Modulo(') && USO_DE_ROLES.test(a.codigo),
    ).map((a) => a.nome).sort();
    expect(infratores).toEqual(ROLES_COM_MODULO_A_TIRAR);
  });

  /** O decorador depois do verbo, na mesma linha, é o caso que escapava. */
  it('acha o @Roles em qualquer ponto do código, e não na prosa', () => {
    const usaRoles = (src: string) => USO_DE_ROLES.test(semComentarios(src));
    expect(usaRoles("  @Post('emitir') @Roles(UserRole.ADMINISTRADOR)\n  emitir() {}")).toBe(true);
    expect(usaRoles('  @Roles(UserRole.ADMINISTRADOR)\n  listar() {}')).toBe(true);
    expect(usaRoles('/** Era `@Roles(ADMINISTRADOR)` no controller inteiro. */\nexport class X {}')).toBe(false);
    expect(usaRoles('  // o @Roles(ADMINISTRADOR) saiu daqui\nexport class X {}')).toBe(false);
  });

  it('o recadastro presencial segue a matriz (era o @Roles escondido em *.module.ts)', () => {
    const presencial = ARQUIVOS.find((a) => a.nome === 'recadastramento.controller.ts');
    expect(presencial).toBeDefined();
    expect(presencial!.codigo).toContain("@Post('recadastramento')");
    expect(presencial!.codigo).toContain("@Modulo('filiados')");
    expect(USO_DE_ROLES.test(presencial!.codigo)).toBe(false);
    const modulo = ARQUIVOS.find((a) => a.nome === 'recadastramento.module.ts');
    // Saiu do módulo: ali não há mais controller nenhum.
    expect(modulo).toBeUndefined();
  });

  /** Onde não há módulo, `@Roles` continua sendo o gate legítimo. */
  it('@Roles só sobrevive onde não existe @Modulo', () => {
    const comRoles = ARQUIVOS.filter(
      (a) => USO_DE_ROLES.test(a.codigo) && !ROLES_COM_MODULO_A_TIRAR.includes(a.nome),
    ).map((a) => a.nome).sort();
    // identidade-visual: marca da instalação, escrita só do ADMINISTRADOR, sem @Modulo
    // (exceção declarada em cobertura-das-novidades.spec.ts).
    expect(comRoles).toEqual(['anexos.controller.ts', 'identidade-visual.module.ts']);
  });

  /**
   * A LISTA CURTA, CONTADA. Quatro operações que não são "editar o módulo X":
   * varrer o DJEN (queima a cota do CNJ do sindicato), reprocessar o radar
   * inteiro, e as duas filas que decidem se dois cadastros são o mesmo —
   * organizações desde 12/09 e filiados desde 15/09/2026. Consolidar apaga, e
   * descartar tirava o par da vista de quem consolida.
   */
  it('as operações de sistema são exatamente quatro, e são estas', () => {
    const comDecorador = ARQUIVOS.filter((a) => a.src.includes('@OperacaoDeSistema()'))
      .map((a) => a.nome)
      .sort();
    expect(comDecorador).toEqual([
      'audiencias.controller.ts',
      'djen.controller.ts',
      'duplicidade.controller.ts',
      'partes.controller.ts',
    ]);
    const total = ARQUIVOS.reduce(
      (n, a) => n + (a.src.match(/@OperacaoDeSistema\(\)/g)?.length ?? 0),
      0,
    );
    expect(total).toBe(4);
  });
});

/**
 * O 403 MUDO FOI O DEFEITO DE DIAGNÓSTICO, e ele custou mais que a recusa em si.
 *
 * `RolesGuard` devolvia `false`, e o Nest responde a isso com "Forbidden
 * resource" — uma frase que não diz qual módulo, qual nível, nem que existia
 * uma política paralela. O administrador ficou sem saída: a tela dizia que a
 * permissão estava dada.
 */
describe('nenhuma recusa é muda', () => {
  const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8');

  it('o guarda de perfis lança com mensagem, não devolve false', () => {
    const guarda = ler('modules/auth/guards/roles.guard.ts');
    expect(guarda).toContain('throw new ForbiddenException(');
    expect(guarda).toContain('Esta rota é exclusiva do(s) perfil(is)');
    // A negativa mira o RETORNO, não a palavra: `return true` continua existindo.
    expect(guarda).not.toContain('return !!user && required.includes');
  });

  it('o guarda de módulo diz QUAL módulo e QUAL nível faltou', () => {
    const guarda = ler('common/permissions/permissions.guard.ts');
    expect(guarda).toContain('MODULOS.find((m) => m.key === modulo)?.label');
    expect(guarda).toContain('Peça a um Administrador para ajustar a matriz de permissões.');
  });

  it('a operação de sistema explica que não depende da matriz', () => {
    const guarda = ler('common/permissions/permissions.guard.ts');
    expect(guarda).toContain('Ela não depende da matriz de permissões.');
  });
});

/**
 * O QUE O CONSERTO ABRIU — escrito por extenso, porque mudança de permissão que
 * ninguém consegue enumerar é mudança que ninguém consegue revisar.
 */
describe('o alcance novo, por preset', () => {
  it('a coordenação alcança usuários quando o administrador marcar', () => {
    // O preset segue SEM_ACESSO: nada muda sozinho, nada se abre por acidente.
    expect(PRESETS_PERFIL.COORDENACAO.usuarios).toBe('SEM_ACESSO');
    // Mas agora a matriz do usuário VALE — que é o pedido do relato.
    expect(nivelEfetivo('COORDENACAO' as never, { usuarios: 'EDITAR' }, 'usuarios')).toBe('EDITAR');
    expect(nivelEfetivo('ADVOGADO' as never, { usuarios: 'VISUALIZAR' }, 'usuarios')).toBe(
      'VISUALIZAR',
    );
  });

  /** Cobranças/financeiro eram `@Roles(ADMIN, COORDENACAO)` de classe. */
  it('cobranças passa a seguir a matriz, e o preset não mudou', () => {
    expect(PRESETS_PERFIL.COORDENACAO.cobrancas).toBe('EDITAR');
    expect(PRESETS_PERFIL.ADVOGADO.cobrancas).toBe('SEM_ACESSO');
    expect(PRESETS_PERFIL.TRIAGEM.cobrancas).toBe('SEM_ACESSO');
    // Concedido na matriz, agora funciona — antes o @Roles barrava mesmo assim.
    expect(nivelEfetivo('TRIAGEM' as never, { cobrancas: 'EDITAR' }, 'cobrancas')).toBe('EDITAR');
  });
});
