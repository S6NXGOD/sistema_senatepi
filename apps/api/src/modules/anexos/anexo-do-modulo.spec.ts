import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UserRole } from '@prisma/client';
import {
  exigenciasDoAnexo,
  faltaParaOAnexo,
  fraseDaRecusa,
  type QuemPede,
} from './anexo-do-modulo.regras';
import { PRESETS_PERFIL } from '../../common/permissions/permissoes.constants';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AnexoDoModuloGuard } from './anexo-do-modulo.guard';

/**
 * "UMA ADVOGADA ESTÁ TENTANDO BAIXAR UM DOCUMENTO DE UM FILIADO E RECEBE UMA
 * MENSAGEM DE ERRO." — o dono, 15/10/2026, sobre a Dra. Shérad, na produção.
 *
 * A MATRIZ DELA ESTAVA CERTA, e é a de qualquer advogado: `filiados:
 * VISUALIZAR`, `processos: EDITAR`, `agenda: EDITAR`, `atendimentos:
 * VISUALIZAR`. Reproduzido com essa matriz exata contra a API local, o
 * `POST /anexos/puxar` era recusado nos TRÊS destinos — inclusive no processo
 * e na atividade, onde ela EDITA.
 *
 * A CAUSA: a regra tirava UM nível do verbo HTTP e aplicava a TODOS os módulos
 * citados. Num `puxar`, `filiadoId` só diz **de quem é o acervo LIDO** — nada
 * na ficha do filiado muda —, mas o POST passava a exigir `filiados: EDITAR`.
 * Como nenhum preset de advogado tem isso, **nenhum advogado conseguia puxar
 * documento do acervo**. A função existia desde setembro com ZERO usos, e em
 * 05/10 eu atribuí isso só a falta de peso visual; era também um 403.
 */

/** A matriz REAL da advogada, copiada da produção em 15/10/2026. */
const ADVOGADA: QuemPede = {
  role: UserRole.ADVOGADO,
  permissoes: {
    acessos: 'SEM_ACESSO', agenda: 'EDITAR', atendimentos: 'VISUALIZAR',
    auditoria: 'SEM_ACESSO', cobrancas: 'SEM_ACESSO', colaboradores: 'VISUALIZAR',
    colonia: 'SEM_ACESSO', dashboard: 'VISUALIZAR', empresas: 'SEM_ACESSO',
    escalas: 'VISUALIZAR', eventos: 'SEM_ACESSO', filiados: 'VISUALIZAR',
    organizacoes: 'EDITAR', processos: 'EDITAR', usuarios: 'SEM_ACESSO',
  },
};
/** A Triagem: não vê processo nenhum. */
const TRIAGEM: QuemPede = { role: UserRole.TRIAGEM, permissoes: null };
const ADM: QuemPede = { role: UserRole.ADMINISTRADOR, permissoes: null };

const PROCESSO = { processoId: 'p1' };
const ATENDIMENTO = { atendimentoId: 'a1' };
const ATIVIDADE = { compromissoId: 'c1' };
const ACERVO = { filiadoId: 'f1' };

const bloqueia = (quem: QuemPede, metodo: string, fonte: Record<string, unknown>) =>
  faltaParaOAnexo(quem, exigenciasDoAnexo(metodo, fonte));

describe('a origem é leitura; o destino é que pode ser escrita', () => {
  /** O caso do chamado, exatamente. */
  it('a advogada puxa documento do acervo para o PROCESSO dela', () => {
    expect(bloqueia(ADVOGADA, 'POST', { ...ACERVO, ...PROCESSO })).toBeNull();
  });

  it('e para a ATIVIDADE da agenda também', () => {
    expect(bloqueia(ADVOGADA, 'POST', { ...ACERVO, ...ATIVIDADE })).toBeNull();
  });

  /**
   * MAS NÃO PARA O ATENDIMENTO — e esta recusa é correta: pendurar documento
   * num atendimento é MEXER nele, e o perfil dela é só leitura ali. O que
   * mudou é que agora a recusa fala do módulo certo (atendimentos), não de
   * `filiados`.
   */
  it('e é barrada no ATENDIMENTO, onde ela só visualiza', () => {
    const falta = bloqueia(ADVOGADA, 'POST', { ...ACERVO, ...ATENDIMENTO });
    expect(falta).toEqual({ modulo: 'atendimentos', nivel: 'EDITAR' });
  });

  /**
   * A REGRA VALE PARA O PERFIL INTEIRO, não só para ela: nenhum preset de
   * advogado tem `filiados: EDITAR`, então a regra antiga barrava 100% deles.
   */
  it('nenhum advogado tem filiados: EDITAR — por isso era todo mundo', () => {
    expect(PRESETS_PERFIL.ADVOGADO.filiados).toBe('VISUALIZAR');
    const comPreset: QuemPede = { role: UserRole.ADVOGADO, permissoes: null };
    expect(bloqueia(comPreset, 'POST', { ...ACERVO, ...PROCESSO })).toBeNull();
  });

  /** Ler o acervo nunca exigiu mais que ver o filiado, e continua assim. */
  it('ler o acervo exige só VISUALIZAR em filiados', () => {
    expect(exigenciasDoAnexo('GET', ACERVO)).toEqual([
      { modulo: 'filiados', nivel: 'VISUALIZAR' },
    ]);
    expect(bloqueia(ADVOGADA, 'GET', ACERVO)).toBeNull();
  });

  /** E `filiadoId` NUNCA pede edição, em verbo nenhum — é sempre origem. */
  it.each(['GET', 'POST', 'PATCH', 'PUT'])('%s com filiadoId pede só visualização', (metodo) => {
    const doFiliado = exigenciasDoAnexo(metodo, ACERVO).find((e) => e.modulo === 'filiados');
    expect(doFiliado).toEqual({ modulo: 'filiados', nivel: 'VISUALIZAR' });
  });
});

describe('o destino continua cobrando o que sempre cobrou', () => {
  it('escrever num processo exige EDITAR nele', () => {
    expect(exigenciasDoAnexo('POST', PROCESSO)).toEqual([
      { modulo: 'processos', nivel: 'EDITAR' },
    ]);
  });

  it('ler os anexos de um processo exige VISUALIZAR', () => {
    expect(exigenciasDoAnexo('GET', PROCESSO)).toEqual([
      { modulo: 'processos', nivel: 'VISUALIZAR' },
    ]);
  });

  /** O furo original: a Triagem não enxerga processo e não pode ler os papéis dele. */
  it('a Triagem não lê os documentos de um processo', () => {
    expect(bloqueia(TRIAGEM, 'GET', PROCESSO)).toEqual({
      modulo: 'processos', nivel: 'VISUALIZAR',
    });
  });

  /** Sem pai identificado não há o que exigir — quem recusa depois é o DTO. */
  it('requisição sem pai não inventa exigência', () => {
    expect(exigenciasDoAnexo('POST', {})).toEqual([]);
    expect(bloqueia(TRIAGEM, 'POST', {})).toBeNull();
  });

  it('o Administrador alcança tudo', () => {
    expect(bloqueia(ADM, 'POST', { ...ACERVO, ...PROCESSO, ...ATENDIMENTO })).toBeNull();
  });
});

/**
 * A RECUSA NOMEIA O QUE FALTOU.
 *
 * A frase antiga — "Você não tem permissão para acessar os documentos deste
 * registro." — não diz qual módulo, nem qual nível, nem o que pedir. Foi por
 * isso que o caso chegou como "está dando erro" em vez de "me falta X": nem a
 * advogada nem quem administra tinham como saber qual linha da matriz mexer.
 */
describe('nenhuma recusa é muda', () => {
  it('a frase diz o módulo, como está e o que a ação exige', () => {
    const falta = bloqueia(ADVOGADA, 'POST', { ...ACERVO, ...ATENDIMENTO })!;
    const frase = fraseDaRecusa(ADVOGADA, falta);
    expect(frase).toContain('Triagem / Atendimento');
    expect(frase).toContain('somente visualização');
    expect(frase).toContain('exige edição');
    expect(frase).toContain('Peça a um Administrador');
  });

  it('e distingue "sem acesso" de "só leitura"', () => {
    const falta = bloqueia(TRIAGEM, 'GET', PROCESSO)!;
    expect(fraseDaRecusa(TRIAGEM, falta)).toContain('sem acesso');
    expect(fraseDaRecusa(TRIAGEM, falta)).toContain('exige visualização');
  });
});

/**
 * O UPLOAD É MULTIPART, E O GUARDA NÃO O ENXERGA.
 *
 * Guarda roda ANTES do interceptor, e quem analisa `multipart/form-data` é o
 * `FileInterceptor`: na hora do guarda, `req.body` está VAZIO e o `processoId`
 * do formulário não existe. MEDIDO EM 15/10/2026, antes do conserto: um
 * usuário de TRIAGEM, com `processos: SEM_ACESSO`, subiu um anexo PARA DENTRO
 * de um processo e recebeu **201**.
 *
 * O guarda fechou a LEITURA em setembro e deixou a ESCRITA aberta — que é o
 * lado pior: põe documento no acervo de quem não devia nem olhar. Por isso a
 * rota de upload chama a regra ela mesma, depois do interceptor.
 */
describe('o upload confere a permissão onde dá para conferir', () => {
  const CONTROLLER = readFileSync(join(__dirname, 'anexos.controller.ts'), 'utf8');
  const GUARDA = readFileSync(join(__dirname, 'anexo-do-modulo.guard.ts'), 'utf8');

  it('a rota de upload roda a regra com o DTO já preenchido', () => {
    expect(CONTROLLER).toContain("faltaParaOAnexo(user, exigenciasDoAnexo('POST', { ...dto }))");
    expect(CONTROLLER).toContain('throw new ForbiddenException(fraseDaRecusa(user, falta));');
  });

  /** A mesma função nos dois caminhos: duas cópias divergiriam na primeira mudança. */
  it('guarda e upload usam a MESMA regra', () => {
    for (const fonte of [CONTROLLER, GUARDA]) {
      expect(fonte).toContain("from './anexo-do-modulo.regras'");
      expect(fonte).toContain('faltaParaOAnexo(');
      expect(fonte).toContain('fraseDaRecusa(');
    }
  });

  /** O guarda não decide mais sozinho — se voltar a decidir, as duas divergem. */
  it('o guarda não tem regra própria', () => {
    expect(GUARDA).not.toContain('RANK_NIVEL');
    expect(GUARDA).not.toContain('nivelEfetivo(');
  });
});

/**
 * O QUE O GUARDA ANTIGO JÁ PROTEGIA — devolvido aqui depois de a regra sair
 * dele para `anexo-do-modulo.regras`.
 *
 * Estes casos vinham do spec que fechou o furo de leitura em setembro. Eles
 * continuam valendo palavra por palavra; o que mudou foi ONDE a decisão mora.
 * Perder cobertura numa refatoração é como um conserto vira dois defeitos.
 */
describe('o que já estava protegido continua', () => {
  /** O trabalho da Triagem é o atendimento, e ali ela lê. */
  it('a Triagem lê documento de atendimento', () => {
    expect(bloqueia(TRIAGEM, 'GET', ATENDIMENTO)).toBeNull();
  });

  /** E grava: o balcão anexa o documento que o filiado entregou. */
  it('e grava também', () => {
    expect(bloqueia(TRIAGEM, 'POST', ATENDIMENTO)).toBeNull();
  });

  it('o advogado lê E grava documento de processo', () => {
    expect(bloqueia(ADVOGADA, 'GET', PROCESSO)).toBeNull();
    expect(bloqueia(ADVOGADA, 'POST', PROCESSO)).toBeNull();
  });

  /**
   * COPIAR ENTRE DOIS REGISTROS EXIGE PODER NOS DOIS. Os dois são DESTINO
   * (origem é só `filiadoId`), então os dois cobram EDITAR na escrita — senão
   * a cópia vira a porta que a leitura direta fechou.
   */
  it('com dois destinos, cobra os dois', () => {
    expect(exigenciasDoAnexo('POST', { ...PROCESSO, ...ATIVIDADE })).toEqual([
      { modulo: 'processos', nivel: 'EDITAR' },
      { modulo: 'agenda', nivel: 'EDITAR' },
    ]);
    expect(bloqueia(TRIAGEM, 'POST', { ...PROCESSO, ...ATIVIDADE })).not.toBeNull();
  });

  /** A matriz individual vence o preset do perfil, como em todo o resto. */
  it('a matriz individual vence o preset', () => {
    const triagemComProcessos = {
      role: TRIAGEM.role,
      permissoes: { processos: 'EDITAR' },
    };
    expect(PRESETS_PERFIL.TRIAGEM.processos).toBe('SEM_ACESSO');
    expect(bloqueia(triagemComProcessos, 'POST', PROCESSO)).toBeNull();
  });
});

/**
 * E O GUARDA, que agora só traduz a regra para HTTP.
 */
describe('o guarda liga a regra à requisição', () => {
  const guard = new AnexoDoModuloGuard();
  const contexto = (metodo: string, query: unknown, user: unknown) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ method: metodo, query, body: {}, user }) }),
    }) as unknown as ExecutionContext;

  /** Sem usuário não é trabalho deste guarda: o JwtAuthGuard já barrou antes. */
  it('deixa passar sem usuário', () => {
    expect(guard.canActivate(contexto('GET', { processoId: 'p1' }, null))).toBe(true);
  });

  it('recusa com a frase que nomeia o módulo', () => {
    expect(() => guard.canActivate(contexto('GET', { processoId: 'p1' }, TRIAGEM))).toThrow(
      ForbiddenException,
    );
    try {
      guard.canActivate(contexto('GET', { processoId: 'p1' }, TRIAGEM));
    } catch (e) {
      expect((e as ForbiddenException).message).toContain('Processos');
    }
  });

  /** E o caso do chamado, pelo guarda: a advogada passa. */
  it('a advogada puxa para o processo sem ser barrada', () => {
    expect(
      guard.canActivate(contexto('POST', { filiadoId: 'f1', processoId: 'p1' }, ADVOGADA)),
    ).toBe(true);
  });
});
