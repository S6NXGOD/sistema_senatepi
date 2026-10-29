import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { linhaDeResumoDatajud } from './processos-cron.service';

const semComentarios = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const CRON = semComentarios(
  readFileSync(join(__dirname, 'processos-cron.service.ts'), 'utf8').replace(/\r/g, ''),
);

/**
 * OS DOIS ROBÔS NÃO PODEM CORRER JUNTOS — medido na produção em 29/10/2026.
 *
 * A rodada do DataJud começa às 02h de Teresina; a do DJEN, às 05h. Nada
 * impedia a primeira de passar da segunda, e passou em três dos últimos sete
 * dias. A cota do CNJ é por endereço de saída, e os dois robôs saem pelo
 * mesmo: quando correm juntos, disputam entre si o que já é escasso.
 *
 *   22/10  05:00 → 05:46 ( 46 min)   0% de falha
 *   25/10  05:00 → 06:23 ( 83 min)   4%
 *   27/10  05:00 → 06:58 (118 min)   7%
 *   23/10  05:00 → 08:27 (207 min)  38%   ← invadiu o DJEN
 *   28/10  05:00 → 08:17 (197 min)  28%, e 63% DEPOIS das 08h
 *   29/10  05:00 → 08:28 (208 min)  37%
 *
 * Os três dias em que ela passou das 05h são os três com mais falha.
 */
describe('o orçamento de tempo da rodada do DataJud', () => {
  it('existe, e é menor que as 3 horas entre um cron e o outro', () => {
    const m = /ORCAMENTO_DA_RODADA_MIN = Number\([\s\S]{0,80}?\) \|\| (\d+)/.exec(CRON);
    expect(m).toBeTruthy();
    const minutos = Number(m![1]);
    // 02h → 05h são 180 minutos. O orçamento tem de terminar antes, com folga.
    expect(minutos).toBeLessThan(180);
    expect(minutos).toBe(150);
  });

  /**
   * O CORTE PRECISA ESTAR NOS DOIS LAÇOS. A repescagem aceita 40 processos a
   * ~58s cada — sozinha, quase 40 minutos depois do laço principal. Cortar só
   * o primeiro seria contornar o orçamento justamente na parte que roda mais
   * tarde.
   */
  it('para o laço principal E a repescagem', () => {
    expect(CRON.match(/if \(estourouOTempo\(\)\)/g) ?? []).toHaveLength(2);
  });

  /** A parada é entre lotes: cortar no meio deixaria o lote pela metade. */
  it('o corte do laço principal é entre lotes, antes de montar o próximo', () => {
    const laco = CRON.slice(CRON.indexOf('for (let inicioLote'));
    const corte = laco.indexOf('estourouOTempo()');
    const monta = laco.indexOf('const lote = ids.slice');
    expect(corte).toBeGreaterThan(0);
    expect(corte).toBeLessThan(monta);
  });

  /**
   * QUEM FICOU PARA TRÁS APARECE NA LINHA DO BANCO, e não só no stdout do
   * Railway — que tem retenção própria. Sem a frase, uma rodada cortada pelo
   * tempo seria indistinguível de uma rodada curta.
   */
  it('a linha de resumo conta quem ficou para a próxima noite', () => {
    const r = linhaDeResumoDatajud({
      elegiveis: 190, ok: 120, comNovas: 3, novas: 7, falhas: 10,
      paradosPorTempo: 60, quebrou: null,
    });
    expect(r.sucesso).toBe(true);
    expect(r.mensagemErro).toContain('60 ficaram para a próxima noite');
    expect(r.mensagemErro).toContain('a rodada passou do tempo');
  });

  it('e não inventa a frase quando a rodada coube no tempo', () => {
    const r = linhaDeResumoDatajud({
      elegiveis: 190, ok: 190, comNovas: 3, novas: 7, falhas: 0,
      paradosPorTempo: 0, quebrou: null,
    });
    expect(r.mensagemErro).not.toContain('próxima noite');
    expect(r.mensagemErro).toContain('190 processo(s) consultado(s)');
  });

  /**
   * NADA SE PERDE. A fila ordena pela leitura mais antiga, então quem ficou de
   * fora entra primeiro na noite seguinte — é o que torna o corte aceitável.
   * Se alguém trocar a ordenação, o orçamento passa a jogar processo fora.
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
