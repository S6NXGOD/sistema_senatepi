import {
  ROTULO_FORMACAO,
  ROTULO_SITUACAO_FILIADO,
  categoriaDoCartao,
  iniciaisDoNome,
  nomeParaCartao,
} from './rotulos-do-cartao.util';

/**
 * "A CARTEIRINHA ATUALMENTE ESTÁ SAINDO ASSIM… COMO PROFISSIONALIZAR MAIS
 * ISSO? E A FRENTE E VERSO?" — o dono, 24/09/2026, com duas referências.
 *
 * Antes de desenhar as duas faces, três coisas que o cartão dizia errado:
 *
 *   formação impressa .......... "TECNICO_ENFERMAGEM"
 *   situação impressa .......... "ATIVO"
 *   foto ....................... 1 de 5.810 ativos tem
 *
 * Os dois primeiros são o enum cru num documento que a pessoa carrega na
 * carteira. O terceiro é um retângulo `#E5E7EB` ocupando um terço do cartão de
 * 5.809 pessoas.
 */
describe('o que vai escrito no cartão', () => {
  /** O papel e a tela têm de dizer a MESMA palavra para a conferência fechar. */
  it('os rótulos são os mesmos da tela', () => {
    expect(ROTULO_FORMACAO.TECNICO_ENFERMAGEM).toBe('Técnico(a) em Enfermagem');
    expect(ROTULO_FORMACAO.ENFERMEIRO).toBe('Enfermeiro(a)');
    expect(ROTULO_SITUACAO_FILIADO.ATIVO).toBe('Ativo');
    expect(ROTULO_SITUACAO_FILIADO.DESFILIADO).toBe('Desfiliado');
  });

  it('nenhum rótulo é o enum cru', () => {
    for (const texto of [
      ...Object.values(ROTULO_FORMACAO),
      ...Object.values(ROTULO_SITUACAO_FILIADO),
    ]) {
      expect(texto).not.toMatch(/^[A-Z_]+$/);
    }
  });
});

describe('a categoria impressa', () => {
  it('traduz a formação conhecida', () => {
    expect(categoriaDoCartao('AUXILIAR_ENFERMAGEM', null)).toBe('Auxiliar de Enfermagem');
  });

  /** `OUTRO` existe porque a lista não cobre todo mundo: vale o texto da pessoa. */
  it('em OUTRO, prefere o que a pessoa escreveu', () => {
    expect(categoriaDoCartao('OUTRO', 'Obstetriz')).toBe('Obstetriz');
    expect(categoriaDoCartao('OUTRO', '   ')).toBe('Outro');
    expect(categoriaDoCartao('OUTRO', null)).toBe('Outro');
  });

  it('sem formação, não inventa categoria', () => {
    expect(categoriaDoCartao(null, null)).toBe('—');
    expect(categoriaDoCartao(null, 'Enfermeira obstetra')).toBe('Enfermeira obstetra');
  });
});

describe('as iniciais quando não há foto', () => {
  /** Partícula não é nome: "IVO RAMOS DOS SANTOS" é I.S., nunca I.D. */
  it('pula as partículas', () => {
    expect(iniciaisDoNome('IVO RAMOS DOS SANTOS')).toBe('IS');
    expect(iniciaisDoNome('Maria das Graças de Oliveira')).toBe('MO');
    expect(iniciaisDoNome('ERICK RICCELY PEREIRA DO Ó')).toBe('EÓ');
  });

  it('nome de uma palavra dá uma letra só', () => {
    expect(iniciaisDoNome('Madonna')).toBe('M');
  });

  /** Nunca estoura: cadastro vazio existe, e o cartão não pode quebrar por isso. */
  it('não quebra com lixo', () => {
    expect(iniciaisDoNome('   ')).toBe('?');
    expect(iniciaisDoNome('')).toBe('?');
    expect(iniciaisDoNome('de das do')).toBe('?');
  });
});

describe('o nome que cabe na linha do cartão', () => {
  /** A régua é injetada porque quem sabe medir é o PDFKit, com a fonte real. */
  const ate = (largura: number) => (t: string) => t.length <= largura;

  it('cabendo inteiro, sai inteiro', () => {
    expect(nomeParaCartao('ANA SOUZA', ate(40))).toBe('ANA SOUZA');
  });

  it('não cabendo, vira primeiro + último', () => {
    expect(nomeParaCartao('MARIA DAS GRAÇAS PEREIRA DOS SANTOS', ate(20))).toBe('MARIA SANTOS');
  });

  /**
   * E SE NEM O CURTO COUBER, devolve o inteiro e deixa o `ellipsis` do PDFKit
   * cortar: cortar o sobrenome é pior do que cortar o fim da linha, porque some
   * sem aviso e o cartão parece certo.
   */
  it('nem o curto cabendo, devolve o inteiro para o PDFKit cortar', () => {
    expect(nomeParaCartao('MARIA DAS GRAÇAS PEREIRA DOS SANTOS', ate(5))).toBe(
      'MARIA DAS GRAÇAS PEREIRA DOS SANTOS',
    );
  });

  it('normaliza espaço repetido antes de medir', () => {
    expect(nomeParaCartao('  ANA   SOUZA ', ate(40))).toBe('ANA SOUZA');
  });

  /** Nome de duas partes já é o mais curto possível. */
  it('não encurta o que já tem duas partes', () => {
    expect(nomeParaCartao('ANA SOUZA', ate(3))).toBe('ANA SOUZA');
  });
});
