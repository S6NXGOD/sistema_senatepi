import {
  FRASE_OAB_SEM_UF, FRASE_SEM_OAB, fraseSemOab, idsSemOab, linhasDaCobertura, partesDaCobertura,
} from './djen-cobertura';

/**
 * A LINHA DE COBERTURA E A LISTA DE QUEM ESTÁ SEM OAB — com valores.
 *
 * As frases nascem na API (djen-leitura.util.spec.ts testa o texto). Aqui se
 * testa o que o web decide: mostrar, filtrar ou calar.
 */

describe('linhasDaCobertura', () => {
  const daApi = {
    porOab: [{ id: 'u1', nome: 'Dra. Morgana' }],
    ultimaConsultaNumero: '2026-09-12T08:07:00.000Z',
    historicoLidoEm: null,
    frequenciaDoNumero: 'TODA_NOITE' as const,
    linhas: [
      'Acompanhado no Diário pela OAB de Dra. Morgana e pelo número do processo.',
      'Consultado no Diário pelo número em 12/09.',
      'O histórico deste processo no Diário ainda não foi lido. Ele entra numa das próximas noites, ou agora pelo botão Buscar no DJEN, na aba Publicações.',
    ],
  };

  it('mostra as frases da API na ordem, sem recalcular', () => {
    expect(linhasDaCobertura(daApi)).toEqual(daApi.linhas);
  });

  it('frase vazia ou que não é texto some', () => {
    expect(
      linhasDaCobertura({ ...daApi, linhas: ['  Ainda não consultado pelo número. ', '', 42 as unknown as string] }),
    ).toEqual(['Ainda não consultado pelo número.']);
  });

  /** Janela de troca: a API antiga não tem a rota, e a tela não afirma nada. */
  it('sem resposta, sem `linhas` ou com a lista vazia: nenhuma linha', () => {
    expect(linhasDaCobertura(undefined)).toBeNull();
    expect(linhasDaCobertura(null)).toBeNull();
    expect(linhasDaCobertura({ porOab: [], ultimaConsultaNumero: null })).toBeNull();
    expect(linhasDaCobertura({ ...daApi, linhas: [] })).toBeNull();
    expect(linhasDaCobertura({ ...daApi, linhas: 'texto solto' as unknown as string[] })).toBeNull();
  });
});

/** 15/09/2026: a principal numa linha, o resto embaixo. */
describe('partesDaCobertura', () => {
  it('a primeira frase é a principal; a data e o histórico vão embaixo, na ordem da API', () => {
    expect(
      partesDaCobertura({
        porOab: [{ id: 'u1', nome: 'Dra. Morgana' }],
        ultimaConsultaNumero: '2026-09-12T08:07:00.000Z',
        linhas: [
          'Acompanhado no Diário pela OAB de Dra. Morgana e pelo número do processo.',
          'Consultado no Diário pelo número em 12/09.',
          'O histórico deste processo no Diário ainda não foi lido. Ele entra numa das próximas noites, ou agora pelo botão Buscar no DJEN, na aba Publicações.',
        ],
      }),
    ).toEqual({
      principal: 'Acompanhado no Diário pela OAB de Dra. Morgana e pelo número do processo.',
      apoio: [
        'Consultado no Diário pelo número em 12/09.',
        'O histórico deste processo no Diário ainda não foi lido. Ele entra numa das próximas noites, ou agora pelo botão Buscar no DJEN, na aba Publicações.',
      ],
    });
  });

  it('processo sem número: só a principal, sem linha de apoio vazia', () => {
    expect(
      partesDaCobertura({
        porOab: [],
        ultimaConsultaNumero: null,
        linhas: ['Sem número do processo: o Diário só pode ser consultado depois da distribuição.'],
      }),
    ).toEqual({
      principal: 'Sem número do processo: o Diário só pode ser consultado depois da distribuição.',
      apoio: [],
    });
  });

  it('frase em branco na frente não vira principal vazia', () => {
    expect(partesDaCobertura({ porOab: [], ultimaConsultaNumero: null, linhas: ['  ', 'Ainda não consultado pelo número.'] })).toEqual({
      principal: 'Ainda não consultado pelo número.',
      apoio: [],
    });
  });

  it('janela de troca, sem `linhas`: nada', () => {
    expect(partesDaCobertura(undefined)).toBeNull();
    expect(partesDaCobertura({ porOab: [], ultimaConsultaNumero: null })).toBeNull();
  });
});

describe('fraseSemOab — qual das duas frases', () => {
  it('sem número de OAB: "Sem OAB no cadastro"', () => {
    expect(fraseSemOab({ oab: null, oabUf: null })).toEqual({ frase: FRASE_SEM_OAB, acao: 'Preencher OAB' });
    expect(fraseSemOab({ oab: '   ', oabUf: 'PI' })).toEqual({ frase: FRASE_SEM_OAB, acao: 'Preencher OAB' });
  });

  /** A Lara Cortez com o número e sem a UF lia "Sem OAB" olhando para o número. */
  it('número sem UF: "OAB incompleta: falta a UF"', () => {
    expect(fraseSemOab({ oab: '12345', oabUf: null })).toEqual({ frase: FRASE_OAB_SEM_UF, acao: 'Preencher a UF' });
    expect(fraseSemOab({ oab: '12345', oabUf: '' })).toEqual({ frase: FRASE_OAB_SEM_UF, acao: 'Preencher a UF' });
  });

  it('UF com uma letra só também está incompleta (a API não consulta)', () => {
    expect(fraseSemOab({ oab: '12.345', oabUf: 'P' }).frase).toBe(FRASE_OAB_SEM_UF);
  });

  it('campos ausentes (API antiga): a frase de sempre', () => {
    expect(fraseSemOab({}).frase).toBe(FRASE_SEM_OAB);
  });

  it('a frase nova, sem cor de erro na palavra', () => {
    expect(FRASE_OAB_SEM_UF).toBe('OAB incompleta: falta a UF. O robô do Diário não recebe as intimações desta pessoa.');
    expect(FRASE_OAB_SEM_UF).not.toMatch(/erro|falh|vencid/i);
  });
});

describe('idsSemOab', () => {
  it('a lista da API vira o conjunto de ids', () => {
    const ids = idsSemOab({
      ativo: true,
      advogadosSemOab: [{ id: 'lara', nome: 'Lara Cortez' }, { id: 'ana', nome: 'Ana' }],
    });
    expect(ids).not.toBeNull();
    expect([...ids!].sort()).toEqual(['ana', 'lara']);
  });

  it('lista vazia é informação: ninguém sem OAB', () => {
    expect(idsSemOab({ ativo: true, advogadosSemOab: [] })?.size).toBe(0);
  });

  /** A API anterior a 14/09/2026 mandava um NÚMERO no resumo, nunca a lista. */
  it('campo ausente ou em outro formato: sem informação, nenhuma linha', () => {
    expect(idsSemOab({ ativo: true })).toBeNull();
    expect(idsSemOab({ ativo: true, advogadosSemOab: 2 })).toBeNull();
    expect(idsSemOab(undefined)).toBeNull();
  });

  /** SINDSERM: DJEN desligado, nenhuma linha em ninguém. */
  it('integração desligada: nenhuma linha, mesmo com lista', () => {
    expect(idsSemOab({ ativo: false, advogadosSemOab: [{ id: 'lara', nome: 'Lara' }] })).toBeNull();
  });

  it('item sem id é ignorado', () => {
    expect([...idsSemOab({ ativo: true, advogadosSemOab: [{ nome: 'Sem id' }, null, { id: 'x' }] })!]).toEqual(['x']);
  });
});

describe('a frase da tela de Usuários', () => {
  it('é a da proposta, sem cor de erro na palavra', () => {
    expect(FRASE_SEM_OAB).toBe('Sem OAB no cadastro. O robô do Diário não recebe as intimações desta pessoa.');
    expect(FRASE_SEM_OAB).not.toMatch(/erro|falh|vencid/i);
  });
});
