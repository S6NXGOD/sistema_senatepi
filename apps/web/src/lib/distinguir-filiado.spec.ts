import {
  avisoDeNomeRepetido,
  comoDistinguir,
  nomeComparavel,
  nomesRepetidos,
  type FichaNaLista,
} from './distinguir-filiado';

/**
 * O PRINT DO DONO — 22/09/2026.
 *
 * Buscando "erica" na abertura de um atendimento, a lista trouxe **duas "ÉRICA
 * CINARA FRAZÃO PESSOA" idênticas na tela**. A leitura dele foi "os duplicados
 * não foram removidos". São duas coisas, e só uma é defeito:
 *
 *  · EXISTIREM duas fichas com o mesmo nome. Medido na produção: 145 grupos,
 *    317 fichas. Nos 3 grupos em que há veredito (as duas têm CPF), os CPFs são
 *    DIFERENTES — são pessoas diferentes. Um dos pares tem o mesmo nome, a
 *    mesma cidade, foi criado no mesmo dia e tem matrículas consecutivas (5879
 *    e 5880): dois CPFs válidos, duas pessoas. Fundir por nome apagaria gente.
 *  · a lista não deixar DISTINGUIR as duas. Isto é defeito, e é o que este
 *    arquivo trava.
 */

const ERICA_A: FichaNaLista = {
  id: 'a',
  nome: 'ÉRICA CINARA FRAZÃO PESSOA',
  cpfMascarado: null,
  matricula: '3496',
  cidade: null,
  dataFiliacao: '2014-10-17T00:00:00.000Z',
};
const ERICA_B: FichaNaLista = {
  id: 'b',
  nome: 'ÉRICA CINARA FRAZÃO PESSOA',
  cpfMascarado: null,
  matricula: '2617',
  cidade: null,
  dataFiliacao: '2026-07-03T00:00:00.000Z',
};
const ERICA_C: FichaNaLista = {
  id: 'c',
  nome: 'ERICA CINARA FRAZAO PESSOA CARVALHO',
  cpfMascarado: '***.304.253-**',
  matricula: '6407',
};

describe('o caso do print', () => {
  it('as duas homônimas deixam de sair iguais', () => {
    const repetidos = nomesRepetidos([ERICA_A, ERICA_B, ERICA_C]);
    const a = comoDistinguir(ERICA_A, repetidos.has(nomeComparavel(ERICA_A.nome)));
    const b = comoDistinguir(ERICA_B, repetidos.has(nomeComparavel(ERICA_B.nome)));
    expect(a).not.toBe(b);
    expect(a).toContain('matrícula 3496');
    expect(b).toContain('matrícula 2617');
    expect(a).toContain('desde 2014');
  });

  /** A terceira tem CPF e nome próprio: não precisa de matrícula poluindo. */
  it('a ficha de nome único mostra o CPF e nada de matrícula', () => {
    const repetidos = nomesRepetidos([ERICA_A, ERICA_B, ERICA_C]);
    const c = comoDistinguir(ERICA_C, repetidos.has(nomeComparavel(ERICA_C.nome)));
    expect(c).toBe('***.304.253-**');
  });

  it('a lista avisa que há nome repetido', () => {
    expect(avisoDeNomeRepetido([ERICA_A, ERICA_B, ERICA_C])).toMatch(/mesmo nome/i);
  });

  /**
   * E NÃO CHAMA DE DUPLICATA. Na medição, homônimo é o caso comum nesta base;
   * anunciar "duplicata" levaria alguém a apagar a ficha de outra pessoa.
   */
  it('o aviso não acusa duplicata', () => {
    const aviso = avisoDeNomeRepetido([ERICA_A, ERICA_B]) ?? '';
    expect(aviso.toLowerCase()).not.toContain('duplicad');
    expect(aviso.toLowerCase()).not.toContain('repetida');
  });

  it('sem repetição, nenhum aviso — aviso que sai sempre é cabeçalho', () => {
    expect(avisoDeNomeRepetido([ERICA_C])).toBeNull();
    expect(avisoDeNomeRepetido([])).toBeNull();
  });
});

describe('o nome comparável', () => {
  it('ignora acento, caixa e espaço sobrando', () => {
    expect(nomeComparavel('ÉRICA  cinara FRAZÃO')).toBe('ERICA CINARA FRAZAO');
  });

  /** "ÉRICA" e "ERICA" são a mesma grafia para quem lê — e para a contagem. */
  it('a grafia com e sem acento conta como o mesmo nome', () => {
    const repetidos = nomesRepetidos([
      { id: '1', nome: 'ÉRICA CINARA' },
      { id: '2', nome: 'ERICA CINARA' },
    ]);
    expect(repetidos.size).toBe(1);
  });

  it('nome diferente não vira repetição', () => {
    expect(nomesRepetidos([ERICA_A, ERICA_C]).size).toBe(0);
  });
});

describe('a ordem do que mostrar', () => {
  it('o CPF vem primeiro — é o que identifica a pessoa', () => {
    expect(
      comoDistinguir({ id: '1', nome: 'X', cpfMascarado: '***.111.222-**', cidade: 'Teresina' }),
    ).toBe('***.111.222-** · Teresina');
  });

  it('sem CPF, a cidade com o estado', () => {
    expect(comoDistinguir({ id: '1', nome: 'X', cidade: 'Timon', estado: 'MA' })).toBe('Timon/MA');
  });

  it('sem CPF e sem cidade, o empregador', () => {
    expect(
      comoDistinguir({ id: '1', nome: 'X', vinculos: [{ empresa: 'FMS Teresina' }] }),
    ).toBe('FMS Teresina');
  });

  it('sem nada disso, desde quando é filiado', () => {
    expect(comoDistinguir({ id: '1', nome: 'X', dataFiliacao: '2019-11-22' })).toBe('desde 2019');
  });

  /** Ficha sem absolutamente nada e nome único: linha vazia, e não "—". */
  it('sem nada e sem repetição, a linha não existe', () => {
    expect(comoDistinguir({ id: '1', nome: 'X' })).toBe('');
  });

  /** Mesmo vazia, a matrícula salva a escolha quando o nome se repete. */
  it('sem nada, mas repetido: sobra a matrícula', () => {
    expect(comoDistinguir({ id: '1', nome: 'X', matricula: '008015' }, true)).toBe(
      'matrícula 008015',
    );
  });

  /**
   * A LINHA NÃO CRESCE SEM FIM. Duas informações bastam para escolher; a
   * terceira empurra o nome para cima no celular e não muda a decisão.
   */
  it('para em duas informações, mais a matrícula quando repete', () => {
    const cheia = comoDistinguir(
      {
        id: '1',
        nome: 'X',
        cpfMascarado: '***.111.222-**',
        cidade: 'Teresina',
        estado: 'PI',
        vinculos: [{ empresa: 'FMS' }],
        dataFiliacao: '2019-01-01',
        matricula: '99',
      },
      true,
    );
    expect(cheia).toBe('***.111.222-** · Teresina/PI · matrícula 99');
  });

  it('vínculo sem empresa não vira linha em branco', () => {
    expect(comoDistinguir({ id: '1', nome: 'X', vinculos: [{ empresa: '  ' }] })).toBe('');
  });

  it('data inválida não vira "desde NaN"', () => {
    expect(comoDistinguir({ id: '1', nome: 'X', dataFiliacao: 'sei lá' })).toBe('');
  });
});
