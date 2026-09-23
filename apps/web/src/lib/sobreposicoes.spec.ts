import {
  JANELA_DO_GESTO_MS,
  desempilharSobreposicao,
  ehOTopo,
  ehOTopoDaPilha,
  empilharSobreposicao,
  limparPilha,
  oCliqueFoiNoFundo,
} from './sobreposicoes';

/** Um gesto já terminado: o clique não é sobra de nada. */
const CALMO = 5_000;

/**
 * OS DOIS GESTOS QUE APAGAVAM UM CADASTRO INTEIRO — conferidos na tela em
 * 23/09/2026, com o modal de recadastramento aberto dentro da gaveta do
 * atendimento:
 *
 *  · `Escape` fechou o modal **e a gaveta**;
 *  · arrastar de dentro para fora fechou o modal.
 *
 * Nos dois casos, sem pergunta e sem volta. E o rastro na produção mostra o
 * tamanho do estrago: os 4 recadastramentos existentes chegaram com
 * `dependentes: []`, e dois são a mesma ficha com 18 segundos de diferença.
 */

describe('o Esc é do topo', () => {
  beforeEach(limparPilha);

  it('com a gaveta embaixo e o modal em cima, o Esc é do modal', () => {
    expect(ehOTopoDaPilha(['gaveta', 'modal'], 'modal')).toBe(true);
    expect(ehOTopoDaPilha(['gaveta', 'modal'], 'gaveta')).toBe(false);
  });

  it('fechado o modal, a gaveta volta a responder', () => {
    empilharSobreposicao('gaveta');
    empilharSobreposicao('modal');
    expect(ehOTopo('gaveta')).toBe(false);
    desempilharSobreposicao('modal');
    expect(ehOTopo('gaveta')).toBe(true);
  });

  /** Fechar fora de ordem acontece: a gaveta pode morrer antes por navegação. */
  it('desempilhar do meio não promove quem não é o último', () => {
    empilharSobreposicao('a');
    empilharSobreposicao('b');
    empilharSobreposicao('c');
    desempilharSobreposicao('b');
    expect(ehOTopo('c')).toBe(true);
    expect(ehOTopo('a')).toBe(false);
  });

  it('empilhar duas vezes não cria dois lugares', () => {
    empilharSobreposicao('a');
    empilharSobreposicao('a');
    desempilharSobreposicao('a');
    expect(ehOTopo('a')).toBe(false);
  });

  /**
   * SEM NINGUÉM NA PILHA, NINGUÉM É TOPO. Uma sobreposição que ainda não se
   * registrou não pode fechar em resposta a uma tecla: é mais seguro não
   * fechar do que fechar o que não devia.
   */
  it('pilha vazia não tem topo', () => {
    expect(ehOTopoDaPilha([], 'qualquer')).toBe(false);
  });
});

describe('o clique no fundo tem de começar e terminar no fundo', () => {
  it('apertou e soltou no fundo: é vontade de sair', () => {
    expect(oCliqueFoiNoFundo({
      comecouNoFundo: true, terminouNoFundo: true, msDesdeOUltimoCliqueDentro: CALMO,
    })).toBe(true);
  });

  /** O gesto real: selecionar o texto de um campo e soltar fora da caixa. */
  it('apertou dentro e soltou fora: é seleção de texto, não saída', () => {
    expect(oCliqueFoiNoFundo({
      comecouNoFundo: false, terminouNoFundo: true, msDesdeOUltimoCliqueDentro: CALMO,
    })).toBe(false);
  });

  /**
   * E O CASO DO CLIQUE DUPLO: o primeiro toque muda de passo, a caixa encolhe,
   * e o segundo toque cai onde a caixa estava. Começou no fundo, mas terminou
   * dentro — ou o contrário, dependendo de para que lado a caixa andou. Os
   * dois têm de ser recusados.
   */
  it('a caixa mudou de tamanho entre os dois toques: não fecha', () => {
    expect(oCliqueFoiNoFundo({
      comecouNoFundo: true, terminouNoFundo: false, msDesdeOUltimoCliqueDentro: CALMO,
    })).toBe(false);
    expect(oCliqueFoiNoFundo({
      comecouNoFundo: false, terminouNoFundo: false, msDesdeOUltimoCliqueDentro: CALMO,
    })).toBe(false);
  });

  /**
   * O CASO QUE A TELA MOSTROU. O primeiro toque do clique duplo troca o passo,
   * a caixa encolhe, e o segundo toque cai no fundo inteirinho — começou e
   * terminou nele. Só a janela do gesto separa isso de uma saída de verdade.
   */
  it('o segundo toque do clique duplo cai no fundo e MESMO ASSIM não fecha', () => {
    expect(oCliqueFoiNoFundo({
      comecouNoFundo: true, terminouNoFundo: true, msDesdeOUltimoCliqueDentro: 150,
    })).toBe(false);
  });

  it('passada a janela, o mesmo clique fecha', () => {
    expect(oCliqueFoiNoFundo({
      comecouNoFundo: true, terminouNoFundo: true, msDesdeOUltimoCliqueDentro: JANELA_DO_GESTO_MS,
    })).toBe(true);
  });
});
