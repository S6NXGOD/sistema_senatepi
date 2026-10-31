import { ehClasseDeRecurso, ehNumeroDeSegundoGrau, ladoDoAtoEhDaAcao } from './lado-do-ato.util';

/**
 * A ÚNICA FAIXA RUIM É O RECURSO DENTRO DO NÚMERO DA AÇÃO.
 *
 * A medição que originou esta régua está no cabeçalho do util. Aqui o que
 * importa é que ela separe exatamente aquela faixa e nenhuma outra — porque
 * desconfiar demais custa 73 partes que o sistema sabe e não escreve, e
 * desconfiar de menos escreve o réu como autor.
 */
describe('lado do ato', () => {
  const RECLAMACAO = '00009785920225220004';
  const SEGUNDO_GRAU = '07537563620228180000';

  describe('a classe', () => {
    it.each([
      'RECURSO ORDINÁRIO TRABALHISTA',
      'RECURSO ORDINÁRIO - RITO SUMARÍSSIMO',
      'AGRAVO DE INSTRUMENTO EM RECURSO DE REVISTA',
      'AGRAVO DE PETIÇÃO',
      'APELAÇÃO CÍVEL',
      'APELAÇÃO / REMESSA NECESSÁRIA',
      'EMBARGOS DE DECLARAÇÃO CÍVEL',
      'AGRAVO INTERNO CÍVEL',
      'RECURSO ESPECIAL',
    ])('%s é recurso', (classe) => {
      expect(ehClasseDeRecurso(classe)).toBe(true);
    });

    it.each([
      'AÇÃO TRABALHISTA - RITO ORDINÁRIO',
      'AÇÃO TRABALHISTA - RITO SUMARÍSSIMO',
      'AÇÃO CIVIL COLETIVA',
      'AÇÃO CIVIL PÚBLICA CÍVEL',
      'PROCEDIMENTO COMUM CÍVEL',
      'CUMPRIMENTO DE SENTENÇA',
      'CUMPRIMENTO PROVISÓRIO DE SENTENÇA',
      'DISSÍDIO COLETIVO DE GREVE',
      'CONSIGNAÇÃO EM PAGAMENTO',
      'AÇÃO DE CUMPRIMENTO',
    ])('%s não é recurso', (classe) => {
      expect(ehClasseDeRecurso(classe)).toBe(false);
    });

    /*
      O ACENTO ENTRA PELO BANCO, e foi ele que escondeu 14 publicações na
      primeira medição: `\bAPELAC\b` nunca casa "APELACAO". O regex precisa
      conviver com o que o CNJ manda de verdade — "APELAçãO CíVEL", meio
      acentuado, meio não.
    */
    it('acento e caixa misturados não escapam', () => {
      expect(ehClasseDeRecurso('APELAçãO CíVEL')).toBe(true);
      expect(ehClasseDeRecurso('recurso ordinário trabalhista')).toBe(true);
      expect(ehClasseDeRecurso('EMBARGOS DE DECLARAçãO CíVEL')).toBe(true);
    });

    it('classe nula ou vazia não é recurso', () => {
      expect(ehClasseDeRecurso(null)).toBe(false);
      expect(ehClasseDeRecurso('')).toBe(false);
      expect(ehClasseDeRecurso(undefined)).toBe(false);
    });
  });

  describe('o grau, pelas quatro últimas posições do NPU', () => {
    it('0000 é o próprio tribunal', () => {
      expect(ehNumeroDeSegundoGrau(SEGUNDO_GRAU)).toBe(true);
      expect(ehNumeroDeSegundoGrau('0753756-36.2022.8.18.0000')).toBe(true);
    });

    it('vara é primeiro grau', () => {
      expect(ehNumeroDeSegundoGrau(RECLAMACAO)).toBe(false);
    });

    it('número incompleto não responde — e o lado conservador é o 1º grau', () => {
      expect(ehNumeroDeSegundoGrau('123')).toBe(false);
      expect(ehNumeroDeSegundoGrau(null)).toBe(false);
    });
  });

  describe('a decisão', () => {
    it('ato da ação em 1º grau: o lado vale', () => {
      expect(ladoDoAtoEhDaAcao('AÇÃO TRABALHISTA - RITO ORDINÁRIO', RECLAMACAO)).toEqual({
        daAcao: true,
        porque: '',
      });
    });

    it('recurso com número próprio: o registro É o recurso, então o lado vale', () => {
      expect(ladoDoAtoEhDaAcao('AGRAVO DE INSTRUMENTO', SEGUNDO_GRAU).daAcao).toBe(true);
    });

    it('dissídio coletivo no tribunal não é recurso — o lado vale', () => {
      expect(ladoDoAtoEhDaAcao('DISSÍDIO COLETIVO DE GREVE', SEGUNDO_GRAU).daAcao).toBe(true);
    });

    /*
      A FAIXA DE 39,2%. É o Recurso Ordinário noticiado no número da reclamação:
      quem perdeu recorreu e virou "autor" do ato, sem ter sido autor da ação.
    */
    it('recurso dentro do número da ação: o lado NÃO vale, e a frase diz por quê', () => {
      const r = ladoDoAtoEhDaAcao('RECURSO ORDINÁRIO TRABALHISTA', RECLAMACAO);
      expect(r.daAcao).toBe(false);
      expect(r.porque).toContain('recurso');
      expect(r.porque).toContain('réu');
    });

    it('a frase existe sempre que o lado é recusado', () => {
      for (const classe of ['AGRAVO DE PETIÇÃO', 'EMBARGOS DE DECLARAÇÃO CÍVEL', 'APELAÇÃO CÍVEL']) {
        const r = ladoDoAtoEhDaAcao(classe, RECLAMACAO);
        expect(r.daAcao).toBe(false);
        expect(r.porque.length).toBeGreaterThan(40);
      }
    });
  });
});
