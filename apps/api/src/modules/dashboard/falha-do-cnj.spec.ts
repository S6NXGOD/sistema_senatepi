import {
  cicloEmDias,
  estaAtrasada,
  horasAteOAtraso,
  ordenarFalhas,
  resumirFalhas,
} from './falha-do-cnj.util';
import { DIAS_RECHECAGEM_DORMENTE } from '../processos/utils/varredura.util';

/**
 * A FAIXA DO PAINEL COM UMA LISTA GIGANTE — o print de 24/09/2026.
 *
 * Ela dizia *"1 processo está sem leitura do CNJ há mais de 48h […] Outros 24
 * tropeçaram nesta rodada mas seguem em dia"* e abria **25 linhas iguais**, em
 * âmbar, ocupando a primeira tela inteira do painel.
 *
 * Medido na produção naquela manhã, três coisas estavam erradas de uma vez:
 *
 *   falhas de verdade ........... 27   (a tela via 25 — o corte)
 *   "atrasados" pela régua velha .. 3   (a tela dizia 1 — o corte de novo)
 *   atrasados de verdade .......... 0   (os 3 eram ENCERRADO, em dia no ciclo)
 *
 * Os três acusados — 0080827-24.2024.5.22.0000, 0001409-68.2023.5.22.0001 e
 * 0001412-08.2023.5.22.0006 — têm o histórico 31/08 → 08/09 → 16/09 → 24/09:
 * exatamente a cadência prometida para a faixa lenta da varredura.
 */

const HORA = 3_600_000;
const AGORA = new Date('2026-09-24T09:00:00.000Z');
const horasAtras = (h: number) => new Date(AGORA.getTime() - h * HORA);

const falha = (over: Partial<Parameters<typeof estaAtrasada>[0]> = {}) => ({
  ultimoSucesso: horasAtras(30),
  dormente: false,
  createdAt: horasAtras(4),
  ...over,
});

describe('a régua é o ciclo do próprio processo', () => {
  it('o vivo é lido toda noite: duas voltas são 48h', () => {
    expect(cicloEmDias(false)).toBe(1);
    expect(horasAteOAtraso(false)).toBe(48);
  });

  it('o dormente é lido a cada sete dias: duas voltas são 14 dias', () => {
    expect(cicloEmDias(true)).toBe(DIAS_RECHECAGEM_DORMENTE);
    expect(horasAteOAtraso(true)).toBe(DIAS_RECHECAGEM_DORMENTE * 2 * 24);
  });

  /**
   * O DEFEITO DO PRINT. 202 horas (8,4 dias) é a idade normal da última leitura
   * de um processo dormente que acabou de perder a vez desta rodada. A régua de
   * 48h o acusava — e acusaria para sempre, porque o robô nunca prometeu lê-lo
   * em 48h.
   */
  it('202h sem leitura: alarme para o vivo, silêncio para o dormente', () => {
    const ultimoSucesso = horasAtras(202);
    expect(estaAtrasada(falha({ ultimoSucesso, dormente: false }), AGORA)).toBe(true);
    expect(estaAtrasada(falha({ ultimoSucesso, dormente: true }), AGORA)).toBe(false);
  });

  it('uma volta perdida ainda é soluço da rodada, não alarme', () => {
    expect(estaAtrasada(falha({ ultimoSucesso: horasAtras(30) }), AGORA)).toBe(false);
    expect(estaAtrasada(falha({ ultimoSucesso: horasAtras(47) }), AGORA)).toBe(false);
  });

  it('duas voltas perdidas é padrão, e aí alguém precisa olhar', () => {
    expect(estaAtrasada(falha({ ultimoSucesso: horasAtras(49) }), AGORA)).toBe(true);
    expect(
      estaAtrasada(falha({ ultimoSucesso: horasAtras(15 * 24), dormente: true }), AGORA),
    ).toBe(true);
  });

  /** Nunca lido é pior que qualquer número de horas — e não tem número. */
  it('nunca lido com sucesso está sempre atrasado, vivo ou dormente', () => {
    expect(estaAtrasada(falha({ ultimoSucesso: null }), AGORA)).toBe(true);
    expect(estaAtrasada(falha({ ultimoSucesso: null, dormente: true }), AGORA)).toBe(true);
  });
});

describe('a ordem existe para o corte não esconder o que importa', () => {
  /**
   * O QUE ACONTECEU NA PRODUÇÃO. A consulta terminava em
   * `ORDER BY created_at DESC LIMIT 25`, e os atrasados haviam falhado no
   * COMEÇO da rodada (02:00–02:07), então eram os mais antigos — e caíam fora.
   */
  it('quem pede atenção vem na frente, mesmo tendo falhado primeiro', () => {
    const atrasadoAntigo = falha({
      ultimoSucesso: horasAtras(300), createdAt: horasAtras(7),
    });
    const emDiaRecente = falha({ ultimoSucesso: horasAtras(30), createdAt: horasAtras(1) });
    const [primeiro] = ordenarFalhas([emDiaRecente, atrasadoAntigo], AGORA);
    expect(primeiro).toBe(atrasadoAntigo);
  });

  it('entre os atrasados, o mais abandonado primeiro — proporcional ao ciclo dele', () => {
    // 20 dias sem ler um DORMENTE = 1,4 ciclos além do limite.
    // 100h sem ler um VIVO = 2,08 ciclos além. O vivo está pior.
    const dormenteVelho = falha({ ultimoSucesso: horasAtras(20 * 24), dormente: true });
    const vivoVelho = falha({ ultimoSucesso: horasAtras(100) });
    expect(ordenarFalhas([dormenteVelho, vivoVelho], AGORA)[0]).toBe(vivoVelho);
  });

  it('nunca lido vem antes de todos', () => {
    const nunca = falha({ ultimoSucesso: null });
    const velho = falha({ ultimoSucesso: horasAtras(500) });
    expect(ordenarFalhas([velho, nunca], AGORA)[0]).toBe(nunca);
  });

  it('entre os que estão em dia, o tropeço mais recente primeiro', () => {
    const cedo = falha({ createdAt: horasAtras(7) });
    const tarde = falha({ createdAt: horasAtras(1) });
    expect(ordenarFalhas([cedo, tarde], AGORA)[0]).toBe(tarde);
  });

  it('não mexe no array que recebeu', () => {
    const a = falha({ ultimoSucesso: horasAtras(300) });
    const b = falha();
    const entrada = [b, a];
    ordenarFalhas(entrada, AGORA);
    expect(entrada).toEqual([b, a]);
  });
});

describe('o resumo é o número real, nunca o da lista cortada', () => {
  /** A manhã do print, reconstruída: 27 falhas, 3 dormentes acusados, 0 reais. */
  const aManhaDoPrint = [
    ...Array.from({ length: 24 }, () => falha({ ultimoSucesso: horasAtras(34) })),
    ...Array.from({ length: 3 }, () =>
      falha({ ultimoSucesso: horasAtras(202), dormente: true }),
    ),
  ];

  it('com a régua do ciclo, ninguém ficou para trás naquela manhã', () => {
    expect(resumirFalhas(aManhaDoPrint, AGORA, 25)).toEqual({
      total: 27,
      atrasados: 0,
      emDia: 27,
      mostrando: 25,
    });
  });

  /**
   * E O NÚMERO QUE A FRASE USA É O TOTAL, não o tamanho da lista: "outros 24"
   * era `25 - 1` calculado em cima do corte, com 27 falhas no banco.
   */
  it('o total ignora o corte', () => {
    const r = resumirFalhas(aManhaDoPrint, AGORA, 25);
    expect(r.total).toBe(27);
    expect(r.mostrando).toBe(25);
    expect(r.total - r.atrasados).toBe(27);
  });

  it('mostrando nunca é maior que o que existe', () => {
    expect(resumirFalhas([falha()], AGORA, 25).mostrando).toBe(1);
  });

  it('sem falha nenhuma, tudo zero', () => {
    expect(resumirFalhas([], AGORA, 25)).toEqual({
      total: 0, atrasados: 0, emDia: 0, mostrando: 0,
    });
  });
});
