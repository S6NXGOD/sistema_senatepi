import { recadastramentosAConferir, valorDaAlteracao } from './recadastro';

/**
 * O DE→PARA DA CONFERÊNCIA.
 *
 * Quem confere compara o que o filiado mandou com o que havia. Um dia a menos
 * na data de nascimento ou um "null" cru na tela fazem a equipe desconfiar do
 * dado certo.
 */
describe('valorDaAlteracao', () => {
  it.each<[string, unknown, string]>([
    ['nulo', null, 'vazio'],
    ['indefinido', undefined, 'vazio'],
    ['texto em branco', '   ', 'vazio'],
    ['texto', ' Rua A ', 'Rua A'],
    ['data pura', '1980-05-02', '02/05/1980'],
    // Meia-noite UTC é como o Prisma entrega @db.Date: não pode virar 01/05.
    ['data pura como meia-noite UTC', '1980-05-02T00:00:00.000Z', '02/05/1980'],
    ['enum com rótulo', 'UNIAO_ESTAVEL', 'União estável'],
    ['enum sem rótulo fica como veio', 'ALGO_NOVO', 'ALGO_NOVO'],
    ['verdadeiro', true, 'Sim'],
    ['falso', false, 'Não'],
    ['número', 3, '3'],
    ['lista vazia', [], 'nenhum'],
    ['vínculos', [{ empresa: 'Prefeitura' }, { empresa: 'Hospital' }], 'Prefeitura; Hospital'],
    ['dependentes', [{ nome: 'Ana', tipo: 'FILHO' }], 'Ana'],
    ['lista de textos', ['a', 'b'], 'a; b'],
  ])('%s', (_nome, entrada, esperado) => {
    expect(valorDaAlteracao(entrada)).toBe(esperado);
  });
});

describe('recadastramentosAConferir', () => {
  it('só o que veio pelo link e segue pendente', () => {
    const lista = [
      { id: '1', status: 'PENDENTE', origem: 'ONLINE' as const },
      { id: '2', status: 'APROVADO', origem: 'ONLINE' as const },
      { id: '3', status: 'APROVADO', origem: 'PRESENCIAL' as const },
      { id: '4', status: 'REJEITADO', origem: 'ONLINE' as const },
    ];
    expect(recadastramentosAConferir(lista).map((r) => r.id)).toEqual(['1']);
  });

  /** Resposta sem `origem` (versão anterior da API): pendente continua aparecendo. */
  it('pendente sem origem informada também espera conferência', () => {
    expect(recadastramentosAConferir([{ status: 'PENDENTE' }])).toHaveLength(1);
  });

  it('pendente marcado como presencial não aparece', () => {
    expect(recadastramentosAConferir([{ status: 'PENDENTE', origem: 'PRESENCIAL' as const }])).toHaveLength(0);
  });

  it('lista ausente não quebra', () => {
    expect(recadastramentosAConferir(undefined)).toEqual([]);
    expect(recadastramentosAConferir(null)).toEqual([]);
  });
});
