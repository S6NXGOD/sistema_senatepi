import {
  CandidatoDuplicata,
  DuplicidadeService,
  esperandoDado,
  temDadoProprio,
} from './duplicidade.service';

/**
 * A CIDADE NÃO DECIDE SE O CADASTRO PODE SAIR (18/09/2026).
 *
 * O lote só remove quem não tem nada a copiar, e o critério era `pontuacao > 0`.
 * Como `cidade` vale 1 ponto, um cadastro cujo único conteúdo era "Teresina"
 * contava como cheio e o grupo ia para a revisão manual — por causa de um nome
 * de cidade que a fusão copia de qualquer jeito e que, divergindo, já seria
 * contradição antes de chegar aqui.
 *
 * Na produção de 18/09/2026 o lote antigo estava ESGOTADO: zero pares, e os 389
 * grupos da fila pareciam todos trabalho de gente. Com a régua nova são 128
 * pares e 115 grupos fechados.
 *
 * O mesmo critério, do outro lado, responde por que 251 grupos saíram da fila
 * de decisões: quando NINGUÉM tem dado, não existe decisão a tomar.
 */
const base = (over: Partial<CandidatoDuplicata> = {}): CandidatoDuplicata => ({
  id: 'a',
  nomeCompleto: 'MARIA DA SILVA',
  matricula: '0001',
  cpf: null,
  numeroCoren: null,
  cidade: null,
  estado: null,
  telefonePrincipal: null,
  email: null,
  dataNascimento: null,
  endereco: null,
  situacao: 'ATIVO',
  dataFiliacao: null,
  createdAt: new Date('2020-01-01T03:00:00Z'),
  temFoto: false,
  vinculos: 0,
  pontuacao: 0,
  sugerido: false,
  ...over,
});

describe('o que conta como dado do cadastro', () => {
  it('a cidade sozinha NÃO é dado próprio — é o que a fusão copia e o que já se sabia', () => {
    expect(temDadoProprio(base({ cidade: 'Teresina' }))).toBe(false);
  });

  it('a data de filiação sozinha também não — toda linha tem uma, e a mais antiga prevalece', () => {
    expect(temDadoProprio(base({ dataFiliacao: new Date('2015-03-02T03:00:00Z') }))).toBe(false);
  });

  it.each([
    ['CPF', { cpf: '12345678900' }],
    ['COREN', { numeroCoren: 'PI-123456' }],
    ['nascimento', { dataNascimento: new Date('1980-05-04') }],
    ['telefone', { telefonePrincipal: '86999990000' }],
    ['e-mail', { email: 'maria@exemplo.com' }],
    ['endereço', { endereco: 'Rua A, 100' }],
    ['foto', { temFoto: true }],
    ['vínculo', { vinculos: 1 }],
  ])('%s é dado próprio e segura o cadastro fora do lote', (_rotulo, campo) => {
    expect(temDadoProprio(base(campo as Partial<CandidatoDuplicata>))).toBe(true);
  });

  it('string em branco não é dado — o legado tem campos preenchidos com espaço', () => {
    expect(temDadoProprio(base({ cpf: '   ', email: '' }))).toBe(false);
  });
});

describe('grupo esperando dado', () => {
  it('ninguém tem nada: não é pendência, é pergunta sem resposta', () => {
    expect(esperandoDado([base({ id: 'a', cidade: 'Teresina' }), base({ id: 'b' })])).toBe(true);
  });

  it('basta UM ter dado para o grupo voltar a ser decidível', () => {
    expect(
      esperandoDado([base({ id: 'a', cpf: '12345678900' }), base({ id: 'b', cidade: 'Teresina' })]),
    ).toBe(false);
  });
});

describe('quem entra no lote', () => {
  const comGrupo = (candidatos: CandidatoDuplicata[], contradicoes: string[] = []) => {
    const servico = new DuplicidadeService({} as never, {} as never);
    jest.spyOn(servico, 'varrer').mockResolvedValue([
      {
        chave: 'k',
        confianca: 'ALTA',
        criterio: 'nome idêntico',
        motivoSugestao: null,
        decidiu: true,
        contradicoes,
        esperandoDado: esperandoDado(candidatos),
        nomeConfirmado: true,
        candidatos,
      },
    ]);
    return servico;
  };

  it('o descartado que só tem cidade ENTRA no lote (era o que prendia 405 pares)', async () => {
    const servico = comGrupo([
      base({ id: 'fica', matricula: '0001', cpf: '12345678900', cidade: 'Teresina', pontuacao: 4 }),
      base({ id: 'sai', matricula: '0002', cidade: 'Teresina', pontuacao: 1 }),
    ]);
    const lote = await servico.elegiveisParaLote();
    expect(lote).toHaveLength(1);
    expect(lote[0]).toMatchObject({ manterId: 'fica', descartarId: 'sai' });
  });

  it('o descartado com telefone continua FORA — isso é dado de verdade', async () => {
    const servico = comGrupo([
      base({ id: 'fica', cpf: '12345678900', pontuacao: 3 }),
      base({ id: 'sai', telefonePrincipal: '86999990000', pontuacao: 1 }),
    ]);
    await expect(servico.elegiveisParaLote()).resolves.toHaveLength(0);
  });

  /*
    MUDOU DE MOTIVO EM 18/09/2026, e o resultado continua o mesmo. Antes o lote
    parava porque ninguém tinha dado. Hoje, com a régua do dono, nome e cidade
    bastariam — mas aqui a cidade só existe de um lado, e um lado só não é
    acordo. Ver `nome-e-cidade-bastam.spec.ts`.
  */
  it('sem cidade nos dois lados o lote não toca — não se sabe nada', async () => {
    const servico = comGrupo([
      base({ id: 'a', matricula: '0001', cidade: 'Teresina', pontuacao: 1 }),
      base({ id: 'b', matricula: '0002' }),
    ]);
    await expect(servico.elegiveisParaLote()).resolves.toHaveLength(0);
  });

  it('contradição continua barrando, mesmo com um lado vazio', async () => {
    const servico = comGrupo(
      [base({ id: 'fica', cpf: '12345678900', pontuacao: 3 }), base({ id: 'sai', pontuacao: 0 })],
      ['CPF'],
    );
    await expect(servico.elegiveisParaLote()).resolves.toHaveLength(0);
  });
});

/**
 * O AVISO DA TELA DE FILIADOS PEDE TRABALHO — então conta só trabalho.
 *
 * Ele é âmbar e diz "aguardando revisão". Somando os grupos sem dado nenhum,
 * pediria 389 revisões na produção quando 134 são decidíveis, e contradiria a
 * própria fila, que já os separa. Dois números discordando na mesma tela é o
 * defeito.
 */
describe('o contador do aviso', () => {
  it('separa o que pede alguém do que espera um dado', async () => {
    const servico = new DuplicidadeService({} as never, {} as never);
    const grupo = (candidatos: CandidatoDuplicata[], chave: string) => ({
      chave, confianca: 'ALTA' as const, criterio: 'nome idêntico', motivoSugestao: null,
      decidiu: true, contradicoes: [], esperandoDado: esperandoDado(candidatos),
      nomeConfirmado: true, candidatos,
    });
    jest.spyOn(servico, 'varrer').mockResolvedValue([
      grupo([base({ id: '1', cpf: '12345678900' }), base({ id: '2' })], 'a'),
      grupo([base({ id: '3', cidade: 'Teresina' }), base({ id: '4' })], 'b'),
      grupo([base({ id: '5' }), base({ id: '6' })], 'c'),
    ]);
    await expect(servico.pendentes()).resolves.toEqual({ pendentes: 1, esperandoDado: 2 });
  });
});

/**
 * O PAINEL E A FILA TÊM DE CONTAR A MESMA COISA (18/09/2026).
 *
 * Havia duas contas no ar: o painel contava `manterId` distintos e a fila
 * contava grupos. Um cadastro pode estar em DOIS grupos — no de nome idêntico e
 * no de nome contido —, então nem "quantos donos" é "quantos grupos somem", nem
 * a fila de hoje é o que sobra depois do lote.
 */
describe('o resumo do lote', () => {
  const grupo = (chave: string, candidatos: CandidatoDuplicata[]) => ({
    chave, confianca: 'ALTA' as const, criterio: 'nome idêntico', motivoSugestao: null,
    decidiu: true, contradicoes: [], esperandoDado: esperandoDado(candidatos),
    nomeConfirmado: true, candidatos,
  });

  it('dois grupos que terminam no MESMO cadastro contam como dois grupos fechados', async () => {
    const servico = new DuplicidadeService({} as never, {} as never);
    const x = base({ id: 'x', matricula: '1', cpf: '12345678900' });
    jest.spyOn(servico, 'varrer').mockResolvedValue([
      grupo('a', [x, base({ id: 'y', matricula: '2' })]),
      grupo('b', [x, base({ id: 'z', matricula: '3' })]),
    ]);
    const r = await servico.resumoDoLote();
    expect(r.itens).toHaveLength(2);
    expect(new Set(r.itens.map((i) => i.manterId)).size).toBe(1); // a conta velha diria 1
    expect(r.gruposResolvidos).toBe(2);
  });

  it('grupo sem dado que o lote dissolve por outro caminho não conta como esperando', async () => {
    const servico = new DuplicidadeService({} as never, {} as never);
    const x = base({ id: 'x', matricula: '1', cpf: '12345678900' });
    const y = base({ id: 'y', matricula: '2' });
    const z = base({ id: 'z', matricula: '3' });
    jest.spyOn(servico, 'varrer').mockResolvedValue([
      grupo('a', [x, y]),
      grupo('b', [x, z]),
      // y e z também formam grupo entre si, e nenhum dos dois tem dado: seria
      // "esperando dado" — mas os dois somem no lote pelos grupos de cima.
      grupo('c', [y, z]),
      // Este sobra de verdade.
      grupo('d', [base({ id: 'p', matricula: '4' }), base({ id: 'q', matricula: '5' })]),
    ]);
    const r = await servico.resumoDoLote();
    expect(r.gruposResolvidos).toBe(3);
    expect(r.gruposEsperandoDado).toBe(1);
  });
});
