import { FRASE_SEM_OAB, idsSemOab, linhasDaCobertura } from './djen-cobertura';

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
      'O histórico deste processo no Diário ainda não foi lido. Ele entra numa das próximas noites, ou agora pelo botão Sincronizar.',
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
