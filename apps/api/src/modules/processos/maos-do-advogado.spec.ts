import { ConflictException, ForbiddenException, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { UserRole } from '@prisma/client';
import { MovimentacoesService } from './movimentacoes.service';
import { MovimentacoesController } from './movimentacoes.controller';
import { MODULO_KEY } from '../../common/permissions/modulo.decorator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { atoAcionavel } from './utils/tpu.util';

/**
 * AS DUAS MÃOS DO ADVOGADO SOBRE O ANDAMENTO — 17/09/2026.
 *
 * "Não quero tarefas já com prazo matando o advogado; se for algo urgente,
 * mande um alerta, mas não encha de tarefas desnecessárias."
 *
 * O criador cego foi desligado (48 tarefas, 32 canceladas, 47 nascidas
 * atrasadas). Desligar sozinho seria subtração: o que sobra são 27 atos com
 * selo âmbar em 26 processos, quase todos DECISÕES, e para cada um alguém
 * precisa poder dizer "isto é trabalho" ou "disto eu já cuidei" de onde já
 * está — sem abrir a Agenda e digitar tudo de novo.
 *
 * Este arquivo prova COMPORTAMENTO: prisma falso, agenda falsa, e cada caso
 * reprova se a rota voltar a fazer o que fazia antes.
 */
describe('virar tarefa e "já cuidei" no andamento', () => {
  const AGORA = new Date('2026-09-17T12:00:00.000Z');

  interface LinhaMov {
    id: string;
    descricao: string;
    detalhe: string | null;
    dataMovimento: Date;
    orgaoJulgador: string | null;
    compromissoId: string | null;
    dispensadoEm: Date | null;
    dispensadoPor: string | null;
    comunicacoes: {
      id: string;
      providencia: string | null;
      dataDisponibilizacao: Date;
      prazoMencionadoDias: number | null;
      nomeOrgao: string | null;
      compromissoId: string | null;
    }[];
  }

  const andamento = (over: Partial<LinhaMov> = {}): LinhaMov => ({
    id: 'm1',
    descricao: 'Julgado improcedente o pedido',
    detalhe: null,
    dataMovimento: new Date('2026-09-15T13:00:00.000Z'),
    orgaoJulgador: '1ª Vara do Trabalho de Teresina',
    compromissoId: null,
    dispensadoEm: null,
    dispensadoPor: null,
    comunicacoes: [],
    ...over,
  });

  const publicacao = (over: Partial<LinhaMov['comunicacoes'][number]> = {}) => ({
    id: 'c1',
    providencia: 'AVALIAR_RECURSO',
    dataDisponibilizacao: new Date('2026-09-14T00:00:00.000Z'),
    prazoMencionadoDias: null,
    nomeOrgao: 'TRT da 22ª Região',
    compromissoId: null,
    ...over,
  });

  const processo = { id: 'p1', numeroCNJ: '00013819120235220101', filiadoId: 'f1' };

  function montar(linha: LinhaMov) {
    const movUpdates: Record<string, unknown>[] = [];
    const comUpdates: Record<string, unknown>[] = [];
    const deletes: string[] = [];
    const criadas: Record<string, unknown>[] = [];
    const auditados: Record<string, unknown>[] = [];

    const prisma = {
      movimentacaoProcessual: {
        findUnique: jest.fn(async () => (linha ? { ...linha, processo } : null)),
        update: jest.fn(async ({ where, data }: any) => {
          movUpdates.push({ ...where, ...data });
          Object.assign(linha, data);
          return {};
        }),
        delete: jest.fn(async ({ where }: any) => {
          deletes.push(where.id);
          return {};
        }),
      },
      comunicacaoDjen: {
        update: jest.fn(async ({ where, data }: any) => {
          comUpdates.push({ ...where, ...data });
          return {};
        }),
      },
    };

    const agenda = {
      criar: jest.fn(async (dto: Record<string, unknown>) => {
        criadas.push(dto);
        return { id: `k${criadas.length}` };
      }),
    };
    const audit = {
      registrar: jest.fn(async (r: Record<string, unknown>) => {
        auditados.push(r);
      }),
    };

    const svc = new MovimentacoesService(
      prisma as never,
      audit as never,
      {} as never,
      agenda as never,
    );
    return { svc, prisma, agenda, criadas, movUpdates, comUpdates, deletes, auditados };
  }

  const ctx = { userId: 'u-murilo', ip: '1.1.1.1', userAgent: 'jest' };

  // -------------------------------------------------------------------------
  // "Virar tarefa"
  // -------------------------------------------------------------------------

  it('cria a atividade pela Agenda, com o dono sendo quem clicou', async () => {
    const { svc, criadas, agenda } = montar(andamento());
    const r = await svc.virarTarefa('m1', ctx);

    expect(agenda.criar).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ compromissoId: 'k1', criada: true });
    expect(criadas[0]).toMatchObject({
      responsavelId: 'u-murilo',
      processoId: 'p1',
      filiadoId: 'f1',
    });
    // Nunca no passado: a atividade nasce no próximo horário útil.
    expect(new Date(criadas[0].inicio as string).getTime()).toBeGreaterThan(Date.now());
  });

  /**
   * O PLANO É O DO DIÁRIO. Com teor casado, o título sai da providência lida
   * no texto — e não de um "Verificação de Intimação / Prazo" genérico, que é
   * o que o robô cego escrevia em 48 tarefas por não saber o que o ato pedia.
   */
  it('com teor do Diário, o plano vem da providência da publicação', async () => {
    const { svc, criadas } = montar(andamento({ comunicacoes: [publicacao()] }));
    await svc.virarTarefa('m1', ctx);
    expect(criadas[0].titulo).toBe('Avaliar recurso');
    expect(criadas[0].tipo).toBe('PRAZO');
  });

  it('sem teor, cai na providência genérica — e diz na descrição que o teor não veio', async () => {
    const { svc, criadas } = montar(andamento());
    await svc.virarTarefa('m1', ctx);
    expect(criadas[0].titulo).toBe('Analisar intimação');
    expect(String(criadas[0].descricao)).toContain('não informou o teor');
    // O ato fica escrito na atividade: quem abrir a agenda amanhã não precisa
    // voltar à ficha para saber de onde isto veio.
    expect(String(criadas[0].descricao)).toContain('Julgado improcedente o pedido');
  });

  /** Publicação que não pede nada ("Lista de distribuição") não vira o plano. */
  it('teor sem providência não manda no plano', async () => {
    const { svc, criadas } = montar(
      andamento({ comunicacoes: [publicacao({ providencia: 'NENHUMA' })] }),
    );
    await svc.virarTarefa('m1', ctx);
    expect(criadas[0].titulo).toBe('Analisar intimação');
  });

  it('carimba o vínculo na movimentação e limpa dispensa antiga', async () => {
    const { svc, movUpdates } = montar(
      andamento({ dispensadoEm: new Date('2026-09-16T10:00:00.000Z'), dispensadoPor: null }),
    );
    await svc.virarTarefa('m1', ctx);
    expect(movUpdates).toEqual([
      {
        id: 'm1',
        compromissoId: 'k1',
        dispensadoEm: null,
        dispensadoPor: null,
        dispensadoMotivo: null,
      },
    ]);
  });

  /**
   * O SEGUNDO TOQUE É A COISA MAIS PROVÁVEL DE ACONTECER num botão de lista.
   * Sem a trava, o mesmo ato rendia duas atividades para a mesma pessoa.
   */
  it('dois toques não criam duas atividades', async () => {
    const linha = andamento();
    const { svc, agenda } = montar(linha);
    const primeira = await svc.virarTarefa('m1', ctx);
    const segunda = await svc.virarTarefa('m1', ctx);

    expect(agenda.criar).toHaveBeenCalledTimes(1);
    expect(segunda).toEqual({ compromissoId: primeira.compromissoId, criada: false });
  });

  /**
   * O MESMO FATO NÃO PODE FICAR PENDENTE DOS DOIS LADOS: sem isto, a caixa de
   * propostas continuaria oferecendo a publicação e o painel do Diário
   * continuaria marcando-a como "sem tarefa" depois de o trabalho ter dono.
   */
  it('a publicação do mesmo ato fica resolvida, com a decisão de gente carimbada', async () => {
    const { svc, comUpdates } = montar(andamento({ comunicacoes: [publicacao()] }));
    await svc.virarTarefa('m1', ctx);
    expect(comUpdates).toEqual([
      {
        id: 'c1',
        compromissoId: 'k1',
        tarefaDecididaEm: expect.any(Date),
        tarefaDecididaPor: 'u-murilo',
      },
    ]);
  });

  it('publicação que já tem a sua tarefa não é reescrita', async () => {
    const { svc, comUpdates } = montar(
      andamento({ comunicacoes: [publicacao({ compromissoId: 'k-antiga' })] }),
    );
    await svc.virarTarefa('m1', ctx);
    expect(comUpdates).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // "Já cuidei"
  // -------------------------------------------------------------------------

  it('grava a dispensa com autor e motivo — e não apaga o andamento', async () => {
    const { svc, movUpdates, deletes, prisma } = montar(andamento());
    const r = await svc.jaCuidei('m1', '  o prazo é da outra parte  ', ctx);

    expect(r).toMatchObject({ ok: true, dispensado: true });
    expect(movUpdates).toEqual([
      {
        id: 'm1',
        dispensadoEm: expect.any(Date),
        dispensadoPor: 'u-murilo',
        dispensadoMotivo: 'o prazo é da outra parte',
      },
    ]);
    expect(deletes).toHaveLength(0);
    expect(prisma.movimentacaoProcessual.delete).not.toHaveBeenCalled();
  });

  it('o motivo é opcional — dizer "já cuidei" não pode virar formulário', async () => {
    const { svc, movUpdates } = montar(andamento());
    await svc.jaCuidei('m1', undefined, ctx);
    expect(movUpdates[0].dispensadoMotivo).toBeNull();
  });

  /**
   * A VOLTA EXISTE — o par que o radar de audiências sempre teve.
   *
   * Sem ela, o toque errado no celular apagava o selo âmbar sem conserto em
   * produto: a faixa verde substitui os botões e `atoAcionavel` cala o aviso.
   */
  it('desfazer o "já cuidei" limpa as três colunas de gente', async () => {
    const { svc, movUpdates } = montar(
      andamento({ dispensadoEm: new Date(AGORA.getTime() - 3_600_000), dispensadoPor: 'u-murilo' }),
    );
    await expect(svc.desfazerJaCuidei('m1', ctx)).resolves.toEqual({ ok: true, dispensado: false });
    expect(movUpdates).toEqual([
      { id: 'm1', dispensadoEm: null, dispensadoPor: null, dispensadoMotivo: null },
    ]);
  });

  it('desfazer o que ninguém marcou é recusado, e não escreve nada', async () => {
    const { svc, movUpdates } = montar(andamento());
    await expect(svc.desfazerJaCuidei('m1', ctx)).rejects.toBeInstanceOf(ConflictException);
    expect(movUpdates).toHaveLength(0);
  });

  /** Se o ato já virou atividade, a volta é pela Agenda — e a mensagem diz isso. */
  it('com atividade criada, desfazer manda para a Agenda', async () => {
    const { svc } = montar(
      andamento({ compromissoId: 'k9', dispensadoEm: new Date(), dispensadoPor: 'u-murilo' }),
    );
    await expect(svc.desfazerJaCuidei('m1', ctx)).rejects.toThrow(/Agenda/);
  });

  /** Quem desfaz não precisa ser quem marcou — o histórico guarda os dois nomes. */
  it('outra pessoa da equipe pode desfazer', async () => {
    const { svc, movUpdates } = montar(
      andamento({ dispensadoEm: new Date(), dispensadoPor: 'u-outra-pessoa' }),
    );
    await expect(svc.desfazerJaCuidei('m1', ctx)).resolves.toMatchObject({ dispensado: false });
    expect(movUpdates).toHaveLength(1);
  });

  /** A dispensa apaga o selo âmbar — é a mesma porta que a lista e a ficha leem. */
  it('depois da dispensa, o ato deixa de ser acionável', () => {
    const ato = {
      codigoMovimento: 219,
      dataMovimento: new Date(AGORA.getTime() - 2 * 86_400_000),
      compromissoId: null,
      dispensadoEm: null as Date | null,
    };
    expect(atoAcionavel(ato, AGORA)).not.toBeNull();
    expect(atoAcionavel({ ...ato, dispensadoEm: AGORA }, AGORA)).toBeNull();
  });

  it('recusa quando o andamento já virou tarefa', async () => {
    const { svc } = montar(andamento({ compromissoId: 'k9' }));
    await expect(svc.jaCuidei('m1', undefined, ctx)).rejects.toBeInstanceOf(ConflictException);
  });

  it('recusa quando OUTRA PESSOA já cuidou', async () => {
    const { svc } = montar(
      andamento({ dispensadoEm: new Date(), dispensadoPor: 'u-morgana' }),
    );
    await expect(svc.jaCuidei('m1', undefined, ctx)).rejects.toBeInstanceOf(ConflictException);
  });

  /**
   * O andamento que o robô venha a carimbar nas colunas de gente, em
   * 17/09/2026, ficaram sem autor. Travar por causa deles seria deixar a mão de
   * gente de fora justamente onde o defeito aconteceu.
   */
  it('carimbo sem autor (do robô) não trava a decisão de gente', async () => {
    const { svc, movUpdates } = montar(
      andamento({ dispensadoEm: new Date('2026-09-17T09:00:00.000Z'), dispensadoPor: null }),
    );
    await svc.jaCuidei('m1', 'já protocolei', ctx);
    expect(movUpdates[0]).toMatchObject({ dispensadoPor: 'u-murilo', dispensadoMotivo: 'já protocolei' });
  });

  /** Toda decisão fica na trilha — sem ela, "quem resolveu isto?" não tem resposta. */
  it('as duas ações ficam auditadas', async () => {
    const a = montar(andamento());
    await a.svc.virarTarefa('m1', ctx);
    expect(a.auditados[0]).toMatchObject({ entidade: 'MovimentacaoProcessual', entidadeId: 'm1', userId: 'u-murilo' });

    const b = montar(andamento());
    await b.svc.jaCuidei('m1', 'resolvido no balcão', ctx);
    expect(String(b.auditados[0].descricao)).toContain('já cuidado');
  });
});

/**
 * A MATRIZ É A ÚNICA POLÍTICA — e a Agenda tem a sua própria porta.
 */
describe('as rotas das duas mãos', () => {
  const proto = MovimentacoesController.prototype as any;

  it('ficam sob o módulo "processos" e sem @Roles', () => {
    expect(Reflect.getMetadata(MODULO_KEY, MovimentacoesController)).toBe('processos');
    expect(Reflect.getMetadata(ROLES_KEY, MovimentacoesController)).toBeUndefined();
    expect(Reflect.getMetadata(ROLES_KEY, proto.virarTarefa)).toBeUndefined();
    expect(Reflect.getMetadata(ROLES_KEY, proto.jaCuidei)).toBeUndefined();
  });

  /**
   * "Já cuidei" muda o ESTADO do aviso; o ato do tribunal continua na linha do
   * tempo. DELETE seria outra coisa — e só Administrador poderia usá-la.
   */
  it('são POST, nunca DELETE, e não colidem com a rota do processo', () => {
    expect(Reflect.getMetadata(METHOD_METADATA, proto.virarTarefa)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(METHOD_METADATA, proto.jaCuidei)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(PATH_METADATA, proto.virarTarefa)).toBe('movimentacoes/:movId/tarefa');
    expect(Reflect.getMetadata(PATH_METADATA, proto.jaCuidei)).toBe('movimentacoes/:movId/ja-cuidei');
  });

  /**
   * Criar atividade é escrita na AGENDA, e o `@Modulo` do controller só
   * responde por Processos. Sem esta checagem, a tela ofereceria um botão que a
   * API recusaria depois do clique.
   */
  it('"Virar tarefa" exige permissão de editar a Agenda', () => {
    const chamadas: string[] = [];
    const service = {
      virarTarefa: async (id: string) => {
        chamadas.push(id);
        return { compromissoId: 'k1', criada: true };
      },
      jaCuidei: async () => ({ ok: true }),
    };
    const controller = new MovimentacoesController(service as never);
    const req = { ip: '1.1.1.1', headers: {} } as never;

    const soLeitura = { id: 'u1', role: UserRole.ADVOGADO, permissoes: { processos: 'EDITAR', agenda: 'VISUALIZAR' } };
    expect(() => controller.virarTarefa('m1', soLeitura as never, req)).toThrow(ForbiddenException);
    expect(chamadas).toHaveLength(0);

    const completo = { id: 'u1', role: UserRole.ADVOGADO, permissoes: { processos: 'EDITAR', agenda: 'EDITAR' } };
    controller.virarTarefa('m1', completo as never, req);
    expect(chamadas).toEqual(['m1']);
  });

  /** Dizer "já cuidei" não escreve na Agenda — e não pode exigir permissão dela. */
  it('"Já cuidei" não exige a Agenda', () => {
    const service = { jaCuidei: jest.fn(async () => ({ ok: true })) };
    const controller = new MovimentacoesController(service as never);
    const req = { ip: '1.1.1.1', headers: {} } as never;
    const semAgenda = { id: 'u1', role: UserRole.ADVOGADO, permissoes: { processos: 'EDITAR', agenda: 'SEM_ACESSO' } };

    controller.jaCuidei('m1', { motivo: 'resolvido' }, semAgenda as never, req);
    expect(service.jaCuidei).toHaveBeenCalled();
  });
});
