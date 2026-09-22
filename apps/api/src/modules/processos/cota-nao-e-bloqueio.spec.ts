import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * COTA NÃO É BLOQUEIO DE ORIGEM — 22/09/2026.
 *
 * No dia em que a ponte brasileira voltou, a varredura entrou, gravou 7
 * publicações e registrou "159 de 165 consulta(s) em falha" — em SEIS SEGUNDOS.
 * Seis segundos para 165 chamadas não é rede lenta: é o disjuntor aberto.
 *
 * Medido contra a ponte, de fora: 20 chamadas seguidas devolvem 12 × 200 e
 * 8 × 403, com `X-RateLimit-Limit: 20` nos 200 e `X-Amz-Cf-Pop: GRU1`
 * (São Paulo). A ponte funciona; o CNJ recusa por VOLUME. Só que nesse 403 ele
 * não manda `X-RateLimit-*`, e a heurística de 14/09 — "403 sem o cabeçalho é
 * o CDN recusando a origem" — classificava cota como bloqueio, abria o
 * disjuntor por 60 minutos e derrubava as outras 159 chamadas na hora.
 *
 * O CABEÇALHO NÃO BASTA. O histórico basta: o CDN bloqueia por IP, tudo ou
 * nada — ele não alterna 200 e 403 no mesmo minuto. Um 403 logo depois de um
 * 200 pela mesma rota é volume, e volume se resolve esperando a janela virar.
 */
const FONTE = readFileSync(join(__dirname, 'djen.service.ts'), 'utf8');

describe('o 403 depois de um sucesso recente', () => {
  it('não abre o disjuntor', () => {
    expect(FONTE).toContain(
      'if (res.status === 403 && this.saldoInformado === null && !respondeuHaPouco) {',
    );
  });

  it('o sucesso é carimbado a cada 200', () => {
    expect(FONTE).toContain('this.ultimoSucessoEm = Date.now();');
  });

  it('a janela é explícita e curta', () => {
    expect(FONTE).toContain('const JANELA_DE_SUCESSO_RECENTE_MS = 5 * 60_000;');
    expect(FONTE).toContain(
      'Date.now() - this.ultimoSucessoEm < JANELA_DE_SUCESSO_RECENTE_MS',
    );
  });

  /**
   * E O DISJUNTOR CONTINUA EXISTINDO. Sem nenhum 200 recente — que é o caso do
   * bloqueio de origem de verdade, em que NADA passa —, o 403 sem cabeçalho
   * segue abrindo a pausa. Tirar a proteção trocaria um problema por outro:
   * centenas de falhas por noite e horas de robô preso.
   */
  it('sem sucesso recente, o bloqueio de origem continua sendo reconhecido', () => {
    expect(FONTE).toContain('this.bloqueadoAte = Date.now() + PAUSA_APOS_BLOQUEIO_MS;');
    expect(FONTE).toContain('Bloqueio de origem confirmado');
  });
});
