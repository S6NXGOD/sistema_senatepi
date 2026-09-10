import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  podeAtribuirPerfilAdmin,
  podeMexerNoUsuario,
  tetoQuePossoConceder,
} from '@/lib/permissoes';

const FORM = readFileSync(join(__dirname, 'usuario-form-modal.tsx'), 'utf8');
const LISTA = readFileSync(
  join(__dirname, '../../app/(dashboard)/usuarios/page.tsx'),
  'utf8',
);

/**
 * A TELA NÃO OFERECE O QUE A API VAI RECUSAR.
 *
 * O relato foi este: o administrador marcou `usuarios: EDITAR` para a
 * coordenação, a tela mostrou "Novo usuário", e o clique voltou **"Forbidden
 * resource"**. O módulo era trancado no perfil por um `@Roles(ADMINISTRADOR)`
 * que a matriz não alcançava.
 *
 * Agora a coordenação entra de verdade — e por isso a tela precisa de teto. A
 * segurança continua sendo do servidor (`quem-pode-mexer-em-quem.ts` na API);
 * isto aqui evita o clique que voltaria 403, que é a mesma classe de defeito
 * que originou tudo.
 */
describe('as regras espelhadas na tela', () => {
  it('só o administrador atribui o perfil de administrador', () => {
    expect(podeAtribuirPerfilAdmin('ADMINISTRADOR')).toBe(true);
    expect(podeAtribuirPerfilAdmin('COORDENACAO')).toBe(false);
    expect(podeAtribuirPerfilAdmin(null)).toBe(false);
  });

  it('conta de administrador só é mexida por administrador', () => {
    expect(podeMexerNoUsuario('COORDENACAO', 'ADMINISTRADOR')).toBe(false);
    expect(podeMexerNoUsuario('ADMINISTRADOR', 'ADMINISTRADOR')).toBe(true);
    // Os demais perfis a coordenação gerencia normalmente.
    expect(podeMexerNoUsuario('COORDENACAO', 'ADVOGADO')).toBe(true);
    expect(podeMexerNoUsuario('COORDENACAO', 'TRIAGEM')).toBe(true);
  });

  /**
   * O TETO POR MÓDULO fecha a escalada por interposta pessoa: sem ele, a
   * coordenação criaria um COORDENACAO com `auditoria: EDITAR` tendo ela mesma
   * só `VISUALIZAR` — perfil abaixo, poder acima.
   */
  it('ninguém oferece um nível maior do que o seu', () => {
    const eu = { auditoria: 'VISUALIZAR' as const };
    expect(tetoQuePossoConceder('COORDENACAO', eu, 'auditoria')).toBe('VISUALIZAR');
    expect(tetoQuePossoConceder('COORDENACAO', eu, 'processos')).toBe('EDITAR');
    // O administrador não tem teto.
    expect(tetoQuePossoConceder('ADMINISTRADOR', {}, 'auditoria')).toBe('EDITAR');
    // Sem perfil identificado, falha fechada.
    expect(tetoQuePossoConceder(null, {}, 'processos')).toBe('SEM_ACESSO');
  });
});

/**
 * DESABILITAR SEM DIZER O PORQUÊ é a mesma doença do "Forbidden resource": a
 * pessoa vê que não pode e não descobre a razão.
 */
describe('a tela explica cada trava', () => {
  it('o cartão do perfil de administrador é vetado, com motivo', () => {
    expect(FORM).toContain("const vetado = p.key === 'ADMINISTRADOR' && !souAdmin;");
    expect(FORM).toContain('Apenas um Administrador pode criar ou promover outro Administrador.');
    expect(FORM).toContain('Só outro Administrador pode atribuir este perfil.');
  });

  it('e há uma frase para quem não é administrador, fora do cartão', () => {
    expect(FORM).toContain('Você pode gerenciar usuários, mas o perfil de Administrador é');
  });

  it('os níveis acima do meu teto ficam indisponíveis, com motivo', () => {
    expect(FORM).toContain('RANK_NIVEL[n] > RANK_NIVEL[tetoDoModulo(mod.key)]');
    expect(FORM).toContain('Você não pode conceder um nível maior do que o seu.');
  });

  it('editar um administrador sem ser um trava a matriz inteira', () => {
    expect(FORM).toContain('const alvoBloqueado =');
    expect(FORM).toContain('disabled={adminLock || acimaDoMeuTeto || alvoBloqueado}');
  });

  /** Na lista, o botão SOME e um rótulo explica a linha — ícone apagado não diz nada. */
  it('a linha de um administrador mostra o motivo no lugar dos botões', () => {
    expect(LISTA).toContain('const intocavel = !podeMexerNoUsuario(');
    expect(LISTA).toContain('Só Administrador');
    expect(LISTA).toContain(
      'Contas de Administrador só podem ser alteradas por outro Administrador.',
    );
  });
});
