import {
  destinoDoErroDoDesafio,
  ErroDoRecadastro,
  faltaNoDesafio,
  pedidoDoDesafio,
  recadastramentosAConferir,
  respostaDoDesafio,
  telaDoLinkDireto,
  valorDaAlteracao,
  type DesafioRecadastramento,
} from './recadastro';

/*
  A lista sai do tipo, e não de uma constante do código (15/09/2026): a
  `DESAFIOS_CONHECIDOS` só existia para este teste. O `Record` obriga a
  acrescentar aqui qualquer valor novo do tipo, ou o spec não compila.
*/
const TODOS_OS_DESAFIOS: Record<DesafioRecadastramento, true> = {
  CPF_NASCIMENTO: true, CPF: true, COREN: true, NASCIMENTO: true, NENHUM: true,
  IDENTIFICACAO: true,
};
const DESAFIOS_CONHECIDOS = Object.keys(TODOS_OS_DESAFIOS) as DesafioRecadastramento[];

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

/**
 * A PRIMEIRA TELA DA PÁGINA PÚBLICA (14/09/2026).
 *
 * Antes, todo valor diferente de COREN caía no formulário de CPF e data. Com os
 * desafios de um dado só, um link CPF mostraria um campo de data que ninguém ia
 * conferir, e um valor desconhecido gastaria as 5 tentativas.
 */
describe('pedidoDoDesafio', () => {
  it('CPF + nascimento: os dois campos e a frase de sempre', () => {
    expect(pedidoDoDesafio('CPF_NASCIMENTO')).toEqual({
      tipo: 'FORMULARIO',
      campos: ['CPF', 'NASCIMENTO'],
      frase: 'Para sua segurança, confirme seus dados antes de atualizar o cadastro.',
    });
  });

  it('só o CPF: um campo', () => {
    expect(pedidoDoDesafio('CPF')).toEqual({
      tipo: 'FORMULARIO',
      campos: ['CPF'],
      frase: 'Para sua segurança, confirme o seu CPF antes de atualizar o cadastro.',
    });
  });

  it('só a data de nascimento: um campo', () => {
    expect(pedidoDoDesafio('NASCIMENTO')).toEqual({
      tipo: 'FORMULARIO',
      campos: ['NASCIMENTO'],
      frase: 'Para sua segurança, confirme a sua data de nascimento antes de atualizar o cadastro.',
    });
  });

  it('COREN: um campo', () => {
    expect(pedidoDoDesafio('COREN')).toEqual({
      tipo: 'FORMULARIO',
      campos: ['COREN'],
      frase: 'Para sua segurança, confirme o número do seu COREN antes de atualizar o cadastro.',
    });
  });

  it('NENHUM (link antigo ainda vivo): abre direto', () => {
    expect(pedidoDoDesafio('NENHUM')).toEqual({ tipo: 'DIRETO' });
  });

  /** Página velha em cache contra API nova: recarregar, nunca o formulário errado. */
  it.each([['MATRICULA'], ['cpf'], [''], [null], [undefined]])(
    'valor desconhecido %p: página desatualizada',
    (valor) => {
      expect(pedidoDoDesafio(valor)).toEqual({ tipo: 'DESATUALIZADA' });
    },
  );

  it('todo desafio que o tipo conhece tem tela própria', () => {
    for (const d of DESAFIOS_CONHECIDOS) {
      expect(pedidoDoDesafio(d).tipo).not.toBe('DESATUALIZADA');
    }
  });

  it('frases sem emoji', () => {
    for (const d of DESAFIOS_CONHECIDOS) {
      const p = pedidoDoDesafio(d);
      if (p.tipo === 'FORMULARIO') expect(p.frase).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});

describe('respostaDoDesafio — só vai o que o desafio pede', () => {
  const digitado = { cpf: '529.982.247-25', nascimento: '1984-03-07', coren: ' COREN-PI 123456-ENF ' };

  it('CPF + nascimento: os dois, CPF só com dígitos', () => {
    expect(respostaDoDesafio(pedidoDoDesafio('CPF_NASCIMENTO'), digitado)).toEqual({
      cpf: '52998224725',
      dataNascimento: '1984-03-07',
    });
  });

  it('link CPF: a data digitada antes (outro link, autopreenchimento) não vai', () => {
    expect(respostaDoDesafio(pedidoDoDesafio('CPF'), digitado)).toEqual({ cpf: '52998224725' });
  });

  it('link NASCIMENTO: só a data', () => {
    expect(respostaDoDesafio(pedidoDoDesafio('NASCIMENTO'), digitado)).toEqual({ dataNascimento: '1984-03-07' });
  });

  it('link COREN: só o COREN, aparado', () => {
    expect(respostaDoDesafio(pedidoDoDesafio('COREN'), digitado)).toEqual({ coren: 'COREN-PI 123456-ENF' });
  });

  it('link direto ou desatualizado: nada', () => {
    expect(respostaDoDesafio(pedidoDoDesafio('NENHUM'), digitado)).toEqual({});
    expect(respostaDoDesafio(pedidoDoDesafio('MATRICULA'), digitado)).toEqual({});
  });

  it('campo vazio não vai como string vazia', () => {
    expect(respostaDoDesafio(pedidoDoDesafio('CPF_NASCIMENTO'), { cpf: '', nascimento: '', coren: '' })).toEqual({});
  });
});

/** Cada resposta errada conta nas 5 tentativas: erro de digitação não pode gastar uma. */
describe('faltaNoDesafio', () => {
  const vazio = { cpf: '', nascimento: '', coren: '' };

  it('CPF vazio', () => {
    expect(faltaNoDesafio(pedidoDoDesafio('CPF'), vazio)).toBe('Preencha o CPF.');
  });

  it('CPF pela metade', () => {
    expect(faltaNoDesafio(pedidoDoDesafio('CPF'), { ...vazio, cpf: '529.982.24' })).toBe(
      'Confira o CPF: são 11 números.',
    );
  });

  it('CPF completo no link CPF: pode enviar', () => {
    expect(faltaNoDesafio(pedidoDoDesafio('CPF'), { ...vazio, cpf: '529.982.247-25' })).toBeNull();
  });

  it('CPF + nascimento sem a data', () => {
    expect(faltaNoDesafio(pedidoDoDesafio('CPF_NASCIMENTO'), { ...vazio, cpf: '52998224725' })).toBe(
      'Preencha a data de nascimento.',
    );
  });

  it('link NASCIMENTO não cobra CPF', () => {
    expect(faltaNoDesafio(pedidoDoDesafio('NASCIMENTO'), { ...vazio, nascimento: '1984-03-07' })).toBeNull();
    expect(faltaNoDesafio(pedidoDoDesafio('NASCIMENTO'), vazio)).toBe('Preencha a data de nascimento.');
  });

  it('COREN em branco', () => {
    expect(faltaNoDesafio(pedidoDoDesafio('COREN'), { ...vazio, coren: '   ' })).toBe('Preencha o número do COREN.');
  });

  it('link direto nunca cobra nada', () => {
    expect(faltaNoDesafio(pedidoDoDesafio('NENHUM'), vazio)).toBeNull();
  });
});

/**
 * ONDE O ERRO DA CONFIRMAÇÃO APARECE (15/09/2026). As frases e os status são os
 * que `link-recadastramento.service.ts` devolve.
 */
describe('destinoDoErroDoDesafio', () => {
  it('dado errado com tentativas sobrando: a linha fixa acima do botão', () => {
    expect(destinoDoErroDoDesafio(new ErroDoRecadastro('Dados não conferem. Restam 3 tentativa(s).', 403))).toBe('LINHA');
  });

  it('a 5ª errada queima o link: tela de link indisponível', () => {
    expect(
      destinoDoErroDoDesafio(
        new ErroDoRecadastro('Muitas tentativas incorretas. Este link foi bloqueado — solicite um novo ao sindicato.', 403),
      ),
    ).toBe('LINK');
  });

  it('cancelado, vencido ou inexistente (410 e 404): tela de link indisponível', () => {
    expect(destinoDoErroDoDesafio(new ErroDoRecadastro('Este link foi cancelado. Solicite um novo ao sindicato.', 410))).toBe('LINK');
    expect(destinoDoErroDoDesafio(new ErroDoRecadastro('Este link expirou. Solicite um novo ao sindicato.', 410))).toBe('LINK');
    expect(destinoDoErroDoDesafio(new ErroDoRecadastro('Link inválido ou inexistente.', 404))).toBe('LINK');
  });

  it('falha de rede (sem status) fica na linha: dá para tentar de novo', () => {
    expect(destinoDoErroDoDesafio(new TypeError('Failed to fetch'))).toBe('LINHA');
    expect(destinoDoErroDoDesafio(undefined)).toBe('LINHA');
  });

  it('o erro guarda o status e a frase da API', () => {
    const e = new ErroDoRecadastro('Dados não conferem. Restam 1 tentativa(s).', 403);
    expect(e).toBeInstanceOf(Error);
    expect([e.status, e.message]).toEqual([403, 'Dados não conferem. Restam 1 tentativa(s).']);
  });
});

/** O link antigo sem confirmação mostrava "Não foi possível abrir" antes de tentar. */
describe('telaDoLinkDireto', () => {
  it('primeiro desenho, antes do efeito: abrindo, nunca falhou', () => {
    expect(telaDoLinkDireto({ validando: false, tentouUmaVez: false })).toBe('ABRINDO');
  });

  it('validando: abrindo', () => {
    expect(telaDoLinkDireto({ validando: true, tentouUmaVez: false })).toBe('ABRINDO');
    expect(telaDoLinkDireto({ validando: true, tentouUmaVez: true })).toBe('ABRINDO');
  });

  it('só depois de uma tentativa terminada é que falhou', () => {
    expect(telaDoLinkDireto({ validando: false, tentouUmaVez: true })).toBe('FALHOU');
  });
});
