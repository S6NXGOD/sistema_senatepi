import {
  AutomacaoPrazosService,
  MOTIVOS_DO_ROBO,
  type MotivoDoRobo,
} from './automacao-prazos.service';
import { DIAS_ATO_RECENTE } from './utils/janela-do-robo.util';

/**
 * "NÃO QUERO TAREFAS JÁ COM PRAZO MATANDO O ADVOGADO; SE FOR ALGO URGENTE,
 * MANDE UM ALERTA, MAS NÃO ENCHA DE TAREFAS DESNECESSÁRIAS." — 17/09/2026.
 *
 * O CAMINHO CEGO PAROU DE CRIAR TAREFA, SEMPRE — e não só quando o ato é velho.
 *
 * Aqui o robô não tem o TEOR: o DataJud entrega o rótulo ("Publicação",
 * "Expedição de documento") e deixa `conteudo` nulo. Ele não sabe o que foi
 * pedido, de quem é o prazo, nem se há prazo. O que ele conseguia escrever era
 * "abra o PJe e descubra" — e a produção respondeu: das 48 "Verificação de
 * Intimação / Prazo", 32 CANCELADAS (67%), 11 concluídas (9 com desfecho
 * PRAZO_SEM_PECA, isto é, "não havia peça a fazer"), 5 pendentes, 47 nascidas
 * atrasadas. No acervo inteiro do robô, 45 de 89 canceladas.
 *
 * O contraexemplo, no mesmo banco: "Cadastrar ação do Diário" — 12 criadas, 12
 * concluídas em zero dia, nenhuma cancelada. Ela diz exatamente o que fazer.
 *
 * O que fica no lugar é o CARIMBO: a decisão do robô gravada com motivo, em
 * colunas próprias, para que "sem tarefa" nunca signifique "o robô falhou".
 */
describe('o caminho cego avalia e carimba, e nunca cria tarefa', () => {
  const processo = {
    id: 'p1',
    numeroCNJ: '00013819120235220101',
    advogadoId: 'u1',
    filiadoId: null,
    filiado: null,
  };

  const movimentacao = (diasAtras: number) => ({
    id: 'm1',
    descricao: 'Publicação',
    detalhe: null,
    conteudo: null,
    codigoMovimento: 1061,
    complementos: null,
    compromissoId: null,
    dataMovimento: new Date(Date.now() - diasAtras * 86_400_000),
  });

  function montar() {
    const criados: Record<string, unknown>[] = [];
    const carimbos: Record<string, unknown>[] = [];
    const prisma = {
      compromisso: {
        findFirst: jest.fn(async () => null),
        findMany: jest.fn(async () => []),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          criados.push(data);
          return { id: 'k1' };
        }),
        update: jest.fn(async () => ({})),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
      movimentacaoProcessual: {
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          criados.push({ __updateDaMovimentacao: data });
          return {};
        }),
        updateMany: jest.fn(
          async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
            carimbos.push({ where, data });
            return { count: 1 };
          },
        ),
      },
    };
    const svc = new AutomacaoPrazosService(prisma as never, {} as never);
    const avaliar = (mov: ReturnType<typeof movimentacao>) =>
      (svc as unknown as {
        avaliarPrazo: (m: typeof mov) => Promise<{ motivo: MotivoDoRobo; gravou: number }>;
      }).avaliarPrazo(mov);
    return { avaliar, criados, carimbos, prisma };
  }

  it('ato RECENTE também não vira tarefa — o motivo é não haver teor', async () => {
    const { avaliar, criados, carimbos } = montar();
    await expect(avaliar(movimentacao(2))).resolves.toMatchObject({ motivo: MOTIVOS_DO_ROBO.SEM_TEOR_NO_DATAJUD });
    expect(criados).toHaveLength(0);
    expect(carimbos).toHaveLength(1);
    expect(carimbos[0].data).toEqual({
      avaliadoEm: expect.any(Date),
      avaliadoPor: null,
      avaliadoMotivo: MOTIVOS_DO_ROBO.SEM_TEOR_NO_DATAJUD,
    });
  });

  it('ato de 30 dias: sem tarefa, e o motivo diz que já passou', async () => {
    const { avaliar, criados, carimbos } = montar();
    await expect(avaliar(movimentacao(30))).resolves.toMatchObject({ motivo: MOTIVOS_DO_ROBO.ANDAMENTO_ANTIGO });
    expect(criados).toHaveLength(0);
    expect(carimbos[0].data).toMatchObject({
      avaliadoMotivo: MOTIVOS_DO_ROBO.ANDAMENTO_ANTIGO,
    });
  });

  /**
   * A FRONTEIRA É A MESMA DA URGÊNCIA (`DIAS_ATO_RECENTE`): até ali o prazo
   * processual pode estar correndo; depois, não. Duas réguas para a mesma
   * pergunta seria a receita de "urgente sem tarefa".
   */
  it(`em ${DIAS_ATO_RECENTE} dias ainda é notícia; em ${DIAS_ATO_RECENTE + 1} já é história`, async () => {
    const dentro = montar();
    await expect(dentro.avaliar(movimentacao(DIAS_ATO_RECENTE))).resolves.toMatchObject({
      motivo: MOTIVOS_DO_ROBO.SEM_TEOR_NO_DATAJUD,
    });
    const fora = montar();
    await expect(fora.avaliar(movimentacao(DIAS_ATO_RECENTE + 1))).resolves.toMatchObject({
      motivo: MOTIVOS_DO_ROBO.ANDAMENTO_ANTIGO,
    });
  });

  /**
   * REAVALIAÇÃO NÃO É DECISÃO NOVA — e o log noturno conta decisão.
   *
   * O ato de prazo não sai mais da fila da varredura: o carimbo mora em
   * `avaliado*` e o pré-filtro olha `compromissoId`/`dispensadoEm`. Ele volta
   * toda noite. Se o resumo somasse a passada, o log repetiria os mesmos N para
   * sempre — e quem lesse contaria reavaliação como trabalho novo. É a mesma
   * aritmética que já produziu 1.243 falsos positivos nesta base.
   */
  it('quando o carimbo já estava lá, o resumo não conta de novo', async () => {
    const { avaliar, prisma } = montar();
    (prisma.movimentacaoProcessual.updateMany as jest.Mock).mockResolvedValueOnce({ count: 0 });
    await expect(avaliar(movimentacao(2))).resolves.toMatchObject({ gravou: 0 });
  });

  /**
   * O CARIMBO NUNCA ENCOSTA NAS COLUNAS DA PESSOA — é o erro de 17/09/2026.
   *
   * `dispensadoEm/Por/Motivo` são a dispensa humana do radar, e `atoAcionavel`
   * apaga o selo âmbar quando vê `dispensadoEm`. Escrever ali troca tarefa
   * inútil por silêncio, que é o pior dos dois.
   */
  it('nunca escreve nas colunas de dispensa humana', async () => {
    const { avaliar, carimbos, prisma } = montar();
    await avaliar(movimentacao(40));
    for (const c of carimbos) {
      const data = c.data as Record<string, unknown>;
      expect(data).not.toHaveProperty('dispensadoEm');
      expect(data).not.toHaveProperty('dispensadoPor');
      expect(data).not.toHaveProperty('dispensadoMotivo');
    }
    // E não passa por `update`, que não tem a condição que protege a data.
    expect(prisma.movimentacaoProcessual.update).not.toHaveBeenCalled();
  });

  it('o carimbo é do ROBÔ: nunca inventa um autor humano', async () => {
    const { avaliar, carimbos } = montar();
    await avaliar(movimentacao(45));
    expect((carimbos[0].data as Record<string, unknown>).avaliadoPor).toBeNull();
  });

  /**
   * NÃO CARIMBA `compromissoId`, e isso é de propósito.
   *
   * `compromissoId` significa "este ato virou atividade" e é o que apaga o selo
   * âmbar em `atoAcionavel`. Sem tarefa nenhuma, carimbá-lo seria mentir — e
   * apagaria justamente o aviso que substituiu a tarefa.
   */
  it('não finge que o ato virou atividade', async () => {
    const { avaliar, carimbos } = montar();
    await avaliar(movimentacao(3));
    expect(carimbos[0].data).not.toHaveProperty('compromissoId');
  });

  /**
   * A VARREDURA REENCONTRA O ATO TODA NOITE — o pré-filtro só exclui a dispensa
   * de gente. Sem condição no `updateMany`, a data da decisão viraria a data da
   * última varredura, e o carimbo deixaria de responder "quando o robô decidiu".
   */
  it('a regravação é condicionada: o carimbo velho não é sobrescrito à toa', async () => {
    const { avaliar, carimbos } = montar();
    await avaliar(movimentacao(3));
    const where = carimbos[0].where as { id: string; AND: { OR: Record<string, unknown>[] }[] };
    expect(where.id).toBe('m1');
    /*
      Os filtros vão em `AND` porque dois `OR` no mesmo objeto se sobrescrevem
      no Prisma: o segundo apaga o primeiro, em silêncio. O primeiro braço é o
      da regravação; o segundo protege a leitura do teor (caso logo abaixo).
    */
    expect(where.AND[0].OR).toEqual(
      expect.arrayContaining([
        { avaliadoEm: null },
        // `{ not: X }` NÃO casa linha nula no Prisma — sem este braço, a linha
        // com motivo vazio nunca seria corrigida.
        { avaliadoMotivo: null },
        { avaliadoMotivo: { not: MOTIVOS_DO_ROBO.SEM_TEOR_NO_DATAJUD } },
      ]),
    );
  });

  /**
   * O VOCABULÁRIO É FECHADO, e `TEOR_NO_DIARIO` é da outra frente.
   *
   * Ele fica exportado e documentado aqui porque um vocabulário só tem de ter um
   * dono só — mas quem carimba é o casamento DataJud × DJEN, não este caminho.
   */
  it('o caminho cego só usa os dois motivos que ele sabe justificar', async () => {
    for (const dias of [0, 1, 7, 14, 15, 16, 29, 30, 120]) {
      const { avaliar } = montar();
      const { motivo } = await avaliar(movimentacao(dias));
      expect([MOTIVOS_DO_ROBO.SEM_TEOR_NO_DATAJUD, MOTIVOS_DO_ROBO.ANDAMENTO_ANTIGO]).toContain(motivo);
      expect(motivo).not.toBe(MOTIVOS_DO_ROBO.TEOR_NO_DIARIO);
    }
  });

  /**
   * O ROBÔ CEGO NÃO APAGA A LEITURA DO TEOR — e este é o caso que a varredura
   * repetia toda noite.
   *
   * Quando o Diário chega e a publicação é dispensada (ordem da outra parte,
   * cópia do mesmo ato, sem providência), a correlação carimba o andamento com
   * `TEOR_NO_DIARIO` e NÃO grava `compromissoId`. O andamento continua no
   * pré-filtro da varredura — e sem esta trava o caminho cego reescreveria o
   * carimbo com "o tribunal não disse o que o ato pede", que é o sistema
   * apagando o que sabe para afirmar o que não sabe.
   */
  it('não sobrescreve o carimbo de quem leu o teor', async () => {
    const { avaliar, carimbos } = montar();
    await avaliar(movimentacao(2));
    const where = carimbos[0].where as { AND: { OR: Record<string, unknown>[] }[] };
    expect(where.AND).toHaveLength(2);
    expect(where.AND[1].OR).toEqual([
      { avaliadoMotivo: null },
      { avaliadoMotivo: { not: MOTIVOS_DO_ROBO.TEOR_NO_DIARIO } },
    ]);
  });
});

/**
 * O QUE **NÃO** PODE SUMIR JUNTO.
 *
 * O pedido foi contra tarefa inútil, não contra a automação. A pauta, o preparo,
 * o aviso ao filiado e a confirmação de data têm dono e data conhecidos, e 100%
 * de aproveitamento — apagá-los junto seria trocar um problema por outro pior,
 * porque perder audiência é revelia.
 */
describe('a pauta continua virando trabalho de verdade', () => {
  function montar(overrides: { pautaExistente?: string | null } = {}) {
    const criados: Record<string, unknown>[] = [];
    const prisma = {
      compromisso: {
        findFirst: jest.fn(async () =>
          overrides.pautaExistente ? { id: overrides.pautaExistente } : null,
        ),
        findMany: jest.fn(async () => []),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          criados.push(data);
          return { id: `k${criados.length}` };
        }),
        update: jest.fn(async () => ({})),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
      movimentacaoProcessual: {
        update: jest.fn(async () => ({})),
        // Carimbo NOVO: uma linha escrita — é o que o resumo da noite conta.
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      user: {
        findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => ({
          id: where.role === 'TRIAGEM' ? 'sec1' : 'u1',
        })),
      },
      processo: {
        findUnique: jest.fn(async () => ({
          id: 'p1',
          numeroCNJ: '00013819120235220101',
          advogadoId: 'u1',
          filiadoId: 'f1',
          filiado: { nomeCompleto: 'Maria das Dores' },
        })),
      },
    };
    const svc = new AutomacaoPrazosService(prisma as never, {} as never);
    return { svc, criados, prisma };
  }

  /** Audiência daqui a 20 dias: dá tempo de preparar e de avisar. */
  const pauta = () => {
    const quando = new Date(Date.now() + 20 * 86_400_000);
    quando.setUTCHours(17, 0, 0, 0);
    return [
      {
        id: 'm9',
        descricao: `Audiência de Conciliação designada para o dia ${String(quando.getUTCDate()).padStart(2, '0')}/${String(quando.getUTCMonth() + 1).padStart(2, '0')}/${quando.getUTCFullYear()} às 14:00`,
        detalhe: null,
        conteudo: null,
        codigoMovimento: 11025,
        complementos: null,
        compromissoId: null,
        dataMovimento: new Date(),
        ehAudiencia: true,
      },
    ];
  };

  it('agenda a audiência, o preparo e o aviso ao filiado', async () => {
    const { svc, criados } = montar();
    const resumo = await svc.processar('p1', pauta() as never);
    expect(resumo.audiencias).toBe(1);
    const titulos = criados.map((c) => String(c.titulo));
    expect(titulos).toContain('Audiência — Maria das Dores');
    expect(titulos.some((t) => t.startsWith('Preparar audiência'))).toBe(true);
    expect(titulos.some((t) => t.startsWith('Avisar filiado'))).toBe(true);
  });

  it('o ato de prazo do mesmo lote é carimbado, e nada vira tarefa de prazo', async () => {
    const { svc, criados, prisma } = montar();
    const lote = [
      ...pauta(),
      {
        id: 'm1',
        descricao: 'Publicação',
        detalhe: null,
        conteudo: null,
        codigoMovimento: 1061,
        complementos: null,
        compromissoId: null,
        dataMovimento: new Date(),
      },
    ];
    const resumo = await svc.processar('p1', lote as never);
    expect(resumo.avaliadosSemTarefa).toBe(1);
    expect(criados.map((c) => String(c.titulo))).not.toContain('Verificação de Intimação / Prazo');
    expect(prisma.movimentacaoProcessual.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ avaliadoMotivo: MOTIVOS_DO_ROBO.SEM_TEOR_NO_DATAJUD }),
      }),
    );
  });

  /** O resumo parou de anunciar prazos criados porque ninguém os cria mais. */
  it('o resumo não promete tarefa de prazo que não existe', async () => {
    const { svc } = montar();
    const resumo = await svc.processar('p1', pauta() as never);
    expect(resumo).not.toHaveProperty('prazos');
    expect(resumo).toHaveProperty('avaliadosSemTarefa');
  });
});
