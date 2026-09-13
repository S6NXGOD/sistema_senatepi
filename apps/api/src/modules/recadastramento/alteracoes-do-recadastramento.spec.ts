import { alteracoesDoRecadastramento, origemDoRecadastramento } from './alteracoes-do-recadastramento';

/** O registro do banco, serializado como o serviço grava em `dadosAnteriores`. */
const ANTES = {
  id: 'f1',
  nomeCompleto: 'MARIA DA SILVA',
  cpf: '12345678900',
  dataNascimento: '1980-05-10T03:00:00.000Z',
  telefonePrincipal: null,
  email: '',
  cidade: 'Teresina',
  qrToken: 'qr-secreto',
  vinculos: [{ id: 'v1', empresa: 'HOSPITAL A', cargo: 'Técnica' }],
  dependentes: [{ id: 'd1', nome: 'JOÃO' }],
};

describe('alteracoesDoRecadastramento — o de→para da conferência', () => {
  it('mostra só o que mudou, com rótulo em português', () => {
    const novos = {
      nomeCompleto: 'MARIA DA SILVA',
      telefonePrincipal: '(86) 99999-8888',
      cidade: 'Parnaíba',
      endereco: 'Rua Nova, 10',
    };
    // Na ordem da ficha (endereço antes de cidade), não na do objeto.
    expect(alteracoesDoRecadastramento(ANTES, novos)).toEqual([
      { campo: 'telefonePrincipal', rotulo: 'Telefone', de: null, para: '(86) 99999-8888' },
      { campo: 'endereco', rotulo: 'Endereço', de: null, para: 'Rua Nova, 10' },
      { campo: 'cidade', rotulo: 'Cidade', de: 'Teresina', para: 'Parnaíba' },
    ]);
  });

  it('a ordem não depende da ordem das chaves do JSONB (o Postgres ordena pelo tamanho do nome)', () => {
    // Como o banco devolve: chaves curtas primeiro.
    const doBanco = {
      cep: '64000-000', cidade: 'Parnaíba', matricula: '99', vinculos: [{ empresa: 'CLÍNICA B' }],
      nomeCompleto: 'MARIA S.', telefonePrincipal: '(86) 99999-8888',
    };
    expect(alteracoesDoRecadastramento(ANTES, doBanco).map((a) => a.campo)).toEqual([
      'nomeCompleto', 'telefonePrincipal', 'cep', 'cidade', 'vinculos',
      // Fora da lista do link (só o presencial grava): vai para o fim.
      'matricula',
    ]);
  });

  it('data com hora × data pura do mesmo dia NÃO é mudança; CPF com máscara também não', () => {
    const novos = { dataNascimento: '1980-05-10', cpf: '123.456.789-00', email: null };
    expect(alteracoesDoRecadastramento(ANTES, novos)).toEqual([]);
  });

  it('imutável preenchido que veio diferente (presencial grava o corpo inteiro) não aparece como mudança', () => {
    const novos = { cpf: '99999999999', dataNascimento: '1990-01-01', nomeCompleto: 'MARIA S.' };
    expect(alteracoesDoRecadastramento(ANTES, novos).map((a) => a.campo)).toEqual(['nomeCompleto']);
  });

  it('imutável VAZIO que foi preenchido aparece', () => {
    const r = alteracoesDoRecadastramento({ ...ANTES, dataNascimento: null }, { dataNascimento: '1980-05-10' });
    expect(r).toEqual([{ campo: 'dataNascimento', rotulo: 'Data de nascimento', de: null, para: '1980-05-10' }]);
  });

  it('vínculos e dependentes viram lista de nomes; ausentes nos novos = não mexeu', () => {
    const novos = {
      vinculos: [{ empresa: 'HOSPITAL A' }, { empresa: 'CLÍNICA B' }],
      dependentes: [{ nome: 'JOÃO' }],
    };
    expect(alteracoesDoRecadastramento(ANTES, novos)).toEqual([
      { campo: 'vinculos', rotulo: 'Locais de trabalho', de: ['HOSPITAL A'], para: ['CLÍNICA B', 'HOSPITAL A'] },
    ]);
    expect(alteracoesDoRecadastramento(ANTES, { cidade: 'Teresina' })).toEqual([]);
  });

  it('confirmação do desafio e chaves internas nunca aparecem', () => {
    const novos = { cpfConfirmacao: '1', dataNascimentoConfirmacao: '2', qrToken: 'outro', filiadoId: 'x' };
    expect(alteracoesDoRecadastramento(ANTES, novos)).toEqual([]);
  });

  it('JSON nulo ou quebrado não derruba a ficha', () => {
    expect(alteracoesDoRecadastramento(null, { cidade: 'X' })).toEqual([]);
    expect(alteracoesDoRecadastramento(ANTES, 'texto')).toEqual([]);
  });
});

describe('origemDoRecadastramento', () => {
  it('reconhece o recadastro pelo link pela observação que ele grava', () => {
    expect(origemDoRecadastramento('Recadastramento ONLINE feito pelo próprio filiado (link).')).toBe('ONLINE');
    expect(origemDoRecadastramento(null)).toBe('PRESENCIAL');
    expect(origemDoRecadastramento('qualquer outra')).toBe('PRESENCIAL');
  });
});
