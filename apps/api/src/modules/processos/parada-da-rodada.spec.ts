import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { linhaDeResumoDatajud } from './processos-cron.service';

const semComentarios = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const CRON = semComentarios(
  readFileSync(join(__dirname, 'processos-cron.service.ts'), 'utf8').replace(/\r/g, ''),
);

/**
 * A RODADA DO DATAJUD PARA PELA SAÚDE DA FONTE, NUNCA PELO RELÓGIO.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * HISTÓRIA, porque ela explica os dois erros que este arquivo guarda.
 *
 * 29/10/2026 — os dois robôs corriam juntos. O DataJud começa às 02h e o DJEN
 * às 05h, e nada impedia o primeiro de passar do segundo:
 *
 *   22/10  05:00 → 05:46 ( 46 min)   0% de falha
 *   25/10  05:00 → 06:23 ( 83 min)   4%
 *   27/10  05:00 → 06:58 (118 min)   7%
 *   23/10  05:00 → 08:27 (207 min)  38%   ← invadiu o DJEN
 *   28/10  05:00 → 08:17 (197 min)  28%, e 63% DEPOIS das 08h
 *   29/10  05:00 → 08:28 (208 min)  37%
 *
 * A resposta foi um ORÇAMENTO DE TEMPO de 150 minutos: a rodada cortava ali e
 * o resto ficava para a noite seguinte. Protegia a janela do Diário cortando
 * a leitura do acervo.
 *
 * 03/11/2026 — as duas premissas caíram.
 *
 *  1. O Diário passou a ESPERAR a vez em vez de começar às 05:00, então não
 *     há mais janela para proteger.
 *  2. Medido em 45 noites, o corte **nunca disparou**. As rodadas desde que
 *     ele entrou: 92, 94, 95, 99 e 110 minutos. Ele só agiria nas noites em
 *     que o CNJ fica lento (149s e 160s por consulta em 28 e 29/10, contra
 *     33s em 03/11) — e nelas abandonaria ~100 dos 160 processos.
 *
 * Ordem do dono, no mesmo dia: *"a prioridade é CNJ e DataJud e depois os
 * outros. Mesmo que estoure o teto, com tanto que não esteja dando problema
 * mesmo na API, nem que estoure o horário, mas continue para que nenhum
 * processo e atualização fique de fora"*.
 *
 * Por isso os testes abaixo são, na maior parte, NEGATIVOS: o que eles
 * protegem é a ausência do relógio como critério.
 */
describe('a parada da rodada do DataJud', () => {
  it('não existe mais orçamento de tempo que corte a varredura', () => {
    expect(CRON).not.toContain('ORCAMENTO_DA_RODADA_MIN');
    expect(CRON).not.toContain('estourouOTempo');
  });

  /**
   * O CRITÉRIO É RECUSA SEGUIDA DA FONTE. A maior sequência de falhas seguidas
   * em 45 noites foi 10 (10/10), depois 9 e 8 — todas em noites que terminaram
   * bem. O corte tem de ficar acima disso com folga, senão ruído vira
   * desistência.
   */
  it('para quando o CNJ recusa muitas consultas SEGUIDAS, com folga sobre o ruído', () => {
    const m = /RECUSAS_SEGUIDAS_PARA_PARAR = Number\([\s\S]{0,80}?\) \|\| (\d+)/.exec(CRON);
    expect(m).toBeTruthy();
    const recusas = Number(m![1]);
    // A pior sequência real foi 10. Abaixo de 20 o ruído de uma noite ruim
    // começaria a encerrar rodadas boas.
    expect(recusas).toBeGreaterThanOrEqual(20);
    expect(recusas).toBe(25);
  });

  /**
   * SÓ A RECUSA DA FONTE CONTA, e isto é o coração da distinção. Um punhado de
   * processos com tribunal desconhecido não é "o CNJ caiu" — nesses casos ele
   * respondeu. Sem o `else`, dez cadastros ruins em sequência encerrariam a
   * noite inteira.
   */
  it('só conta recusa da FONTE, e qualquer resposta boa zera a conta', () => {
    // Nos DOIS laços — o principal e a repescagem — a conta só sobe com recusa
    // da fonte, e a resposta que não é recusa zera.
    expect(CRON.match(/if \(valeTentarDeNovo\(err\)\) recusasSeguidas\+\+;/g) ?? []).toHaveLength(2);
    expect(CRON.match(/else recusasSeguidas = 0;/g) ?? []).toHaveLength(2);
    // E o sucesso zera nos dois também (uma vez cada, mais a declaração).
    expect(CRON.match(/^\s*recusasSeguidas = 0;$/gm) ?? []).toHaveLength(2);
  });

  /**
   * A TRAVA DE SEGURANÇA NÃO É ORÇAMENTO. O pior caso plausível é o acervo
   * inteiro na velocidade mais lenta já medida: 160 processos a 160s dão ~7
   * horas. O limite tem de ficar bem acima disso — senão é o orçamento de
   * volta com outro nome — e bem abaixo das 24h entre execuções.
   */
  it('tem limite absoluto, largo o bastante para não ser um orçamento disfarçado', () => {
    const m = /LIMITE_ABSOLUTO_MIN = Number\([\s\S]{0,80}?\) \|\| (\d+) \* 60/.exec(CRON);
    expect(m).toBeTruthy();
    const horas = Number(m![1]);
    // 7h é o pior caso medido; menos que o dobro disso voltaria a cortar leitura.
    expect(horas).toBeGreaterThanOrEqual(14);
    // E ainda tem de sobrar madrugada antes das 02:00 seguintes.
    expect(horas).toBeLessThan(24);
    expect(horas).toBe(20);
  });

  /**
   * A PARADA PRECISA ESTAR NOS DOIS LAÇOS. A repescagem aceita 40 processos a
   * ~58s cada — sozinha, quase 40 minutos depois do laço principal. Cobrir só
   * o primeiro deixaria a rodada insistindo com a fonte fechada justamente na
   * parte que roda mais tarde.
   */
  it('para o laço principal E a repescagem', () => {
    expect(CRON.match(/const motivo = motivoParaParar\(\);/g) ?? []).toHaveLength(2);
  });

  /** A parada é entre lotes: cortar no meio deixaria o lote pela metade. */
  it('o corte do laço principal é entre lotes, antes de montar o próximo', () => {
    const laco = CRON.slice(CRON.indexOf('for (let inicioLote'));
    const corte = laco.indexOf('motivoParaParar()');
    const monta = laco.indexOf('const lote = ids.slice');
    expect(corte).toBeGreaterThan(0);
    expect(corte).toBeLessThan(monta);
  });

  /**
   * O MOTIVO VAI PARA A LINHA DO BANCO, e não só para o stdout do Railway, que
   * tem retenção própria. "60 ficaram para amanhã" sem motivo manda a equipe
   * procurar defeito aqui dentro quando o problema está na porta do CNJ.
   */
  it('a linha de resumo diz quantos ficaram E por quê', () => {
    const r = linhaDeResumoDatajud({
      elegiveis: 190, ok: 120, comNovas: 3, novas: 7, falhas: 10,
      naoConsultados: 60,
      porqueParou: 'o CNJ recusou 25 consultas seguidas',
      quebrou: null,
    });
    expect(r.sucesso).toBe(true);
    expect(r.mensagemErro).toContain('60 ficaram para a próxima noite');
    expect(r.mensagemErro).toContain('o CNJ recusou 25 consultas seguidas');
  });

  /** E a frase nunca culpa o relógio, porque o relógio não decide mais nada. */
  it('a linha de resumo não fala de tempo', () => {
    const r = linhaDeResumoDatajud({
      elegiveis: 190, ok: 120, comNovas: 3, novas: 7, falhas: 10,
      naoConsultados: 60,
      porqueParou: 'o CNJ recusou 25 consultas seguidas',
      quebrou: null,
    });
    expect(r.mensagemErro).not.toContain('passou do tempo');
    expect(r.mensagemErro).not.toContain('orçamento');
  });

  it('e não inventa a frase quando a rodada varreu tudo', () => {
    const r = linhaDeResumoDatajud({
      elegiveis: 190, ok: 190, comNovas: 3, novas: 7, falhas: 0,
      naoConsultados: 0, porqueParou: null, quebrou: null,
    });
    expect(r.mensagemErro).not.toContain('próxima noite');
    expect(r.mensagemErro).toContain('190 processo(s) consultado(s)');
  });

  /**
   * NADA SE PERDE. A fila ordena pela leitura mais antiga, então quem ficou de
   * fora entra primeiro na noite seguinte — é o que torna qualquer parada
   * aceitável. Se alguém trocar a ordenação, a parada passa a jogar processo
   * fora, e aí "nenhum processo fica de fora" deixa de ser verdade.
   */
  it('a fila continua ordenando pela leitura mais antiga', () => {
    const servico = semComentarios(
      readFileSync(join(__dirname, 'processos.service.ts'), 'utf8').replace(/\r/g, ''),
    );
    const i = servico.indexOf('idsParaSincronizar');
    expect(i).toBeGreaterThan(0);
    const trecho = servico.slice(i, i + 900);
    expect(trecho).toMatch(/ultimaSincronizacao:\s*\{?\s*(sort:\s*)?'asc'/);
  });
});
