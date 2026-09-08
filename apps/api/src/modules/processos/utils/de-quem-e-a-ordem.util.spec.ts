import { deQuemEAOrdem } from './de-quem-e-a-ordem.util';

/**
 * O PRAZO ERA DA RECLAMADA E VIROU TAREFA DO NOSSO ADVOGADO.
 *
 * Os teores abaixo são trechos reais das publicações da produção. O tribunal
 * manda o MESMO ato para todos os intimados, e a ordem costuma ser de um lado
 * só — o robô lia "no prazo de 15 dias" e criava tarefa sem perguntar de quem
 * era a obrigação.
 *
 * Medido em 07/09/2026: das 14 atividades que o robô criou, CINCO já tinham
 * sido canceladas à mão. A equipe limpava isso toda semana, sem reportar.
 */
const SIGLA = 'SENATEPI';

describe('de quem é a ordem do ato', () => {
  /** 0000978-59.2022.5.22.0004 — o caso que o usuário trouxe. */
  it('reconhece a ordem que é só da reclamada quando somos autor', () => {
    const teor = 'INTIME-SE A RECLAMADA PARA RECOLHIMENTO NO PRAZO DE 15 DIAS.';
    expect(deQuemEAOrdem(teor, 'ATIVO', SIGLA)).toBe('DA_OUTRA_PARTE');
  });

  /**
   * A MESMA FRASE É NOSSA QUANDO SOMOS A RECLAMADA. É por isso que a regra
   * compara papel com polo, em vez de ter uma lista de palavras proibidas: em
   * 167 das 1.408 publicações do acervo o sindicato está no polo passivo.
   */
  it('e a mesma ordem é nossa quando somos nós a reclamada', () => {
    const teor = 'INTIME-SE A RECLAMADA PARA RECOLHIMENTO NO PRAZO DE 15 DIAS.';
    expect(deQuemEAOrdem(teor, 'PASSIVO', SIGLA)).toBe('NOSSA');
  });

  /** 0002664-81.2025.5.22.0101 — duas ordens, uma delas nossa. Tarefa vale. */
  it('basta UMA ordem nossa para o ato ser nosso', () => {
    const teor =
      'INTIME-SE A EXECUTADA (INSTITUTO SAUDE E CIDADANIA - ISAC) PARA QUE COMPROVE O CUMPRIMENTO. ' +
      'APOS, INTIME-SE O SINDICATO EXEQUENTE PARA QUE SE MANIFESTE EM 5 DIAS.';
    expect(deQuemEAOrdem(teor, 'ATIVO', SIGLA)).toBe('NOSSA');
  });

  /** O ato que nos nomeia é nosso, qualquer que seja o papel escrito. */
  it('a sigla no destinatário decide sozinha', () => {
    expect(deQuemEAOrdem('FICA INTIMADO O SENATEPI PARA MANIFESTAR-SE.', null, SIGLA)).toBe('NOSSA');
  });

  it('"intimem-se as partes" é nosso também', () => {
    expect(deQuemEAOrdem('INTIMEM-SE AS PARTES DO INTEIRO TEOR.', 'ATIVO', SIGLA)).toBe('NOSSA');
  });

  /**
   * NA DÚVIDA, CRIA. Sem ordem legível o resultado é INDEFINIDO, e indefinido
   * mantém o comportamento de sempre. 90,4% das 1.433 publicações caem aqui —
   * a trava é estreita de propósito.
   */
  it('sem ordem legível não decide nada', () => {
    expect(deQuemEAOrdem('SENTENCA PUBLICADA EM AUDIENCIA. NADA MAIS.', 'ATIVO', SIGLA)).toBe(
      'INDEFINIDO',
    );
  });

  it('uma ordem indefinida no meio já derruba o bloqueio', () => {
    const teor = 'INTIME-SE A RECLAMADA PARA PAGAR. INTIME-SE O PERITO PARA APRESENTAR O LAUDO.';
    expect(deQuemEAOrdem(teor, 'ATIVO', SIGLA)).toBe('INDEFINIDO');
  });

  /**
   * SEM SABER NOSSO POLO, NÃO BLOQUEIA. Acontece quando o sindicato não é parte
   * (a ação é do filiado e nós só patrocinamos) ou quando está nos dois polos,
   * que é o caso do recurso — 11% dos atos medidos.
   */
  it('não bloqueia quando não se sabe de que lado estamos', () => {
    expect(deQuemEAOrdem('INTIME-SE A RECLAMADA PARA PAGAR.', null, SIGLA)).toBe('INDEFINIDO');
  });

  /**
   * "SINDICATO" SOZINHO NÃO BASTA QUANDO NÃO SOMOS PARTE. No acervo há ação
   * movida por outro sindicato contra nós (SINSEP, SINDHOSPI): tratar a palavra
   * como nossa devolveria o bug com outra roupa.
   */
  it('mas "sindicato" genérico, sabendo o polo, obedece ao papel', () => {
    const teor = 'INTIME-SE O SINDICATO RECLAMADO PARA CONTESTAR.';
    expect(deQuemEAOrdem(teor, 'ATIVO', SIGLA)).toBe('DA_OUTRA_PARTE');
    expect(deQuemEAOrdem(teor, 'PASSIVO', SIGLA)).toBe('NOSSA');
  });

  /** Trechos reais das 59 barradas na conferência contra a produção. */
  it.each([
    ['INTIME-SE A PARTE RECLAMADA PARA IMPUGNACAO FUNDAMENTADA DOS CALCULOS.', 'ATIVO'],
    ['INTIME-SE A PARTE EXECUTADA PARA, QUERENDO, APRESENTAR IMPUGNACAO.', 'ATIVO'],
    ['INTIME-SE A PARTE EMBARGADA PARA, QUERENDO, APRESENTAR MANIFESTACAO.', 'ATIVO'],
    ['CITE-SE A RECLAMADA PARA, NO PRAZO LEGAL, APRESENTAR CONTESTACAO.', 'ATIVO'],
  ] as const)('bloqueia: %s', (teor, polo) => {
    expect(deQuemEAOrdem(teor, polo, SIGLA)).toBe('DA_OUTRA_PARTE');
  });

  /** Teores nossos que NÃO podem ser bloqueados — o erro caro. */
  it.each([
    ['INTIME-SE A PARTE AUTORA PARA APRESENTAR REPLICA NO PRAZO DE 15 DIAS.', 'ATIVO'],
    ['INTIMO A PARTE EXEQUENTE A SE MANIFESTAR SOBRE OS CALCULOS.', 'ATIVO'],
    ['FICA INTIMADA A RECLAMANTE PARA CIENCIA DA SENTENCA.', 'ATIVO'],
    ['INTIME-SE A EXECUTADA PARA PAGAR EM 48 HORAS.', 'PASSIVO'],
  ] as const)('não bloqueia: %s', (teor, polo) => {
    expect(deQuemEAOrdem(teor, polo, SIGLA)).toBe('NOSSA');
  });

  it('texto vazio não quebra', () => {
    expect(deQuemEAOrdem('', 'ATIVO', SIGLA)).toBe('INDEFINIDO');
  });

  /** Acento e caixa não podem mudar a resposta — o teor vem como o tribunal escreve. */
  it('atravessa acento e caixa', () => {
    expect(deQuemEAOrdem('Intime-se a parte reclamada para pagar.', 'ATIVO', SIGLA)).toBe(
      'DA_OUTRA_PARTE',
    );
  });
});
