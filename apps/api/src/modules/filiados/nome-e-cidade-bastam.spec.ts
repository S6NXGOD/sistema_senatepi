import {
  CandidatoDuplicata,
  DuplicidadeService,
  cidadeConfirmada,
  esperandoDado,
  nomeECidadeBastam,
  ordemDoLote,
  semValorDivergente,
  todaInicialExplicada,
} from './duplicidade.service';

/**
 * O NOME E A CIDADE JÁ BASTAM — DECISÃO DO DONO, 18/09/2026.
 *
 * Eu havia medido e recomendado o contrário: dos grupos que sobravam na fila, a
 * maioria não concorda em NADA além de nome e cidade, porque não há mais nada
 * preenchido em nenhum dos lados. A resposta foi direta:
 *
 *   "Por mim, se concordar com o nome igual e cidade, já pode tirar esses
 *    grupos, já economiza trabalho. E se for abreviado também, exemplo, Pedro
 *    Silva Costa Ribeiro e Pedro S. C. Ribeiro ou Pedro S. Costa Ribeiro, pode
 *    remover também."
 *
 * NÃO DESFAZER ISTO achando que foi descuido. Este arquivo guarda a data, a
 * frase e os exemplos dele.
 */
const base = (over: Partial<CandidatoDuplicata> = {}): CandidatoDuplicata => ({
  id: 'a',
  nomeCompleto: 'PEDRO SILVA COSTA RIBEIRO',
  matricula: '0001',
  cpf: null,
  numeroCoren: null,
  cidade: 'Teresina',
  estado: 'PI',
  telefonePrincipal: null,
  email: null,
  dataNascimento: null,
  endereco: null,
  situacao: 'ATIVO',
  dataFiliacao: null,
  createdAt: new Date('2020-01-01T03:00:00Z'),
  temFoto: false,
  vinculos: 0,
  pontuacao: 1,
  sugerido: false,
  ...over,
});

describe('os exemplos do dono', () => {
  it.each([
    ['PEDRO SILVA COSTA RIBEIRO', 'PEDRO S. C. RIBEIRO'],
    ['PEDRO SILVA COSTA RIBEIRO', 'PEDRO S. COSTA RIBEIRO'],
    ['ANTÔNIA MARIA V. DO NASCIMENTO', 'ANTONIA MARIA VIEIRA DO NASCIMENTO'],
  ])('%s × %s é abreviação com toda inicial explicada', (a, b) => {
    expect(todaInicialExplicada([a, b])).toBe(true);
  });

  /**
   * UMA INICIAL NÃO EXPLICA DOIS SOBRENOMES.
   *
   * O SQL do agrupamento marca `abreviacao` quando UMA inicial casa. Basta para
   * levantar a suspeita e não basta para apagar cadastro: aqui o "A." explica
   * "ANDRADE" e "PINHO" fica sem explicação nenhuma. Caso real da base.
   */
  it('SANDRA MARIA DOS A. SILVA × SANDRA MARIA DE ANDRADE PINHO SILVA NÃO passa', () => {
    expect(
      todaInicialExplicada(['SANDRA MARIA DOS A. SILVA', 'SANDRA MARIA DE ANDRADE PINHO SILVA']),
    ).toBe(false);
  });

  it('nome contido sem inicial nenhuma não é abreviação — são duas pessoas', () => {
    expect(
      todaInicialExplicada(['MARIA DAS GRAÇAS SILVA', 'MARIA DAS GRAÇAS MENDES SILVA']),
    ).toBe(false);
  });

  it('nomes iguais depois de tirar acento e caixa passam', () => {
    expect(todaInicialExplicada(['ANTÔNIA DA SILVA', 'ANTONIA DA SILVA'])).toBe(true);
  });

  it('num grupo de três, TODOS os pares precisam passar', () => {
    expect(
      todaInicialExplicada(['PEDRO S. C. RIBEIRO', 'PEDRO SILVA COSTA RIBEIRO', 'PEDRO MENDES COSTA RIBEIRO']),
    ).toBe(false);
  });
});

describe('a cidade tem de estar preenchida dos dois lados', () => {
  it('cidade igual nos dois confirma', () => {
    expect(cidadeConfirmada([base({ cidade: 'Teresina' }), base({ cidade: 'TERESINA ' })])).toBe(true);
  });

  it('cidade faltando num deles NÃO confirma — não é acordo, é ausência', () => {
    expect(cidadeConfirmada([base({ cidade: 'Teresina' }), base({ cidade: null })])).toBe(false);
  });
});

describe('nenhum valor pode sumir', () => {
  it('telefones diferentes barram: um deles sumiria na fusão', () => {
    expect(
      semValorDivergente([
        base({ telefonePrincipal: '86999990000' }),
        base({ telefonePrincipal: '86988880000' }),
      ]),
    ).toBe(false);
  });

  it('um lado com telefone e o outro sem passa: a fusão copia', () => {
    expect(
      semValorDivergente([base({ telefonePrincipal: '86999990000' }), base({})]),
    ).toBe(true);
  });

  it('o mesmo valor com espaço e caixa diferentes é o mesmo valor', () => {
    expect(
      semValorDivergente([base({ email: 'A@X.COM' }), base({ email: ' a@x.com ' })]),
    ).toBe(true);
  });
});

describe('quem fica é sempre o mesmo cadastro', () => {
  it('mais completo primeiro; empatado, a filiação mais antiga', () => {
    const a = base({ id: 'a', matricula: '2', pontuacao: 1, dataFiliacao: new Date('2020-01-01') });
    const b = base({ id: 'b', matricula: '1', pontuacao: 1, dataFiliacao: new Date('2010-01-01') });
    expect(ordemDoLote([a, b])[0].id).toBe('b');
    expect(ordemDoLote([b, a])[0].id).toBe('b');
  });

  it('empate total desempata pela matrícula — nunca pela ordem do banco', () => {
    const a = base({ id: 'a', matricula: '0009' });
    const b = base({ id: 'b', matricula: '0002' });
    expect(ordemDoLote([a, b])[0].matricula).toBe('0002');
    expect(ordemDoLote([b, a])[0].matricula).toBe('0002');
  });
});

describe('o lote com a régua do dono', () => {
  const comGrupo = (
    candidatos: CandidatoDuplicata[],
    over: { contradicoes?: string[]; nomeConfirmado?: boolean } = {},
  ) => {
    const servico = new DuplicidadeService({} as never, {} as never);
    jest.spyOn(servico, 'varrer').mockResolvedValue([
      {
        chave: 'k',
        confianca: 'ALTA',
        criterio: 'nome idêntico',
        motivoSugestao: null,
        decidiu: true,
        contradicoes: over.contradicoes ?? [],
        cpfEmConflito: null, esperandoDado: esperandoDado(candidatos),
        nomeConfirmado: over.nomeConfirmado ?? true,
        candidatos,
      },
    ]);
    return servico;
  };

  it('dois cadastros SEM NADA, mesmo nome e mesma cidade, entram no lote', async () => {
    const servico = comGrupo([
      base({ id: 'a', matricula: '0001' }),
      base({ id: 'b', matricula: '0002' }),
    ]);
    const lote = await servico.elegiveisParaLote();
    expect(lote).toHaveLength(1);
    expect(lote[0].descartarMatricula).toBe('0002');
  });

  it('sem cidade nos dois, NÃO entra — sobra nome e mais nada', async () => {
    const servico = comGrupo([
      base({ id: 'a', matricula: '0001', cidade: null }),
      base({ id: 'b', matricula: '0002', cidade: null }),
    ]);
    await expect(servico.elegiveisParaLote()).resolves.toHaveLength(0);
  });

  it('os dois preenchidos e concordando entram — nada se perde', async () => {
    const servico = comGrupo([
      base({ id: 'a', matricula: '0001', telefonePrincipal: '86999990000', pontuacao: 2 }),
      base({ id: 'b', matricula: '0002', email: 'p@x.com', pontuacao: 2 }),
    ]);
    await expect(servico.elegiveisParaLote()).resolves.toHaveLength(1);
  });

  it('os dois preenchidos e DIVERGINDO ficam na mão — um valor sumiria', async () => {
    const servico = comGrupo([
      base({ id: 'a', matricula: '0001', telefonePrincipal: '86999990000', pontuacao: 2 }),
      base({ id: 'b', matricula: '0002', telefonePrincipal: '86988880000', pontuacao: 2 }),
    ]);
    await expect(servico.elegiveisParaLote()).resolves.toHaveLength(0);
  });

  it('"um nome contém o outro" continua na mão, mesmo com tudo batendo', async () => {
    const servico = comGrupo(
      [
        base({ id: 'a', matricula: '0001', nomeCompleto: 'MARIA DAS GRAÇAS SILVA' }),
        base({ id: 'b', matricula: '0002', nomeCompleto: 'MARIA DAS GRAÇAS MENDES SILVA' }),
      ],
      { nomeConfirmado: false },
    );
    await expect(servico.elegiveisParaLote()).resolves.toHaveLength(0);
  });

  it('contradição barra antes de tudo', async () => {
    const servico = comGrupo(
      [base({ id: 'a', matricula: '0001' }), base({ id: 'b', matricula: '0002' })],
      { contradicoes: ['CPF'] },
    );
    await expect(servico.elegiveisParaLote()).resolves.toHaveLength(0);
  });
});

/**
 * "ESPERANDO DADO" ENCOLHEU, e é consequência da decisão do dono: com a cidade
 * batendo o grupo passou a ser decidível pelo lote. Sobra o caso em que não há
 * nem cidade — aí não se sabe absolutamente nada.
 */
describe('o que ainda espera um dado', () => {
  it('ninguém tem dado E a cidade não confirma: continua impossível', () => {
    expect(esperandoDado([base({ cidade: 'Teresina' }), base({ cidade: null })])).toBe(true);
  });

  it('ninguém tem dado mas a cidade confirma: o lote resolve, não é espera', () => {
    expect(esperandoDado([base({ cidade: 'Teresina' }), base({ cidade: 'Teresina' })])).toBe(false);
  });
});

describe('a régua do lote, inteira', () => {
  it('nomeECidadeBastam exige as quatro coisas ao mesmo tempo', () => {
    const bons = [base({ id: 'a' }), base({ id: 'b' })];
    expect(nomeECidadeBastam({ nomeConfirmado: true, candidatos: bons })).toBe(true);
    expect(nomeECidadeBastam({ nomeConfirmado: false, candidatos: bons })).toBe(false);
    expect(
      nomeECidadeBastam({ nomeConfirmado: true, candidatos: [base({ cidade: null }), base({})] }),
    ).toBe(false);
    expect(
      nomeECidadeBastam({
        nomeConfirmado: true,
        candidatos: [base({ cpf: '1' }), base({ cpf: '2' })],
      }),
    ).toBe(false);
  });
});
