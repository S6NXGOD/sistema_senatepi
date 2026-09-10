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

function controllers(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return controllers(p);
    return p.endsWith('.controller.ts') ? [p] : [];
  });
}

/**
 * USA O DECORADOR, NAO A PALAVRA — e a primeira versao deste arquivo caiu nisso.
 *
 * `src.includes('@Roles(')` acusou `usuarios.controller.ts`, que nao tem
 * decorador nenhum: tem o COMENTARIO que explica por que o `@Roles` saiu de la.
 * E a quinta vez que uma assercao negativa desta base bate na prosa em portugues
 * em vez do codigo. A regex exige inicio de linha (com indentacao), que e onde um
 * decorador de verdade mora.
 */
const USO_DE_ROLES = /^\s*@Roles\(/m;

const ARQUIVOS = controllers(RAIZ).map((p) => ({
  nome: p.split(/[\\/]/).pop()!,
  caminho: p,
  src: readFileSync(p, 'utf8'),
}));

describe('a matriz é a única política de módulo', () => {
  it('existe controller para auditar (a varredura não deu vazio por engano)', () => {
    expect(ARQUIVOS.length).toBeGreaterThan(20);
    expect(ARQUIVOS.filter((a) => a.src.includes('@Modulo(')).length).toBeGreaterThan(15);
  });

  /**
   * A TRAVA PRINCIPAL. Se alguém acrescentar um `@Roles` num controller que já
   * tem `@Modulo`, este teste falha com o nome do arquivo — antes de virar um
   * "Forbidden resource" que ninguém consegue explicar.
   */
  it('nenhum controller com @Modulo usa @Roles', () => {
    const infratores = ARQUIVOS.filter(
      (a) => a.src.includes('@Modulo(') && USO_DE_ROLES.test(a.src),
    ).map((a) => a.nome);
    expect(infratores).toEqual([]);
  });

  /** Onde não há módulo, `@Roles` continua sendo o gate legítimo. */
  it('@Roles só sobrevive onde não existe @Modulo', () => {
    const comRoles = ARQUIVOS.filter((a) => USO_DE_ROLES.test(a.src)).map((a) => a.nome);
    expect(comRoles).toEqual(['anexos.controller.ts']);
  });

  /**
   * A LISTA CURTA, CONTADA. Três operações que não são "editar o módulo X":
   * varrer o DJEN (queima a cota do CNJ do sindicato), reprocessar o radar
   * inteiro e fundir dois cadastros sem desfazer.
   */
  it('as operações de sistema são exatamente três, e são estas', () => {
    const comDecorador = ARQUIVOS.filter((a) => a.src.includes('@OperacaoDeSistema()'))
      .map((a) => a.nome)
      .sort();
    expect(comDecorador).toEqual([
      'audiencias.controller.ts',
      'djen.controller.ts',
      'partes.controller.ts',
    ]);
    const total = ARQUIVOS.reduce(
      (n, a) => n + (a.src.match(/@OperacaoDeSistema\(\)/g)?.length ?? 0),
      0,
    );
    expect(total).toBe(3);
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
