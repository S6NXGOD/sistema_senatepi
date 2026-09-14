import {
  O_QUE_O_LINK_CONFIRMA, confirmacaoDoRecadastramento, conferirResposta, cpfUtil, definirDesafio,
  nascimentoUtil, observacaoDoRecadastramentoOnline, podeGerarLink,
} from './desafio-do-link';

/**
 * A HIERARQUIA DO DESAFIO E A CONFERÊNCIA — com valores (14/09/2026).
 *
 * Os CPFs abaixo têm o dígito verificador calculado à mão:
 *   123.456.789-09 e 529.982.247-25 valem; 123.456.789-00 não;
 *   012.345.678-90 vale, mas gravado sem o zero ("1234567890") não serve.
 */

const AGORA = new Date('2026-09-14T15:00:00.000Z'); // 12h00 em Teresina
const CPF_OK = '12345678909';
const NASC_OK = new Date('1980-05-10T03:00:00.000Z');

const cadastro = (p: Partial<{ cpf: string | null; dataNascimento: Date | null; numeroCoren: string | null }> = {}) => ({
  cpf: null, dataNascimento: null, numeroCoren: null, ...p,
});
const decidir = (c: ReturnType<typeof cadastro>, corenVisivel = true) =>
  definirDesafio(c, { agora: AGORA, corenVisivel });

describe('cpfUtil — só pergunta o CPF que o filiado consegue repetir', () => {
  it.each([
    ['12345678909', true],
    ['123.456.789-09', true],
    ['52998224725', true],
    ['01234567890', true],
    ['12345678900', false], // dígito verificador errado
    ['11111111111', false], // todos iguais
    ['1234567890', false], // 10 dígitos: o filiado digitaria 11 e nunca bateria
    ['', false],
    [null, false],
  ])('cpfUtil(%p) → %p', (cpf, esperado) => {
    expect(cpfUtil(cpf)).toBe(esperado);
  });
});

describe('nascimentoUtil — de 1920 para cá e de pelo menos 14 anos atrás', () => {
  it.each([
    ['1980-05-10T03:00:00.000Z', true],
    ['1920-01-01T00:00:00.000Z', true],
    ['1919-12-31T03:00:00.000Z', false],
    ['1900-01-01T00:00:00.000Z', false], // placeholder de carga
    ['2012-09-14T03:00:00.000Z', true], // faz 14 anos hoje
    ['2012-09-15T03:00:00.000Z', false], // faz 14 amanhã
    ['2026-01-01T03:00:00.000Z', false],
  ])('%s → %p', (iso, esperado) => {
    expect(nascimentoUtil(new Date(iso), AGORA)).toBe(esperado);
  });

  it('nula ou inválida não serve', () => {
    expect(nascimentoUtil(null, AGORA)).toBe(false);
    expect(nascimentoUtil(new Date('não é data'), AGORA)).toBe(false);
  });
});

describe('definirDesafio — a hierarquia', () => {
  it('CPF útil e nascimento útil: CPF_NASCIMENTO', () => {
    expect(decidir(cadastro({ cpf: CPF_OK, dataNascimento: NASC_OK, numeroCoren: '123456' }))).toBe('CPF_NASCIMENTO');
  });

  it('só o CPF útil: CPF — e não mais NENHUM (1.768 ativos em 14/09/2026)', () => {
    expect(decidir(cadastro({ cpf: CPF_OK }))).toBe('CPF');
  });

  it('CPF sem nascimento COM COREN: CPF, que desceu o COREN um degrau', () => {
    expect(decidir(cadastro({ cpf: CPF_OK, numeroCoren: '123456' }))).toBe('CPF');
  });

  it('sem CPF útil, com COREN: COREN só onde o campo aparece', () => {
    expect(decidir(cadastro({ numeroCoren: '123456', dataNascimento: NASC_OK }), true)).toBe('COREN');
    // No SINDSERM o COREN é oculto: cai no nascimento, ou em nada.
    expect(decidir(cadastro({ numeroCoren: '123456', dataNascimento: NASC_OK }), false)).toBe('NASCIMENTO');
    expect(decidir(cadastro({ numeroCoren: '123456' }), false)).toBe('NENHUM');
    expect(decidir(cadastro({ numeroCoren: '   ' }), true)).toBe('NENHUM');
  });

  it('só o nascimento útil: NASCIMENTO', () => {
    expect(decidir(cadastro({ dataNascimento: NASC_OK }))).toBe('NASCIMENTO');
  });

  it('nada: NENHUM', () => {
    expect(decidir(cadastro())).toBe('NENHUM');
  });

  /** O desafio impossível que a regra antiga montava: agora o dado ruim desce. */
  it('CPF ou data que existem mas não servem descem na hierarquia', () => {
    expect(decidir(cadastro({ cpf: '12345678900', dataNascimento: NASC_OK }))).toBe('NASCIMENTO');
    expect(decidir(cadastro({ cpf: '1234567890', dataNascimento: NASC_OK }))).toBe('NASCIMENTO');
    expect(decidir(cadastro({ cpf: CPF_OK, dataNascimento: new Date('1900-01-01T00:00:00.000Z') }))).toBe('CPF');
    expect(decidir(cadastro({ cpf: '11111111111', dataNascimento: new Date('1900-01-01T00:00:00.000Z') }))).toBe('NENHUM');
  });

  it('MATRICULA não é valor possível (0 filiados na medição)', () => {
    const possiveis = new Set(Object.keys(O_QUE_O_LINK_CONFIRMA));
    expect([...possiveis].sort()).toEqual(['COREN', 'CPF', 'CPF_NASCIMENTO', 'NASCIMENTO', 'NENHUM']);
  });
});

describe('podeGerarLink', () => {
  it('só o NENHUM é recusado', () => {
    expect(['CPF_NASCIMENTO', 'CPF', 'COREN', 'NASCIMENTO', 'NENHUM'].map((d) => podeGerarLink(d as never)))
      .toEqual([true, true, true, true, false]);
  });
});

describe('conferirResposta — cada desafio lê só o próprio campo', () => {
  const COMPLETO = cadastro({ cpf: CPF_OK, dataNascimento: NASC_OK, numeroCoren: 'PI-123.456' });

  it('CPF_NASCIMENTO exige os dois', () => {
    expect(conferirResposta('CPF_NASCIMENTO', COMPLETO, { cpf: '123.456.789-09', dataNascimento: '1980-05-10' })).toBe(true);
    expect(conferirResposta('CPF_NASCIMENTO', COMPLETO, { cpf: '123.456.789-09' })).toBe(false);
    expect(conferirResposta('CPF_NASCIMENTO', COMPLETO, { dataNascimento: '1980-05-10' })).toBe(false);
    expect(conferirResposta('CPF_NASCIMENTO', COMPLETO, { cpf: '123.456.789-09', dataNascimento: '1980-05-11' })).toBe(false);
  });

  it('CPF confere pelos dígitos, com ou sem máscara', () => {
    const c = cadastro({ cpf: CPF_OK });
    expect(conferirResposta('CPF', c, { cpf: '123.456.789-09' })).toBe(true);
    expect(conferirResposta('CPF', c, { cpf: '12345678909' })).toBe(true);
    expect(conferirResposta('CPF', c, { cpf: '52998224725' })).toBe(false);
  });

  it('NASCIMENTO confere o dia nas duas convenções gravadas', () => {
    // Meia-noite UTC de 10/05 é 21h do dia 09 em Brasília: os dois dias valem.
    const c = cadastro({ dataNascimento: new Date('1980-05-10T00:00:00.000Z') });
    expect(conferirResposta('NASCIMENTO', c, { dataNascimento: '1980-05-10' })).toBe(true);
    expect(conferirResposta('NASCIMENTO', c, { dataNascimento: '1980-05-09' })).toBe(true);
    expect(conferirResposta('NASCIMENTO', c, { dataNascimento: '1980-05-08' })).toBe(false);
  });

  it('COREN compara só letras e números', () => {
    expect(conferirResposta('COREN', COMPLETO, { coren: 'pi123456' })).toBe(true);
    expect(conferirResposta('COREN', COMPLETO, { coren: '123456' })).toBe(false);
  });

  it('resposta vazia nunca confere, nem com cadastro vazio', () => {
    const vazio = cadastro();
    for (const d of ['CPF_NASCIMENTO', 'CPF', 'NASCIMENTO', 'COREN'] as const) {
      expect(`${d}: ${conferirResposta(d, vazio, {})}`).toBe(`${d}: false`);
      expect(`${d}: ${conferirResposta(d, vazio, { cpf: '', dataNascimento: '', coren: '' })}`).toBe(`${d}: false`);
    }
  });

  /**
   * A PÁGINA ANTIGA (em cache no celular) manda CPF E data para todo desafio
   * que não seja COREN. Se alguém "simplificar" a conferência voltando a exigir
   * os dois, os links CPF e NASCIMENTO param de conferir em silêncio.
   */
  it('o corpo da página antiga confere nos desafios de um fator só', () => {
    const soCpf = cadastro({ cpf: CPF_OK });
    const soData = cadastro({ dataNascimento: NASC_OK });
    // O que ela manda: o CPF digitado e a data digitada, mesmo sem o cadastro ter um dos dois.
    expect(conferirResposta('CPF', soCpf, { cpf: '12345678909', dataNascimento: '1991-01-01' })).toBe(true);
    expect(conferirResposta('NASCIMENTO', soData, { cpf: '52998224725', dataNascimento: '1980-05-10' })).toBe(true);
    // E o que ela manda quando a pessoa deixa o outro campo em branco.
    expect(conferirResposta('CPF', soCpf, { cpf: '12345678909' })).toBe(true);
    expect(conferirResposta('NASCIMENTO', soData, { dataNascimento: '1980-05-10' })).toBe(true);
  });

  it('NENHUM (link vivo de antes de 14/09) passa; valor desconhecido falha fechado', () => {
    expect(conferirResposta('NENHUM', cadastro(), {})).toBe(true);
    expect(conferirResposta('MATRICULA' as never, COMPLETO, { cpf: CPF_OK, dataNascimento: '1980-05-10' })).toBe(false);
  });
});

describe('observação do recadastramento pelo link', () => {
  it('continua começando com "Recadastramento ONLINE" e diz como confirmou', () => {
    expect(observacaoDoRecadastramentoOnline('CPF')).toBe(
      'Recadastramento ONLINE feito pelo próprio filiado (link; confirmado só pelo CPF).',
    );
    expect(observacaoDoRecadastramentoOnline('NASCIMENTO')).toBe(
      'Recadastramento ONLINE feito pelo próprio filiado (link; confirmado só pela data de nascimento).',
    );
  });

  it('lê de volta o que escreveu, para todos os desafios', () => {
    for (const d of ['CPF_NASCIMENTO', 'CPF', 'COREN', 'NASCIMENTO', 'NENHUM'] as const) {
      expect(confirmacaoDoRecadastramento(observacaoDoRecadastramentoOnline(d))).toBe(d);
    }
  });

  it('a observação antiga ("(link).") e o presencial não dizem: null', () => {
    expect(confirmacaoDoRecadastramento('Recadastramento ONLINE feito pelo próprio filiado (link).')).toBeNull();
    expect(confirmacaoDoRecadastramento(null)).toBeNull();
    expect(confirmacaoDoRecadastramento('qualquer outra')).toBeNull();
  });
});
