import {
  garantirQuePodeAtribuirPerfil,
  garantirQuePodeMexerNoAlvo,
  garantirQueNaoEscalaPrivilegio,
  type Autor,
} from './quem-pode-mexer-em-quem';
import { UserRole } from '@prisma/client';

/**
 * O TETO DO MÓDULO DE USUÁRIOS — testado EXECUTANDO, não lendo o fonte.
 *
 * O módulo deixou de ser trancado no perfil (`@Roles(ADMINISTRADOR)` no
 * controller inteiro, que ignorava a matriz e devolvia "Forbidden resource").
 * Sem teto, `usuarios: EDITAR` não seria "gerenciar usuários" — seria "virar
 * administrador em dois cliques".
 */

const admin: Autor = { id: 'a1', role: UserRole.ADMINISTRADOR };
const coord: Autor = { id: 'c1', role: UserRole.COORDENACAO };
/** Coordenação com auditoria só de leitura — o caso da trava 4. */
const coordLimitada: Autor = {
  id: 'c2',
  role: UserRole.COORDENACAO,
  permissoes: { auditoria: 'VISUALIZAR', processos: 'EDITAR' },
};

describe('trava 1 e 2 — só Administrador cria ou promove Administrador', () => {
  it('o administrador pode', () => {
    expect(() => garantirQuePodeAtribuirPerfil(admin, UserRole.ADMINISTRADOR)).not.toThrow();
  });

  it('a coordenação não pode criar um administrador', () => {
    expect(() => garantirQuePodeAtribuirPerfil(coord, UserRole.ADMINISTRADOR)).toThrow(
      /Apenas um Administrador/i,
    );
  });

  it('mas pode criar os perfis abaixo', () => {
    for (const r of [UserRole.COORDENACAO, UserRole.ADVOGADO, UserRole.TRIAGEM]) {
      expect(() => garantirQuePodeAtribuirPerfil(coord, r)).not.toThrow();
    }
  });

  /** PATCH sem `role` no corpo = "não mexe no perfil"; não há o que checar. */
  it('sem perfil no corpo, não barra nada', () => {
    expect(() => garantirQuePodeAtribuirPerfil(coord, undefined)).not.toThrow();
  });
});

describe('trava 3 — conta de Administrador é intocável para quem está abaixo', () => {
  it('a coordenação não mexe num administrador', () => {
    expect(() => garantirQuePodeMexerNoAlvo(coord, UserRole.ADMINISTRADOR)).toThrow(
      /Contas de Administrador/i,
    );
  });

  it('outro administrador mexe', () => {
    expect(() => garantirQuePodeMexerNoAlvo(admin, UserRole.ADMINISTRADOR)).not.toThrow();
  });

  it('e nos demais perfis a coordenação mexe normalmente', () => {
    for (const r of [UserRole.COORDENACAO, UserRole.ADVOGADO, UserRole.TRIAGEM]) {
      expect(() => garantirQuePodeMexerNoAlvo(coord, r)).not.toThrow();
    }
  });
});

/**
 * A TRAVA QUE FECHA O BURACO DE VERDADE.
 *
 * Sem ela as três primeiras são teatro: a coordenação não cria um
 * "ADMINISTRADOR", mas cria um COORDENACAO com os dezesseis módulos em EDITAR —
 * inclusive `auditoria`, que ela mesma só vê. O rótulo do perfil fica abaixo
 * dela; o PODER, acima.
 */
describe('trava 4 — ninguém concede um nível que não tem', () => {
  it('conceder o que se tem é permitido — é o trabalho', () => {
    expect(() =>
      garantirQueNaoEscalaPrivilegio(coordLimitada, { processos: 'EDITAR' }),
    ).not.toThrow();
    expect(() =>
      garantirQueNaoEscalaPrivilegio(coordLimitada, { auditoria: 'VISUALIZAR' }),
    ).not.toThrow();
  });

  it('conceder acima do próprio nível é barrado, e a mensagem diz onde', () => {
    expect(() =>
      garantirQueNaoEscalaPrivilegio(coordLimitada, { auditoria: 'EDITAR' }),
    ).toThrow(/auditoria/);
  });

  /** O preset entra na conta quando a matriz própria não fala do módulo. */
  it('cai no preset do perfil quando a matriz não define o módulo', () => {
    // COORDENACAO tem `usuarios: SEM_ACESSO` no preset.
    expect(() => garantirQueNaoEscalaPrivilegio(coord, { usuarios: 'EDITAR' })).toThrow(
      /usuarios/,
    );
    // ...e `processos: EDITAR`.
    expect(() => garantirQueNaoEscalaPrivilegio(coord, { processos: 'EDITAR' })).not.toThrow();
  });

  it('o administrador passa por tudo', () => {
    expect(() =>
      garantirQueNaoEscalaPrivilegio(admin, { auditoria: 'EDITAR', usuarios: 'EDITAR' }),
    ).not.toThrow();
  });

  it('sem matriz pedida, não há o que comparar', () => {
    expect(() => garantirQueNaoEscalaPrivilegio(coord, undefined)).not.toThrow();
  });

  /** Autor sem perfil identificado não passa — falha fechada, nunca aberta. */
  it('autor sem perfil é recusado', () => {
    expect(() => garantirQueNaoEscalaPrivilegio({ id: 'x' }, { processos: 'EDITAR' })).toThrow();
  });

  /**
   * O CAMINHO COMPLETO DA ESCALADA, num teste só: a coordenação tenta fabricar
   * um par com poder acima do dela. Cada porta tem de estar fechada.
   */
  it('a escalada por interposta pessoa está fechada nas duas pontas', () => {
    // Pela via do perfil:
    expect(() => garantirQuePodeAtribuirPerfil(coord, UserRole.ADMINISTRADOR)).toThrow();
    // Pela via da matriz:
    expect(() =>
      garantirQueNaoEscalaPrivilegio(coord, { usuarios: 'EDITAR', auditoria: 'EDITAR' }),
    ).toThrow();
  });
});
