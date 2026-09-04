import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AnexoDoModuloGuard } from './anexo-do-modulo.guard';

/**
 * O ANEXO HERDA A PERMISSÃO DE QUEM O SEGURA.
 *
 * O controller de anexos carrega `@Roles` dos quatro perfis, o que na prática é
 * "qualquer pessoa autenticada" — e tinha de ser, porque o anexo não tem módulo
 * fixo: ele pendura em atendimento, processo ou atividade. O buraco: a Triagem
 * tem `processos: SEM_ACESSO` e não vê a lista de processos, mas
 * `GET /anexos?processoId=X` devolvia os documentos do processo assim mesmo —
 * petição, laudo, acordo.
 */
const contexto = (
  metodo: string,
  dados: Record<string, unknown>,
  user: { role: UserRole; permissoes?: unknown } | null,
) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({
        method: metodo,
        query: dados,
        body: {},
        user: user ? { id: 'u1', email: 'a@b.c', nome: 'Teste', ...user } : undefined,
      }),
    }),
  }) as unknown as ExecutionContext;

const guard = new AnexoDoModuloGuard();

describe('anexo herda a permissão do pai', () => {
  /** O caso que abriu o furo. */
  it('Triagem não lê documento de processo', () => {
    expect(() =>
      guard.canActivate(contexto('GET', { processoId: 'p1' }, { role: UserRole.TRIAGEM })),
    ).toThrow(ForbiddenException);
  });

  it('mas lê documento de atendimento, que é o trabalho dela', () => {
    expect(
      guard.canActivate(contexto('GET', { atendimentoId: 'a1' }, { role: UserRole.TRIAGEM })),
    ).toBe(true);
  });

  it('o advogado lê e grava documento de processo', () => {
    expect(
      guard.canActivate(contexto('GET', { processoId: 'p1' }, { role: UserRole.ADVOGADO })),
    ).toBe(true);
    expect(
      guard.canActivate(contexto('POST', { processoId: 'p1' }, { role: UserRole.ADVOGADO })),
    ).toBe(true);
  });

  /**
   * LER E GRAVAR SÃO NÍVEIS DIFERENTES, como no resto do sistema. A Triagem tem
   * `agenda: VISUALIZAR`: abre o documento da atividade e não anexa outro.
   */
  it('separa ler de gravar', () => {
    expect(
      guard.canActivate(contexto('GET', { compromissoId: 'c1' }, { role: UserRole.TRIAGEM })),
    ).toBe(true);
    expect(() =>
      guard.canActivate(contexto('POST', { compromissoId: 'c1' }, { role: UserRole.TRIAGEM })),
    ).toThrow(ForbiddenException);
  });

  /**
   * PUXAR DO ACERVO cita origem e destino na mesma chamada. Exigir permissão só
   * no destino faria a cópia virar a porta que a leitura direta fechou: a
   * Triagem puxaria o documento do processo para uma atividade e o leria lá.
   */
  it('exige permissão nos DOIS lados ao puxar', () => {
    expect(() =>
      guard.canActivate(
        contexto('POST', { processoId: 'p1', compromissoId: 'c1' }, { role: UserRole.TRIAGEM }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('a matriz individual vence o preset do perfil', () => {
    // Triagem com processos liberado na mão passa a ler.
    expect(
      guard.canActivate(
        contexto('GET', { processoId: 'p1' }, {
          role: UserRole.TRIAGEM,
          permissoes: { processos: 'VISUALIZAR' },
        }),
      ),
    ).toBe(true);
    // E advogado com processos revogado deixa de ler.
    expect(() =>
      guard.canActivate(
        contexto('GET', { processoId: 'p1' }, {
          role: UserRole.ADVOGADO,
          permissoes: { processos: 'SEM_ACESSO' },
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('administrador passa em tudo', () => {
    expect(
      guard.canActivate(contexto('POST', { processoId: 'p1' }, { role: UserRole.ADMINISTRADOR })),
    ).toBe(true);
  });

  /**
   * Sem pai na requisição o guard não inventa proibição — o DTO recusa depois
   * com "informe atendimentoId, processoId ou compromissoId", que é a mensagem
   * certa. Guard que devolve 403 para requisição malformada esconde o erro real.
   */
  it('não julga requisição sem pai', () => {
    expect(guard.canActivate(contexto('GET', {}, { role: UserRole.TRIAGEM }))).toBe(true);
  });

  /** Sem usuário, quem barra é o JwtAuthGuard, antes daqui. */
  it('deixa passar sem usuário', () => {
    expect(guard.canActivate(contexto('GET', { processoId: 'p1' }, null))).toBe(true);
  });
});
