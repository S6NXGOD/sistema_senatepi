import { BadRequestException } from '@nestjs/common';
import { RecibosService } from './recibos.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * O RECIBO — o que o papel promete, testado contra o que o serviço grava.
 *
 * Um recibo não é uma tela: é um documento que sai da impressora, vai para a
 * mão de alguém e volta um ano depois numa prestação de contas. As asserções
 * abaixo são as promessas que ele faz, e cada uma já falhou em algum sistema:
 *
 *  · o número não se repete e não muda entre a 1ª e a 2ª via;
 *  · o nome de quem pagou é o do DIA DO PAGAMENTO, não o de hoje;
 *  · o valor é o que ENTROU (com juros ou desconto), não o que era devido;
 *  · cancelar não apaga nem devolve o número;
 *  · todo recibo tem lastro no caixa — e o avulso cria o lançamento junto.
 *
 * O banco falso anota se cada chamada aconteceu DENTRO do `$transaction`,
 * porque "na mesma transação" é metade da promessa do item 5.
 */

interface Chamada {
  chave: string;
  args: any;
  naTransacao: boolean;
}

/** 22h de 31/12/2026 em Teresina — 01:00 UTC de 01/01/2027. O exercício é 2026. */
const VIRADA_DO_ANO = new Date('2027-01-01T01:00:00.000Z');

function bancoFalso(opcoes: {
  parcela?: any;
  movimentacao?: any;
  recibo?: any;
  ultimoNumero?: number | null;
  contas?: { id: string; ativo: boolean }[];
} = {}) {
  const chamadas: Chamada[] = [];
  let naTransacao = false;

  const anotar = (chave: string, resposta: (args: any) => unknown) =>
    jest.fn(async (args: any) => {
      chamadas.push({ chave, args, naTransacao });
      return resposta(args);
    });

  let criado: any = null;

  const prisma: any = {
    parcelaCobranca: {
      findUnique: anotar('parcela.findUnique', () => opcoes.parcela ?? null),
    },
    movimentacao: {
      findUnique: anotar('movimentacao.findUnique', () => opcoes.movimentacao ?? null),
      findMany: anotar('movimentacao.findMany', () => []),
      count: anotar('movimentacao.count', () => 0),
      create: anotar('movimentacao.create', (args) => ({ id: 'mov-novo', ...args.data })),
    },
    contaBancaria: {
      findMany: anotar('conta.findMany', () =>
        (opcoes.contas ?? [{ id: 'conta-1', ativo: true }]).filter((c) => c.ativo),
      ),
      findUnique: anotar('conta.findUnique', (args) =>
        (opcoes.contas ?? [{ id: 'conta-1', ativo: true }]).find((c) => c.id === args.where.id) ?? null,
      ),
    },
    recibo: {
      findMany: anotar('recibo.findMany', () => []),
      count: anotar('recibo.count', () => 0),
      aggregate: anotar('recibo.aggregate', () => ({ _sum: { valor: 0 }, _count: 0 })),
      groupBy: anotar('recibo.groupBy', () => []),
      findFirst: anotar('recibo.findFirst', () =>
        opcoes.ultimoNumero == null ? null : { numero: opcoes.ultimoNumero },
      ),
      create: anotar('recibo.create', (args) => {
        criado = { id: 'recibo-1', ...args.data, canceladoEm: null, canceladoPor: null };
        return criado;
      }),
      update: anotar('recibo.update', (args) => {
        criado = { ...(criado ?? opcoes.recibo), ...args.data };
        return criado;
      }),
      findUnique: anotar('recibo.findUnique', () => criado ?? opcoes.recibo ?? null),
    },
    user: {
      findUnique: anotar('user.findUnique', () => ({ nome: 'Ivo Ramos', nomeExibicao: 'Ivo' })),
    },
    $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...valores: unknown[]) => {
      chamadas.push({ chave: '$executeRaw', args: { sql: strings.join('?'), valores }, naTransacao });
      return 1;
    }),
  };

  prisma.$transaction = async (cb: (tx: unknown) => unknown) => {
    naTransacao = true;
    try {
      return await cb(prisma);
    } finally {
      naTransacao = false;
    }
  };

  const audit = { registrar: jest.fn(async () => undefined) };
  const service = new RecibosService(prisma, audit as any);
  return { service, prisma, audit, chamadas, criado: () => criado };
}

const PARCELA_PAGA = {
  id: 'parcela-1',
  numero: 1,
  status: 'PAGO',
  valor: 99.15,
  /* O que realmente entrou: R$ 5 de juros. */
  valorPago: 104.15,
  dataPagamento: new Date('2026-08-19T17:30:00.000Z'),
  dataCompetencia: new Date('2026-08-01T00:00:00.000Z'),
  movimentacaoId: 'mov-da-baixa',
  /* A consulta já filtra `canceladoEm: null`: a lista traz só o recibo VIVO. */
  recibos: [] as { numero: number; exercicio: number }[],
  cobranca: {
    tipo: 'MENSALIDADE',
    _count: { parcelas: 12 },
    filiado: { id: 'fil-1', nomeCompleto: 'LUCIANA DA SILVA TORRES CARVALHO', cpf: '12345678901' },
  },
};

describe('emitir a partir de uma parcela paga', () => {
  it('o valor do recibo é o que ENTROU, não o que era devido', async () => {
    const { service } = bancoFalso({ parcela: PARCELA_PAGA });
    const r = await service.emitir({ formaPagamento: 'PIX', parcelaId: 'parcela-1' }, { userId: 'u1' });
    expect(r.valor).toBe(104.15);
  });

  /**
   * O NOME CONGELA AQUI. Se a filiada corrigir o cadastro amanhã, o papel que
   * ela levou continua dizendo o que dizia — é o inverso de
   * `senatepi-derivado-desfaz-decisao`, e aqui o derivado é que seria o erro.
   */
  it('copia nome e CPF para dentro do recibo, em vez de apontar para a ficha', async () => {
    const { service, chamadas } = bancoFalso({ parcela: PARCELA_PAGA });
    await service.emitir({ formaPagamento: 'PIX', parcelaId: 'parcela-1' }, { userId: 'u1' });
    const criar = chamadas.find((c) => c.chave === 'recibo.create')!;
    expect(criar.args.data.pagadorNome).toBe('LUCIANA DA SILVA TORRES CARVALHO');
    expect(criar.args.data.pagadorDocumento).toBe('12345678901');
    expect(criar.args.data.filiadoId).toBe('fil-1');
    // Nada de `connect` na ficha para LER o nome na hora de imprimir.
    expect(criar.args.data).not.toHaveProperty('filiado');
  });

  /** A frase do "referente a" se monta sozinha — e cita a competência. */
  it('o "referente a" nasce pronto com a parcela e a competência', async () => {
    const { service, chamadas } = bancoFalso({ parcela: PARCELA_PAGA });
    await service.emitir({ formaPagamento: 'Dinheiro', parcelaId: 'parcela-1' }, { userId: 'u1' });
    const criar = chamadas.find((c) => c.chave === 'recibo.create')!;
    expect(criar.args.data.referente).toBe(
      'Mensalidade sindical — parcela 1/12, competência 08/2026',
    );
  });

  /** O lastro é o lançamento que a BAIXA já criou — não nasce outro. */
  it('aproveita a movimentação da baixa e não cria uma segunda', async () => {
    const { service, chamadas } = bancoFalso({ parcela: PARCELA_PAGA });
    await service.emitir({ formaPagamento: 'PIX', parcelaId: 'parcela-1' }, { userId: 'u1' });
    const criar = chamadas.find((c) => c.chave === 'recibo.create')!;
    expect(criar.args.data.movimentacaoId).toBe('mov-da-baixa');
    expect(chamadas.some((c) => c.chave === 'movimentacao.create')).toBe(false);
  });

  it('parcela que não está paga não gera recibo', async () => {
    const { service } = bancoFalso({ parcela: { ...PARCELA_PAGA, status: 'PENDENTE' } });
    await expect(
      service.emitir({ formaPagamento: 'PIX', parcelaId: 'parcela-1' }, { userId: 'u1' }),
    ).rejects.toThrow(BadRequestException);
  });

  /** Dois recibos do mesmo dinheiro é o erro que mais confunde prestação de contas. */
  it('parcela que já tem recibo vivo manda imprimir a 2ª via', async () => {
    const { service } = bancoFalso({
      parcela: { ...PARCELA_PAGA, recibos: [{ numero: 7, exercicio: 2026 }] },
    });
    await expect(
      service.emitir({ formaPagamento: 'PIX', parcelaId: 'parcela-1' }, { userId: 'u1' }),
    ).rejects.toThrow('já tem o recibo 007/2026');
  });

  /**
   * MAS RECIBO CANCELADO LIBERA — e isto custou um 500 em conferência.
   *
   * A primeira versão punha `@unique` em `parcela_id`, e a reemissão (que é a
   * razão número um de cancelar) batia no índice e estourava. Hoje a
   * unicidade é um índice PARCIAL `WHERE cancelado_em IS NULL`, e a consulta
   * aqui pede só o vivo — que, com o antigo cancelado, é nenhum.
   */
  it('recibo cancelado não impede a reemissão', async () => {
    const { service, chamadas } = bancoFalso({
      parcela: { ...PARCELA_PAGA, recibos: [] },
      ultimoNumero: 7,
    });
    const r = await service.emitir({ formaPagamento: 'PIX', parcelaId: 'parcela-1' }, { userId: 'u1' });
    expect(r.numero).toBe(8);
    // E a consulta pede SÓ o vivo — senão o cancelado voltaria a barrar.
    const busca = chamadas.find((c) => c.chave === 'parcela.findUnique')!;
    expect(busca.args.include.recibos.where).toEqual({ canceladoEm: null });
  });
});

describe('a numeração', () => {
  it('começa em 1 e anda de um em um dentro do exercício', async () => {
    const primeiro = bancoFalso({ parcela: PARCELA_PAGA, ultimoNumero: null });
    expect((await primeiro.service.emitir({ formaPagamento: 'PIX', parcelaId: 'p' }, {})).numero).toBe(1);

    const sexto = bancoFalso({ parcela: PARCELA_PAGA, ultimoNumero: 5 });
    expect((await sexto.service.emitir({ formaPagamento: 'PIX', parcelaId: 'p' }, {})).numero).toBe(6);
  });

  /**
   * A TRAVA VEM ANTES DE LER O ÚLTIMO NÚMERO, e dentro da transação.
   *
   * Fora dessa ordem, dois atendentes emitindo ao mesmo tempo leem o mesmo
   * `MAX` e o segundo bate na UNIQUE — erro feio num balcão com alguém
   * esperando o papel.
   */
  it('toma a trava do exercício antes de ler o último número', async () => {
    const { service, chamadas } = bancoFalso({ parcela: PARCELA_PAGA, ultimoNumero: 3 });
    await service.emitir({ formaPagamento: 'PIX', parcelaId: 'p' }, {});
    const trava = chamadas.findIndex((c) => c.chave === '$executeRaw');
    const leitura = chamadas.findIndex((c) => c.chave === 'recibo.findFirst');
    expect(trava).toBeGreaterThanOrEqual(0);
    expect(trava).toBeLessThan(leitura);
    expect(chamadas[trava].naTransacao).toBe(true);
    expect(chamadas[trava].args.sql).toContain('pg_advisory_xact_lock');
    /*
      O `::int` DOS DOIS ARGUMENTOS. O Prisma manda número de JS como
      `bigint` e o Postgres não tem `pg_advisory_xact_lock(bigint, bigint)`:
      sem o cast, TODA emissão morre com 42883. A primeira versão deste
      teste conferia só o nome da função e ficou verde com o bug no ar —
      quem pegou foi chamar a rota de verdade
      (`senatepi-teste-que-afirma-a-chamada`).
    */
    expect(chamadas[trava].args.sql.match(/::int/g)).toHaveLength(2);
    // A trava é POR EXERCÍCIO: 2027 não espera a fila de 2026.
    expect(chamadas[trava].args.valores[1]).toBe(2026);
  });

  /**
   * O EXERCÍCIO É O ANO EM TERESINA, e não o do relógio do contêiner (UTC).
   *
   * Um recebimento às 22h de 31/12 já é 1º de janeiro em Londres: sem o
   * deslocamento, o último recibo do ano entraria na numeração do ano seguinte
   * — e o ano que fecha ganharia um fantasma na contagem.
   */
  it('a virada do ano é a de Teresina', async () => {
    const { service, chamadas } = bancoFalso({
      parcela: { ...PARCELA_PAGA, dataPagamento: VIRADA_DO_ANO },
    });
    await service.emitir({ formaPagamento: 'Dinheiro', parcelaId: 'p' }, {});
    const criar = chamadas.find((c) => c.chave === 'recibo.create')!;
    expect(criar.args.data.exercicio).toBe(2026);
  });
});

describe('o recibo avulso', () => {
  const AVULSO = {
    valor: 50,
    referente: '2ª via da carteirinha',
    formaPagamento: 'Dinheiro',
    pagadorNome: 'Maria do Socorro',
    pagadorDocumento: '123.456.789-01',
  };

  /** Papel sem lastro no livro é como a gaveta e a contabilidade divergem. */
  it('cria a ENTRADA no caixa dentro da MESMA transação do recibo', async () => {
    const { service, chamadas } = bancoFalso({ parcela: null });
    await service.emitir(AVULSO, { userId: 'u1' });
    const mov = chamadas.find((c) => c.chave === 'movimentacao.create')!;
    const rec = chamadas.find((c) => c.chave === 'recibo.create')!;
    expect(mov.naTransacao).toBe(true);
    expect(rec.naTransacao).toBe(true);
    expect(mov.args.data.tipo).toBe('ENTRADA');
    expect(mov.args.data.valor).toBe(50);
    expect(mov.args.data.origem).toBe('RECIBO');
    // A descrição do caixa cita o recibo: quem lê o extrato acha o papel.
    expect(mov.args.data.descricao).toContain('Recibo 001/');
    expect(rec.args.data.movimentacaoId).toBe('mov-novo');
  });

  /** O documento é limpo na entrada — máscara não é dado. */
  it('guarda o documento só com dígitos', async () => {
    const { service, chamadas } = bancoFalso({});
    await service.emitir(AVULSO, { userId: 'u1' });
    const rec = chamadas.find((c) => c.chave === 'recibo.create')!;
    expect(rec.args.data.pagadorDocumento).toBe('12345678901');
  });

  /**
   * COM UMA CONTA SÓ NÃO SE PERGUNTA — o sindicato tem uma ("CONTA SINDICATO",
   * medido na produção em 06/10/2026). Campo com uma opção só serve para errar.
   */
  it('com uma conta ativa, usa a única sem perguntar', async () => {
    const { service, chamadas } = bancoFalso({ contas: [{ id: 'conta-1', ativo: true }] });
    await service.emitir(AVULSO, {});
    const mov = chamadas.find((c) => c.chave === 'movimentacao.create')!;
    expect(mov.args.data.contaBancariaId).toBe('conta-1');
  });

  it('com duas contas, exige a escolha', async () => {
    const { service } = bancoFalso({
      contas: [{ id: 'conta-1', ativo: true }, { id: 'conta-2', ativo: true }],
    });
    await expect(service.emitir(AVULSO, {})).rejects.toThrow('Escolha a conta');
  });

  it('sem conta nenhuma, diz o que fazer em vez de estourar', async () => {
    const { service } = bancoFalso({ contas: [] });
    await expect(service.emitir(AVULSO, {})).rejects.toThrow('Não há conta de caixa cadastrada');
  });

  it.each([
    [{ ...AVULSO, valor: undefined }, 'Informe o valor recebido.'],
    [{ ...AVULSO, referente: '' }, 'Diga a que se refere'],
    [{ ...AVULSO, pagadorNome: '  ' }, 'Informe quem pagou.'],
  ])('recusa o que falta, dizendo o quê (%#)', async (dto, frase) => {
    const { service } = bancoFalso({});
    await expect(service.emitir(dto as any, {})).rejects.toThrow(frase);
  });

  /** As duas origens juntas seriam dois lastros para um recibo. */
  it('parcela e lançamento ao mesmo tempo é recusado', async () => {
    const { service } = bancoFalso({});
    await expect(
      service.emitir({ formaPagamento: 'PIX', parcelaId: 'p', movimentacaoId: 'm' }, {}),
    ).rejects.toThrow('uma origem só');
  });
});

describe('cancelar', () => {
  const RECIBO_VIVO = {
    id: 'recibo-1',
    exercicio: 2026,
    numero: 7,
    valor: 99.15,
    referente: 'Mensalidade',
    formaPagamento: 'PIX',
    recebidoEm: new Date('2026-08-19T17:30:00Z'),
    pagadorNome: 'LUCIANA',
    pagadorDocumento: '12345678901',
    emitidoPor: 'u1',
    emitidoEm: new Date('2026-08-19T18:00:00Z'),
    canceladoEm: null,
    canceladoPor: null,
    canceladoMotivo: null,
    movimentacaoId: 'mov-1',
    parcelaId: 'parcela-1',
    filiadoId: 'fil-1',
    empresaId: null,
  };

  it('não apaga: marca, com motivo, autor e data', async () => {
    const { service, chamadas } = bancoFalso({ recibo: RECIBO_VIVO });
    await service.cancelar('recibo-1', { motivo: 'Valor digitado errado.' }, { userId: 'u9' });
    const up = chamadas.find((c) => c.chave === 'recibo.update')!;
    expect(up.args.data.canceladoMotivo).toBe('Valor digitado errado.');
    expect(up.args.data.canceladoPor).toBe('u9');
    expect(up.args.data.canceladoEm).toBeInstanceOf(Date);
    // Nenhuma exclusão, em lugar nenhum.
    expect(chamadas.some((c) => c.chave.includes('delete'))).toBe(false);
  });

  /** O número NÃO volta para a fila, e a linha fica. */
  it('o número e o lastro no caixa continuam', async () => {
    const { service, chamadas } = bancoFalso({ recibo: RECIBO_VIVO });
    await service.cancelar('recibo-1', { motivo: 'Reemitido no nº 8.' }, { userId: 'u9' });
    const up = chamadas.find((c) => c.chave === 'recibo.update')!;
    expect(up.args.data.numero).toBeUndefined();
    expect(up.args.data.movimentacaoId).toBeUndefined();
  });

  it('cancelar duas vezes é recusado', async () => {
    const { service } = bancoFalso({
      recibo: { ...RECIBO_VIVO, canceladoEm: new Date('2026-09-01T12:00:00Z') },
    });
    await expect(
      service.cancelar('recibo-1', { motivo: 'de novo' }, { userId: 'u9' }),
    ).rejects.toThrow('já está cancelado');
  });

  /** A auditoria registra o PORQUÊ, não só o ato. */
  it('a auditoria leva o motivo escrito', async () => {
    const { service, audit } = bancoFalso({ recibo: RECIBO_VIVO });
    await service.cancelar('recibo-1', { motivo: 'Pagamento estornado.' }, { userId: 'u9' });
    expect(audit.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entidade: 'Recibo',
        descricao: 'Cancelou o recibo 007/2026: Pagamento estornado.',
      }),
    );
  });
});

describe('o que o papel lê', () => {
  it('o valor por extenso vem do servidor, pela função única', async () => {
    const { service } = bancoFalso({ parcela: PARCELA_PAGA });
    const r = await service.emitir({ formaPagamento: 'PIX', parcelaId: 'p' }, { userId: 'u1' });
    expect(r.valorPorExtenso).toBe('cento e quatro reais e quinze centavos');
  });

  /** "007/2026" é como o recibo é citado em ofício e em prestação de contas. */
  it('o código é o número com três casas e o ano', async () => {
    const { service } = bancoFalso({ parcela: PARCELA_PAGA, ultimoNumero: 6 });
    const r = await service.emitir({ formaPagamento: 'PIX', parcelaId: 'p' }, { userId: 'u1' });
    expect(r.codigo).toBe('007/2026');
  });

  /** O cabeçalho institucional não é digitado na tela — vem do tenant da API. */
  it('o emitente traz CNPJ e endereço do cliente', async () => {
    const { service } = bancoFalso({ parcela: PARCELA_PAGA });
    const r = await service.emitir({ formaPagamento: 'PIX', parcelaId: 'p' }, { userId: 'u1' });
    expect(r.emitente.cnpj).toBeTruthy();
    expect(r.emitente.sigla).toBeTruthy();
    expect(r.emitente.nome.length).toBeGreaterThan(10);
  });
});

/**
 * O RESUMO CONTA O RECORTE, NÃO A ABA — e a conta errada dava SEMPRE ZERO.
 *
 * A primeira versão somava e contava sobre o MESMO `where` da lista, que na aba
 * padrão já exige `canceladoEm: null`. Pedir "quantos cancelados entre os não
 * cancelados" é uma contradição que o Postgres responde com 0 sem reclamar: na
 * tela, dois recibos cancelados apareciam como "0 cancelados", e o número só
 * existia para avisar que eles estavam lá.
 */
describe('o resumo da listagem', () => {
  const onde = (chamadas: Chamada[], chave: string) =>
    JSON.stringify(chamadas.find((c) => c.chave === chave)!.args.where);
  /** `recibo.count` é chamado DUAS vezes: o total da lista e os cancelados. */
  const contagens = (chamadas: Chamada[]) =>
    chamadas.filter((c) => c.chave === 'recibo.count').map((c) => JSON.stringify(c.args.where));

  it('a contagem de cancelados não herda o filtro de situação da lista', async () => {
    const { service, chamadas } = bancoFalso({});
    await service.listar({ situacao: 'VALIDOS', de: '2026-08-01' });

    // A LISTA recorta por situação...
    expect(onde(chamadas, 'recibo.findMany')).toContain('canceladoEm');
    // ...e a contagem de cancelados NÃO pode trazer `canceladoEm: null` junto,
    // senão exige cancelado e não cancelado ao mesmo tempo.
    const [total, cancelados] = contagens(chamadas);
    expect(total).toContain('"canceladoEm":null');
    expect(cancelados).toContain('"NOT":{"canceladoEm":null}');
    // A contradição seria exigir os dois no mesmo objeto — e dá sempre 0.
    expect(cancelados.match(/"canceladoEm":null/g)).toHaveLength(1);
    // E o recorte de período continua valendo nos dois.
    expect(cancelados).toContain('recebidoEm');
    expect(total).toContain('recebidoEm');
  });

  it('o total em dinheiro ignora cancelado em qualquer aba', async () => {
    const { service, chamadas } = bancoFalso({});
    await service.listar({ situacao: 'CANCELADOS' });
    expect(onde(chamadas, 'recibo.aggregate')).toContain('"canceladoEm":null');
  });

  /** `ate` é inclusivo: o dia escolhido inteiro, e não até a meia-noite dele. */
  it('o "até" inclui o dia escolhido', async () => {
    const { service, chamadas } = bancoFalso({});
    await service.listar({ ate: '2026-08-31' });
    const w = onde(chamadas, 'recibo.findMany');
    // 1º de setembro, 00:00 de Teresina = 03:00Z.
    expect(w).toContain('2026-09-01T03:00:00.000Z');
    expect(w).toContain('"lt"');
  });
});

/**
 * A DATA ESCOLHIDA NA TELA — e o dia que ela não pode perder.
 *
 * O `<input type="date">` manda "2026-10-06". `new Date('2026-10-06')` é
 * meia-noite em LONDRES, que são 21h do dia 5 em Teresina: o recibo sairia
 * impresso, assinado e entregue com a data de ONTEM. É o mesmo erro que já
 * custou 100% de 597 registros numa coluna `@db.Date` (`senatepi-data-pura`) e
 * 100% das tarefas do Diário nascendo na véspera.
 */
describe('a data digitada no formulário', () => {
  it('o dia escolhido é o dia de Teresina, não o de Londres', async () => {
    const { service, chamadas } = bancoFalso({});
    await service.emitir(
      {
        valor: 10, referente: 'taxa', formaPagamento: 'Dinheiro', pagadorNome: 'Fulano',
        recebidoEm: '2026-10-06',
      },
      { userId: 'u1' },
    );
    const criar = chamadas.find((c) => c.chave === 'recibo.create')!;
    const gravado: Date = criar.args.data.recebidoEm;
    // 00:00 de Teresina = 03:00 UTC do MESMO dia.
    expect(gravado.toISOString()).toBe('2026-10-06T03:00:00.000Z');
    // E é isso que a tela lê de volta como 06/10.
    expect(gravado.toLocaleDateString('pt-BR', { timeZone: 'America/Fortaleza' })).toBe('06/10/2026');
  });

  /** Texto COM hora continua sendo o instante que diz ser. */
  it('instante completo passa intacto', async () => {
    const { service, chamadas } = bancoFalso({});
    await service.emitir(
      {
        valor: 10, referente: 'taxa', formaPagamento: 'PIX', pagadorNome: 'Fulano',
        recebidoEm: '2026-10-06T17:45:00.000Z',
      },
      {},
    );
    const criar = chamadas.find((c) => c.chave === 'recibo.create')!;
    expect((criar.args.data.recebidoEm as Date).toISOString()).toBe('2026-10-06T17:45:00.000Z');
  });

  /** 31/12 escolhido na tela fecha o exercício certo, e não o do ano seguinte. */
  it('o último dia do ano não escorrega para o exercício seguinte', async () => {
    const { service, chamadas } = bancoFalso({});
    await service.emitir(
      { valor: 10, referente: 'taxa', formaPagamento: 'PIX', pagadorNome: 'F', recebidoEm: '2026-12-31' },
      {},
    );
    expect(chamadas.find((c) => c.chave === 'recibo.create')!.args.data.exercicio).toBe(2026);
  });
});
