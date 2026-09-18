import { estadoDosAniversarios, resumoDosAniversarios, soOPrimeiroNome } from './dashboard';

/**
 * "SE TIVER ANIVERSARIANTE NO DIA, NÃO É BOM APARECER UMA ANIMAÇÃO QUE FORCE A
 * TRIAGEM A PARABENIZAR OU DISPENSAR?" — o dono, 18/09/2026.
 *
 * O cartão já existia e era PASSIVO: mostrava quem faz aniversário e ficava por
 * isso mesmo. Ninguém sabia se alguém já tinha falado com a pessoa, e duas
 * pessoas da secretaria podiam cumprimentar a mesma filiada enquanto ninguém
 * falava com a outra.
 *
 * Agora ele pede decisão. NÃO virou animação piscando, e a diferença importa:
 * aviso é ESTADO nesta casa, nunca evento. O cartão fica aberto enquanto houver
 * alguém sem decisão, e encolhe para uma linha quando o dia estiver cuidado —
 * some do caminho sem sumir da tela, porque "a casa cumprimentou três pessoas
 * hoje" é boa notícia, e boa notícia vira linha.
 *
 * E "deixar passar" GRAVA. Sem registro seria um botão de fechar, e a casa não
 * tem botão de fechar: o que apaga um aviso é o fato.
 */
const pessoa = (decisao?: 'PARABENIZADO' | 'DEIXOU_PASSAR') => ({
  decisao: decisao ? { desfecho: decisao } : null,
});

describe('o cartão fica aberto enquanto alguém espera', () => {
  it('ninguém decidido: o cartão pede os três', () => {
    const e = estadoDosAniversarios([pessoa(), pessoa(), pessoa()]);
    expect(e).toMatchObject({ pendentes: 3, parabenizados: 0, deixouPassar: 0, fechado: false });
  });

  it('um decidido de três: ainda pede alguém', () => {
    const e = estadoDosAniversarios([pessoa('PARABENIZADO'), pessoa(), pessoa()]);
    expect(e.pendentes).toBe(2);
    expect(e.fechado).toBe(false);
  });

  it('todos decididos: o cartão encolhe', () => {
    const e = estadoDosAniversarios([pessoa('PARABENIZADO'), pessoa('DEIXOU_PASSAR')]);
    expect(e).toMatchObject({ pendentes: 0, parabenizados: 1, deixouPassar: 1, fechado: true });
  });

  /** Dia sem aniversário não é "dia cuidado": não há o que fechar. */
  it('lista vazia não fecha nada', () => {
    expect(estadoDosAniversarios([]).fechado).toBe(false);
  });

  /**
   * DEIXAR PASSAR CONTA COMO DECIDIDO. Era o ponto da mudança: sem isso, uma
   * pessoa sem celular travaria o cartão aberto para sempre, e um cartão que
   * nunca encolhe deixa de ser lido.
   */
  it('só "deixou passar" também fecha o dia', () => {
    expect(estadoDosAniversarios([pessoa('DEIXOU_PASSAR')]).fechado).toBe(true);
  });
});

describe('o resumo do dia não mostra zeros', () => {
  it('só cumprimentados', () => {
    expect(resumoDosAniversarios({ parabenizados: 3, deixouPassar: 0 }))
      .toBe('3 pessoas cumprimentadas');
  });

  it('os dois desfechos, separados por ponto médio', () => {
    expect(resumoDosAniversarios({ parabenizados: 1, deixouPassar: 2 }))
      .toBe('1 pessoa cumprimentada · 2 deixadas para depois');
  });

  it('singular e plural em cada lado', () => {
    expect(resumoDosAniversarios({ parabenizados: 0, deixouPassar: 1 }))
      .toBe('1 deixada para depois');
  });

  it('nada decidido: frase vazia, e quem chama não escreve nada', () => {
    expect(resumoDosAniversarios({ parabenizados: 0, deixouPassar: 0 })).toBe('');
  });
});

/**
 * DUAS FUNÇÕES DE NOME, COM NOMES DIFERENTES DE PROPÓSITO. `primeiroNome`
 * recebe a PESSOA e prefere o nome de exibição; esta recebe o texto cru, que é
 * tudo o que a consulta de aniversariantes tem. Duas funções com a mesma
 * assinatura e regras diferentes já custaram caro neste projeto.
 */
describe('o primeiro nome de um nome solto', () => {
  /**
   * E ELE NÃO GRITA. A base grava em caixa alta; "Você parabenizou JOANA?" soa
   * como cobrança, "Você parabenizou Joana?" soa como pergunta — que é o que é.
   */
  it('pega só o primeiro, e em caixa de gente', () => {
    expect(soOPrimeiroNome('MARIA DAS GRAÇAS SILVA')).toBe('Maria');
  });

  it('aguenta espaço sobrando', () => {
    expect(soOPrimeiroNome('  ANA   BEATRIZ ')).toBe('Ana');
  });

  it('acento sobrevive à troca de caixa', () => {
    expect(soOPrimeiroNome('ANTÔNIA DA SILVA')).toBe('Antônia');
  });

  it('nome vazio devolve o que recebeu, sem quebrar', () => {
    expect(soOPrimeiroNome('')).toBe('');
  });
});
