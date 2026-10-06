import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MINUTOS_DA_VARREDURA_COMPLETA } from './djen.controller';

const CTRL = readFileSync(join(__dirname, 'djen.controller.ts'), 'utf8').replace(/\r/g, '');
const CLIENTE = readFileSync(join(__dirname, '../../../../web/src/lib/djen.ts'), 'utf8').replace(/\r/g, '');

/**
 * "MESMO CLICANDO EM BUSCAR COM DJEN DÁ ERRO" — o dono, 06/10/2026.
 *
 * A busca FUNCIONAVA. Medido na produção naquele mesmo dia, as duas varreduras
 * manuais que ele disparou:
 *
 *   começou 11:14:00 · terminou 11:29:24 · 924s · OK · 7 publicações
 *   começou 11:49:28 · terminou 12:01:41 · 733s · OK
 *
 * O erro era do NAVEGADOR desistindo: o cliente abortava em 10 minutos
 * (`timeout: 600_000`) e mostrava "Não foi possível buscar no Diário agora"
 * enquanto o servidor seguia e terminava bem.
 *
 * E NÃO ERA AZAR — era aritmética. A cota do CNJ obriga 14 consultas por minuto
 * e a varredura faz ~192: **o piso é 13,7 minutos**, e cresce com o acervo.
 * Nunca caberia em dez. Aumentar o tempo do cliente adiaria o mesmo erro e
 * ainda dependeria de a aba ficar aberta um quarto de hora.
 */
describe('a rota começa a varredura e responde na hora', () => {
  it('não espera a varredura terminar', () => {
    expect(CTRL).toContain('const emAndamento = comTravaDeJob(');
    expect(CTRL).toContain('iniciada: true,');
    // O `await` da promessa inteira era o defeito.
    expect(CTRL).not.toContain('const rodada = await comTravaDeJob(');
  });

  /**
   * PROMESSA SEM DONO DERRUBA O NODE. A varredura já grava a própria linha de
   * resumo com o que deu errado; aqui basta não deixar o erro solto.
   */
  it('a promessa longa tem catch', () => {
    expect(CTRL).toContain('emAndamento.catch((e) =>');
  });

  /**
   * O 409 CONTINUA HONESTO. Conflito de trava resolve sem tocar na rede, em
   * milissegundos — se a promessa voltar em 2s dizendo que não executou, é
   * porque já havia varredura rodando.
   */
  it('quem chega durante outra varredura ainda recebe 409', () => {
    expect(CTRL).toContain('const ocupada = await Promise.race([');
    expect(CTRL).toContain('emAndamento.then((r) => !r.executou)');
    expect(CTRL).toContain('if (ocupada) throw new ConflictException(VARREDURA_DO_DIARIO_OCUPADA);');
  });

  /** A estimativa é calculada, não chutada: 192 consultas a 14 por minuto. */
  it('a resposta leva uma estimativa maior que o piso real', () => {
    const piso = 192 / 14;
    expect(MINUTOS_DA_VARREDURA_COMPLETA).toBeGreaterThan(piso);
    expect(CTRL).toContain('minutosEstimados: MINUTOS_DA_VARREDURA_COMPLETA,');
  });

  /**
   * E O CLIENTE NÃO IMPÕE MAIS PRAZO. Com a resposta imediata, um `timeout`
   * aqui só poderia recriar o mesmo erro.
   */
  it('o cliente web não tem mais o timeout de 10 minutos', () => {
    const i = CLIENTE.indexOf('export async function varrerDjenAgora(');
    const bloco = CLIENTE.slice(i, CLIENTE.indexOf('\n}', i));
    expect(bloco).not.toContain('timeout: 600_000');
    expect(bloco).not.toContain('timeout:');
  });

  /** API antiga da janela de troca não manda `iniciada` — e mesmo assim começou. */
  it('resposta sem `iniciada` ainda conta como início', () => {
    expect(CLIENTE).toContain('iniciada: data?.iniciada !== false,');
  });
});
