import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { alturaDaBarra, rotuloDaSemana } from './movimento-no-diario';

/**
 * O GRÁFICO DO ADVOGADO — 18/09/2026.
 *
 * "Não há mais gráficos e informações que deveriam aparecer para os advogados?"
 * Havia: ele tinha ZERO e a Triagem, QUATRO. Este é o dele, e as duas contas de
 * desenho ficam fora do componente porque desenho errado não aparece em teste
 * de render — aparece na tela, meses depois.
 */
describe('a altura da barra', () => {
  it('a maior semana enche a caixa', () => {
    expect(alturaDaBarra(19, 19)).toBe(100);
  });

  it('metade do pico, metade da altura', () => {
    expect(alturaDaBarra(10, 20)).toBe(50);
  });

  /**
   * SEMANA ZERADA FICA COM UM TRAÇO. Coluna invisível lê-se como "não medimos";
   * o que houve foi recesso, e recesso é informação.
   */
  it('zero vira traço, nunca nada', () => {
    expect(alturaDaBarra(0, 19)).toBe(6);
  });

  /** Oito semanas zeradas não podem dividir por zero. */
  it('sem pico, todas no traço', () => {
    expect(alturaDaBarra(0, 0)).toBe(6);
    expect(alturaDaBarra(3, 0)).toBe(6);
  });

  /** Uma semana de 1 contra um pico de 40 ainda precisa ser vista. */
  it('a barra mínima nunca desaparece por arredondamento', () => {
    expect(alturaDaBarra(1, 40)).toBe(6);
  });
});

describe('o rótulo do eixo', () => {
  it('é dia/mês, sem zero à esquerda', () => {
    expect(rotuloDaSemana('2026-09-07')).toBe('7/9');
    expect(rotuloDaSemana('2026-11-30')).toBe('30/11');
  });

  /**
   * LÊ O TEXTO, NÃO UM `Date`. A chave da semana é data pura; passá-la por
   * `new Date('2026-09-07')` e formatar no fuso local volta um dia — o mesmo
   * defeito que já tirou um dia dos Relatórios e das tarefas do Diário.
   */
  it('não passa por Date: 1º de janeiro não vira 31 de dezembro', () => {
    expect(rotuloDaSemana('2026-01-01')).toBe('1/1');
  });
});

/**
 * O CARTÃO É LEITURA, NÃO FILA. Nenhum número dele abre lista: a tela de
 * Publicações só oferece 7, 30 e 90 dias, e as barras contam 8 semanas. Número
 * que abre uma lista com outro total é o defeito que o Panorama já cometeu —
 * contava 184 e abria 143.
 */
const FONTE = readFileSync(path.join(__dirname, 'movimento-no-diario.tsx'), 'utf8');

describe('o cartão não promete recorte que não existe', () => {
  it('não há link com janela de dias', () => {
    expect(FONTE).not.toMatch(/publicacoes\?dias=/);
    expect(FONTE).not.toMatch(/providencia=/);
  });

  it('a única saída é o Diário inteiro', () => {
    expect(FONTE).toContain('actionHref="/publicacoes"');
  });

  /** Oito semanas sem ato nenhum não é ritmo: o cartão some e a faixa explica. */
  it('some quando não houve nada', () => {
    expect(FONTE).toContain('if (mov.total === 0) return null;');
  });

  /** O título diz de quem é a leitura — a lição do "Contra quem litigamos". */
  it('o título distingue a carteira da casa', () => {
    expect(FONTE).toContain("pessoal ? 'Seu movimento no Diário' : 'O movimento no Diário'");
  });
});
