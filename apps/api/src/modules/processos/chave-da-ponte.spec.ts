import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A CHAVE DA PONTE SÓ VAI PELA PONTE — 22/09/2026.
 *
 * O repassador brasileiro é, por natureza, um proxy aberto para a API do CNJ:
 * quem descobrir o IP consome a cota em nome do sindicato, e a cota é POR IP
 * (20/min). O Nginx recusa quem não traz o cabeçalho combinado.
 *
 * DOIS CUIDADOS, e os dois são fáceis de perder num refactor:
 *
 * 1. O SEGREDO NÃO VAI PARA O CNJ. Chamada direta (sem ponte) não leva
 *    cabeçalho nenhum além do `Accept` — mandar segredo nosso a um servidor de
 *    fora é entregá-lo de graça, mesmo que o destinatário o ignore.
 * 2. VAZIA, NADA É ENVIADO. É o que permite configurar os dois lados em
 *    qualquer ordem: a variável entra no Railway antes ou depois do Nginx, e
 *    nenhum dos dois estados quebra o que já funcionava.
 */
const FONTE = readFileSync(join(__dirname, 'djen.service.ts'), 'utf8');

describe('a chave da ponte', () => {
  it('é lida do ambiente e aparada', () => {
    expect(FONTE).toContain(
      "this.ponteChave = (this.config.get<string>('DJEN_PONTE_CHAVE') ?? '').trim();",
    );
  });

  it('só é enviada quando existe E o destino não é o CNJ', () => {
    expect(FONTE).toContain(
      "...(this.ponteChave && !this.baseUrl.includes('pje.jus.br')",
    );
    expect(FONTE).toContain("{ 'X-Ponte-Chave': this.ponteChave }");
  });

  /**
   * O `Accept` continua sendo o único cabeçalho garantido — se alguém trocar o
   * espalhamento por um objeto fixo, a chamada direta volta a levar o segredo.
   */
  it('o Accept continua incondicional', () => {
    expect(FONTE).toContain("Accept: 'application/json',");
  });
});
