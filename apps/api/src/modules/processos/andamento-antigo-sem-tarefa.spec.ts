import {
  AutomacaoPrazosService,
  MOTIVO_ANDAMENTO_ANTIGO,
  TITULO_PRAZO_GENERICO,
} from './automacao-prazos.service';

/**
 * "AINDA ESTÃO SENDO CRIADAS TAREFAS QUE SÃO DA PARTE CONTRÁRIA (...) ESTÁ
 * ENCHENDO O SISTEMA DE ATIVIDADES E MUITAS VEZES NÃO CONFIAMOS SE É NOSSA
 * PARTE QUE TEM QUE ATUAR." — 17/09/2026.
 *
 * Medido na produção antes desta mudança: 48 "Verificação de Intimação / Prazo"
 * em 90 dias, 47 nascidas atrasadas, 36 já nascendo com "o prazo, se havia, já
 * correu", 34 ainda PENDENTES (18 num advogado só) e 39 criadas num único dia.
 *
 * Este caminho vem do DataJud, que NÃO manda o teor: o robô não sabe nem de
 * quem é o prazo. Com o ato velho, a tarefa não salva nada — e a decisão de não
 * criar tem de ficar gravada, senão "sem tarefa" vira "o robô falhou".
 */
describe('andamento velho não vira tarefa', () => {
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
    const updatesDaMovimentacao: Record<string, unknown>[] = [];
    const prisma = {
      compromisso: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          criados.push(data);
          return { id: 'k1' };
        }),
        update: jest.fn(async () => ({})),
      },
      movimentacaoProcessual: {
        update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          updatesDaMovimentacao.push({ ...where, ...data });
          return {};
        }),
      },
    };
    const svc = new AutomacaoPrazosService(prisma as never, {} as never);
    const criarPrazo = (mov: ReturnType<typeof movimentacao>) =>
      (svc as unknown as {
        criarPrazo: (p: typeof processo, m: typeof mov, r: string) => Promise<string>;
      }).criarPrazo(processo, mov, 'u1');
    const dispensas = () => updatesDaMovimentacao.filter((u) => u.dispensadoMotivo);
    return { criarPrazo, criados, updatesDaMovimentacao, dispensas };
  }

  it('ato de 30 dias: nenhuma tarefa, e a decisão fica carimbada na movimentação', async () => {
    const { criarPrazo, criados, dispensas } = montar();
    await expect(criarPrazo(movimentacao(30))).resolves.toBe('SEM_TAREFA_POR_IDADE');
    expect(criados).toHaveLength(0);
    expect(dispensas()).toEqual([
      { id: 'm1', dispensadoEm: expect.any(Date), dispensadoPor: null, dispensadoMotivo: MOTIVO_ANDAMENTO_ANTIGO },
    ]);
  });

  it('o carimbo é do ROBÔ: nunca inventa um autor humano', async () => {
    const { criarPrazo, dispensas } = montar();
    await criarPrazo(movimentacao(45));
    expect(dispensas()[0].dispensadoPor).toBeNull();
  });

  it('ato recente continua virando tarefa, como sempre', async () => {
    const { criarPrazo, criados, dispensas, updatesDaMovimentacao } = montar();
    await expect(criarPrazo(movimentacao(2))).resolves.toBe('CRIADA');
    expect(criados).toHaveLength(1);
    expect(criados[0].titulo).toBe(TITULO_PRAZO_GENERICO);
    expect(dispensas()).toEqual([]);
    // A movimentação continua sendo carimbada com a tarefa (trava de idempotência).
    expect(updatesDaMovimentacao[0]).toMatchObject({ id: 'm1', compromissoId: 'k1' });
  });

  /**
   * A FRONTEIRA É A MESMA DA URGÊNCIA (15 dias, `DIAS_ATO_RECENTE`): até ali o
   * prazo processual pode estar correndo e talvez dê para salvar; depois, não.
   * Duas réguas para a mesma pergunta seria a receita de "urgente sem tarefa".
   */
  it('em 15 dias ainda cria; em 16 já não', async () => {
    const dentro = montar();
    await expect(dentro.criarPrazo(movimentacao(15))).resolves.toBe('CRIADA');
    const fora = montar();
    await expect(fora.criarPrazo(movimentacao(16))).resolves.toBe('SEM_TAREFA_POR_IDADE');
  });

  it('o ato velho não é agrupado numa tarefa aberta: nem entra na agenda', async () => {
    const { criarPrazo, criados, dispensas } = montar();
    await criarPrazo(movimentacao(40));
    // `findFirst` procuraria a tarefa do dia para mesclar a descrição; não chega lá.
    expect(criados).toHaveLength(0);
    expect(dispensas()).toHaveLength(1);
  });
});
