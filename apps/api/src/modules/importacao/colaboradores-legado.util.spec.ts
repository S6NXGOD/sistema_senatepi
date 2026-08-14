import { StatusColaborador, TipoDependente, TipoVinculo } from '@prisma/client';

import {
  lerCsv,
  lerJson,
  marcarDuplicidadeNoArquivo,
  normalizarRegistro,
  separarEndereco,
  traduzirStatus,
} from './colaboradores-legado.util';

/**
 * A REGRA QUE DECIDE O QUE ENTRA NO CADASTRO, testada sem banco.
 *
 * O que está coberto aqui é o que dói consertar depois de gravado: identidade
 * (CPF), situação de quem entra na portaria, e a família — que é metade do
 * volume da carga e a parte que ninguém confere linha a linha.
 */

const PESSOA = {
  matricula: '2025F001',
  nome: 'NOME DO FUNCIONARIO 1',
  cpf: '529.982.247-25', // CPF válido de teste
  cargo: 'Assistente de Diretoria',
  setor: 'Administrativo',
  tipo_contrato: 'funcionario',
  empresa: 'SINDSERM',
  data_admissao: '2021-03-01',
  data_nascimento: '1985-05-20',
  telefone: '(86) 99999-0000',
  email: 'funcionario1@exemplo.com',
  endereco: 'Rua Exemplo, 123',
  status: 'active',
  dependentes: [
    {
      nome: 'NOME DO DEPENDENTE 1',
      cpf: '111.111.111-11',
      parentesco: 'Filho(a)',
      data_nascimento: '2015-10-10',
    },
  ],
};

function normalizar(pessoa: Record<string, unknown>, numero = 1) {
  const [registro] = lerJson(Buffer.from(JSON.stringify([pessoa])));
  return normalizarRegistro(registro, numero);
}

describe('leitura do arquivo', () => {
  it('lê o JSON do exemplo, com os dependentes aninhados', () => {
    const linha = normalizar(PESSOA);

    expect(linha.erros).toEqual([]);
    expect(linha.dados.nome).toBe('NOME DO FUNCIONARIO 1');
    expect(linha.dados.cpf).toBe('52998224725');
    expect(linha.dados.matricula).toBe('2025F001');
    expect(linha.dados.tipoVinculo).toBe(TipoVinculo.CLT);
    expect(linha.dados.status).toBe(StatusColaborador.ATIVO);
    expect(linha.dados.dependentes).toHaveLength(1);
    expect(linha.dados.dependentes[0]).toMatchObject({
      nome: 'NOME DO DEPENDENTE 1',
      tipo: TipoDependente.FILHO,
      dataNascimento: '2015-10-10',
    });
  });

  it('aceita a lista embrulhada em { dados: [...] }', () => {
    const registros = lerJson(Buffer.from(JSON.stringify({ dados: [PESSOA] })));
    expect(registros).toHaveLength(1);
  });

  it('recusa JSON que não é lista, com mensagem que diz o que fazer', () => {
    expect(() => lerJson(Buffer.from(JSON.stringify(PESSOA)))).toThrow(/LISTA/i);
  });

  it('recusa arquivo que não é JSON', () => {
    expect(() => lerJson(Buffer.from('nome;cpf\nFulano;123'))).toThrow(/não é um JSON válido/i);
  });
});

describe('CSV — as duas formas de expressar dependente', () => {
  it('linha marcada por cpf_titular vira dependente do titular', () => {
    const registros = lerCsv([
      { nome: 'TITULAR', cpf: '529.982.247-25', tipo_contrato: 'funcionario' },
      {
        nome: 'FILHA', parentesco: 'filha', data_nascimento: '2015-10-10',
        cpf_titular: '529.982.247-25',
      },
    ]);

    expect(registros).toHaveLength(1);
    expect(registros[0].dependentes).toHaveLength(1);
  });

  /**
   * Um `ORDER BY` diferente na origem não pode fazer dependente sumir — foi por
   * isso que o titular é procurado depois de ler o arquivo inteiro.
   */
  it('encontra o titular mesmo quando o dependente vem ANTES', () => {
    const registros = lerCsv([
      {
        nome: 'FILHA', parentesco: 'filha', data_nascimento: '2015-10-10',
        matricula_titular: '2025F001',
      },
      { nome: 'TITULAR', cpf: '529.982.247-25', matricula: '2025F001', tipo_contrato: 'funcionario' },
    ]);

    expect(registros).toHaveLength(1);
    expect(registros[0].dependentes).toHaveLength(1);
  });

  it('colunas numeradas na própria linha também viram dependentes', () => {
    const registros = lerCsv([
      {
        nome: 'TITULAR', cpf: '529.982.247-25', tipo_contrato: 'funcionario',
        dependente_1_nome: 'FILHO UM',
        dependente_1_parentesco: 'filho',
        dependente_1_data_nascimento: '2015-10-10',
        // Bloco reservado e vazio é o normal numa planilha montada à mão.
        dependente_2_nome: '',
        dependente_2_parentesco: '',
      },
    ]);

    expect(registros[0].dependentes).toHaveLength(1);
    expect(registros[0].dependentes[0]).toMatchObject({ nome: 'FILHO UM' });
  });

  /** Descartar em silêncio faria o total bater com a família de alguém faltando. */
  it('dependente sem titular no arquivo vira uma linha de ERRO própria', () => {
    const registros = lerCsv([
      { nome: 'TITULAR', cpf: '529.982.247-25', tipo_contrato: 'funcionario' },
      { nome: 'ORFAO', parentesco: 'filho', cpf_titular: '111.444.777-35' },
    ]);

    expect(registros).toHaveLength(2);
    const linha = normalizarRegistro(registros[1], 2);
    expect(linha.erros[0]).toMatch(/não está no arquivo/i);
    expect(linha.codigos).toContain('DEPENDENTE_ORFAO');
  });
});

describe('identidade — o CPF é a âncora', () => {
  it('recusa a pessoa sem CPF: `colaboradores.cpf` é obrigatório e único', () => {
    const linha = normalizar({ ...PESSOA, cpf: '' });
    expect(linha.codigos).toContain('CPF_AUSENTE');
    expect(linha.erros).not.toEqual([]);
  });

  it('trata CPF de preenchimento (000…) como ausente, não como válido', () => {
    const linha = normalizar({ ...PESSOA, cpf: '000.000.000-00' });
    expect(linha.codigos).toContain('CPF_AUSENTE');
  });

  it('recusa CPF com dígito verificador errado', () => {
    const linha = normalizar({ ...PESSOA, cpf: '529.982.247-26' });
    expect(linha.codigos).toContain('CPF_INVALIDO');
  });

  it('a PRIMEIRA ocorrência do CPF passa e a segunda vira erro', () => {
    const linhas = [normalizar(PESSOA, 1), normalizar(PESSOA, 2)];
    marcarDuplicidadeNoArquivo(linhas);

    expect(linhas[0].erros).toEqual([]);
    expect(linhas[1].codigos).toContain('CPF_DUP_ARQUIVO');
    expect(linhas[1].erros[0]).toMatch(/linha 1/);
  });

  it('matrícula repetida no arquivo também é erro', () => {
    const linhas = [
      normalizar(PESSOA, 1),
      normalizar({ ...PESSOA, cpf: '111.444.777-35' }, 2),
    ];
    marcarDuplicidadeNoArquivo(linhas);
    expect(linhas[1].codigos).toContain('MATRICULA_DUP_ARQUIVO');
  });
});

describe('vínculo', () => {
  it('prestador vira PJ e guarda a empresa contratante', () => {
    const linha = normalizar({
      ...PESSOA,
      cpf: '111.444.777-35',
      tipo_contrato: 'prestador',
      empresa: 'Empresa Parceira',
      dependentes: [],
    });

    expect(linha.dados.tipoVinculo).toBe(TipoVinculo.PJ);
    expect(linha.dados.empresaNome).toBe('Empresa Parceira');
    expect(linha.erros).toEqual([]);
  });

  it('prestador SEM empresa é erro — PJ exige contratante', () => {
    const linha = normalizar({ ...PESSOA, tipo_contrato: 'prestador', empresa: '' });
    expect(linha.codigos).toContain('EMPRESA_AUSENTE');
  });

  /**
   * O empregador de um CLT do sindicato é o próprio sindicato. O aviso existe
   * porque empresa preenchida num CLT costuma significar `tipo_contrato` errado
   * na origem.
   */
  it('CLT com empresa preenchida: o campo é limpo e o operador é avisado', () => {
    const linha = normalizar(PESSOA);
    expect(linha.dados.empresaNome).toBeNull();
    expect(linha.codigos).toContain('EMPRESA_EM_CLT');
  });

  it('tipo de contrato desconhecido é erro, não chute', () => {
    const linha = normalizar({ ...PESSOA, tipo_contrato: 'colaborador eventual' });
    expect(linha.codigos).toContain('VINCULO_DESCONHECIDO');
    expect(linha.erros[0]).toMatch(/funcionario, prestador/);
  });
});

describe('situação — falha FECHADO', () => {
  it.each([
    ['active', StatusColaborador.ATIVO],
    ['ativo', StatusColaborador.ATIVO],
    ['inactive', StatusColaborador.INATIVO],
    ['demitido', StatusColaborador.DESLIGADO],
    ['férias', StatusColaborador.FERIAS],
    ['afastado', StatusColaborador.AFASTADO],
  ])('"%s" → %s', (texto, esperado) => {
    expect(traduzirStatus(texto).status).toBe(esperado);
  });

  it('coluna ausente significa "só exportou gente da ativa"', () => {
    expect(traduzirStatus('')).toMatchObject({
      status: StatusColaborador.ATIVO,
      desconhecido: false,
    });
  });

  /**
   * O status decide se a portaria libera a entrada. Chutar ATIVO num
   * "desligado em 2019" escrito de um jeito desconhecido dá acesso ao clube a
   * um ex-funcionário; chutar INATIVO no sentido contrário gera uma reclamação
   * no balcão e um clique de correção. Os dois erros não têm o mesmo tamanho.
   */
  it('situação desconhecida entra como INATIVO, nunca como ATIVO', () => {
    const r = traduzirStatus('em processo de rescisão contratual');
    expect(r.status).toBe(StatusColaborador.INATIVO);
    expect(r.desconhecido).toBe(true);
    expect(r.statusMotivo).toMatch(/não reconhecida/i);
  });
});

describe('dependentes', () => {
  const comDependente = (dep: Record<string, unknown>) =>
    normalizar({ ...PESSOA, dependentes: [dep] });

  it('descarta o dependente sem barrar o titular', () => {
    const linha = comDependente({ nome: 'SEM NASCIMENTO', parentesco: 'filho' });

    expect(linha.erros).toEqual([]); // o funcionário entra
    expect(linha.dados.dependentes).toHaveLength(0); // o dependente, não
    expect(linha.codigos).toContain('DEPENDENTE_DESCARTADO');
  });

  it('parentesco sem equivalente no sistema é descartado com o nome à vista', () => {
    const linha = comDependente({
      nome: 'NETO PEDRO', parentesco: 'neto', data_nascimento: '2018-01-01',
    });

    expect(linha.dados.dependentes).toHaveLength(0);
    // Descartado COM O NOME: sem ele, o operador saberia que perdeu alguém e
    // não teria como saber quem cadastrar à mão.
    expect(linha.avisos.join(' ')).toMatch(/NETO PEDRO/);
    expect(linha.avisos.join(' ')).toMatch(/neto/);
  });

  it('enteado entra como FILHO, e o operador é avisado da aproximação', () => {
    const linha = comDependente({
      nome: 'ENTEADA ANA', parentesco: 'Enteada', data_nascimento: '2010-02-03',
    });

    expect(linha.dados.dependentes[0].tipo).toBe(TipoDependente.FILHO);
    expect(linha.avisos.join(' ')).toMatch(/equivalente mais próximo/i);
  });

  it('CPF de dependente inválido entra como nulo — aqui ele não identifica', () => {
    const linha = comDependente({
      nome: 'FILHO', parentesco: 'filho', cpf: '111.111.111-11',
      data_nascimento: '2015-10-10',
    });

    expect(linha.dados.dependentes).toHaveLength(1);
    expect(linha.dados.dependentes[0].cpf).toBeNull();
  });

  it('só um cônjuge: o segundo é descartado com aviso', () => {
    const linha = normalizar({
      ...PESSOA,
      dependentes: [
        { nome: 'CONJUGE A', parentesco: 'esposa', data_nascimento: '1986-01-01' },
        { nome: 'CONJUGE B', parentesco: 'companheira', data_nascimento: '1990-01-01' },
      ],
    });

    expect(linha.dados.dependentes).toHaveLength(1);
    expect(linha.dados.dependentes[0].nome).toBe('CONJUGE A');
    expect(linha.codigos).toContain('CONJUGE_DUPLICADO');
  });
});

describe('cargo e setor — FK obrigatória', () => {
  it('em branco vira "Não informado" e a pessoa entra', () => {
    const linha = normalizar({ ...PESSOA, cargo: '', setor: '' });

    expect(linha.erros).toEqual([]);
    expect(linha.dados.cargo).toBe('Não informado');
    expect(linha.dados.setor).toBe('Não informado');
    expect(linha.codigos).toEqual(expect.arrayContaining(['CARGO_AUSENTE', 'SETOR_AUSENTE']));
  });
});

describe('endereço em uma linha só', () => {
  it('separa o número quando a cauda depois da vírgula é numérica', () => {
    expect(separarEndereco('Rua Exemplo, 123', '')).toEqual({
      logradouro: 'Rua Exemplo',
      numero: '123',
    });
  });

  it.each(['123-A', 'S/N', 's/n', '45'])('reconhece "%s" como número', (n) => {
    expect(separarEndereco(`Avenida Teste, ${n}`, '').numero).toBe(n);
  });

  /** Dividir aqui poria "Bairro Centro" no campo do número. */
  it('NÃO divide quando a cauda não é número', () => {
    expect(separarEndereco('Rua Coronel Antônio, Bairro Centro', '')).toEqual({
      logradouro: 'Rua Coronel Antônio, Bairro Centro',
      numero: null,
    });
  });

  it('coluna própria de número vence a heurística', () => {
    expect(separarEndereco('Rua Exemplo, 123', '456')).toEqual({
      logradouro: 'Rua Exemplo, 123',
      numero: '456',
    });
  });

  it('endereço vazio não inventa nada', () => {
    expect(separarEndereco('', '')).toEqual({ logradouro: null, numero: null });
  });
});

describe('datas e contato', () => {
  it('aceita dd/mm/aaaa além do ISO', () => {
    const linha = normalizar({ ...PESSOA, data_admissao: '01/03/2021' });
    expect(linha.dados.dataAdmissao).toBe('2021-03-01');
  });

  it('data impossível é erro, não silêncio', () => {
    const linha = normalizar({ ...PESSOA, data_nascimento: '32/13/1985' });
    expect(linha.codigos).toContain('DATA_INVALIDA');
  });

  it('e-mail inválido é descartado sem barrar a pessoa', () => {
    const linha = normalizar({ ...PESSOA, email: 'não-é-email' });
    expect(linha.erros).toEqual([]);
    expect(linha.dados.email).toBeNull();
    expect(linha.codigos).toContain('EMAIL_INVALIDO');
  });
});
