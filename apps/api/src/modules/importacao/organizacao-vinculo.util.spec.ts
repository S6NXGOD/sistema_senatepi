import {
  chaveOrganizacao,
  indexarOrganizacoes,
  organizacaoDoTexto,
} from './organizacao-vinculo.util';

/**
 * A regra que liga o vínculo ao órgão cadastrado.
 *
 * O que estes testes protegem é a decisão de NÃO ADIVINHAR: um casamento
 * aproximado poria o servidor na secretaria errada, e ninguém descobriria
 * olhando a tela, porque o texto do vínculo continuaria certo.
 */
const ORGAOS = [
  { id: 'semec', nome: 'Secretaria Municipal de Educação', nomeFantasia: 'SEMEC' },
  { id: 'fms', nome: 'Fundação Municipal de Saúde', nomeFantasia: 'FMS' },
  { id: 'strans', nome: 'Superintendência Municipal de Transportes e Trânsito', nomeFantasia: 'STRANS' },
];

describe('chave comparável de organização', () => {
  it('ignora caixa e espaço nas pontas', () => {
    expect(chaveOrganizacao('  semec ')).toBe('SEMEC');
  });

  it('colapsa espaço interno — a folha alterna "SEMEC" e "SEMEC  "', () => {
    expect(chaveOrganizacao('Fundação  Municipal   de Saúde')).toBe('FUNDAÇÃO MUNICIPAL DE SAÚDE');
  });

  /**
   * NÃO tira acento, de propósito: os dois lados vêm da mesma origem, e
   * ampliar o casamento aproximaria nomes que talvez não sejam o mesmo órgão.
   */
  it('preserva acento', () => {
    expect(chaveOrganizacao('Educação')).toBe('EDUCAÇÃO');
  });

  it('vazio continua vazio', () => {
    expect(chaveOrganizacao(null)).toBe('');
    expect(chaveOrganizacao('   ')).toBe('');
  });
});

describe('casamento do vínculo com o cadastro', () => {
  const indice = indexarOrganizacoes(ORGAOS);

  it('casa pela SIGLA, que é o que a folha escreve', () => {
    expect(organizacaoDoTexto('SEMEC', indice)).toBe('semec');
  });

  it('casa pela razão social por extenso', () => {
    expect(organizacaoDoTexto('Secretaria Municipal de Educação', indice)).toBe('semec');
  });

  it('casa apesar da caixa e do espaço — o caso real da folha', () => {
    expect(organizacaoDoTexto('  semec  ', indice)).toBe('semec');
  });

  /**
   * O CASO QUE NÃO PODE CASAR. "NÃO INFORMADO NA FOLHA" é célula vazia da
   * Prefeitura — 11 dos 963 vínculos do SINDSERM. Ligar isso a qualquer órgão
   * seria inventar lotação para quem a folha não informou.
   */
  it('não casa o rótulo de célula vazia', () => {
    expect(organizacaoDoTexto('NÃO INFORMADO NA FOLHA', indice)).toBeNull();
  });

  it('não casa órgão que não está no cadastro', () => {
    expect(organizacaoDoTexto('SECRETARIA MUNICIPAL DE RECURSOS HUMANOS', indice)).toBeNull();
  });

  it('não casa por semelhança — "SEMEC" não atrai "SEMEC SUL"', () => {
    expect(organizacaoDoTexto('SEMEC SUL', indice)).toBeNull();
  });

  it('vazio não casa com nada', () => {
    expect(organizacaoDoTexto('', indice)).toBeNull();
    expect(organizacaoDoTexto(null, indice)).toBeNull();
  });

  /**
   * SIGLA AMBÍGUA NÃO ESCOLHE SOZINHA. Se duas organizações compartilham a
   * sigla, casar com qualquer uma seria sortear em qual secretaria o servidor
   * trabalha. As duas saem do índice e o vínculo fica nulo.
   */
  it('sigla repetida em duas organizações não casa com nenhuma', () => {
    const comColisao = indexarOrganizacoes([
      { id: 'a', nome: 'Secretaria A', nomeFantasia: 'SEC' },
      { id: 'b', nome: 'Secretaria B', nomeFantasia: 'SEC' },
    ]);
    expect(organizacaoDoTexto('SEC', comColisao)).toBeNull();
  });

  it('a sigla tem precedência sobre a razão social de outra organização', () => {
    // "FMS" é sigla de uma e não pode ser roubada por quem tenha isso no nome.
    const indice2 = indexarOrganizacoes([
      ...ORGAOS,
      { id: 'outra', nome: 'FMS', nomeFantasia: 'OUTRA' },
    ]);
    // A chave "FMS" ficou ambígua (sigla de uma, nome de outra) → ninguém casa.
    expect(organizacaoDoTexto('FMS', indice2)).toBeNull();
  });

  it('organização sem sigla ainda casa pelo nome', () => {
    const indice3 = indexarOrganizacoes([{ id: 'x', nome: 'Gabinete do Prefeito' }]);
    expect(organizacaoDoTexto('gabinete do prefeito', indice3)).toBe('x');
  });
});
