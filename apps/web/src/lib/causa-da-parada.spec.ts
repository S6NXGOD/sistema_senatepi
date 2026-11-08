import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { causaDaParada } from './causa-da-parada';

/**
 * POR QUE A BUSCA NO DIÁRIO PAROU — com as frases reais que a rodada gravou.
 *
 * As três primeiras são linhas de resumo da produção de 04 a 07/11/2026, quando
 * o aviso culpava o Diário e quem estava fora do ar era a nossa ponte.
 */
describe('a causa da parada do Diário', () => {
  it('rede: a ponte não responde, e o Diário está no ar', () => {
    const linha =
      'Rodada encerrada porque 14 consultas seguidas não alcançaram o Diário ' +
      '(falha de rede: UND_ERR_CONNECT_TIMEOUT): 188 processos e 7 advogados ficaram para a próxima noite.';
    expect(causaDaParada('DJEN', linha)).toBe(
      'A ponte no Brasil, por onde o sistema chega ao Diário, não está respondendo — o Diário em si está no ar.',
    );
  });

  it('403: diz quem recusou, com as palavras do cabeçalho', () => {
    const linha =
      'Rodada encerrada porque 3 consultas seguidas voltaram com 403 sem sinal de cota ' +
      '(quem recusou: CDN do CNJ, ponto SFO53-P1): 165 processos ficaram para a próxima noite.';
    expect(causaDaParada('DJEN', linha)).toBe(
      'O Diário recusou as consultas vindas deste servidor (quem recusou: CDN do CNJ, ponto SFO53-P1).',
    );
  });

  /** Motivo desconhecido: a frase genérica fica — vaga, mas não falsa. */
  it('sem motivo reconhecido, não inventa', () => {
    expect(causaDaParada('DJEN', 'Varredura sem resposta: as 4 consulta(s) falharam.')).toBeNull();
    expect(causaDaParada('DJEN', null)).toBeNull();
  });

  it('só fala do Diário: o DataJud tem outra rota', () => {
    expect(causaDaParada('DATAJUD', 'falha de rede: UND_ERR_CONNECT_TIMEOUT')).toBeNull();
  });

  it('o aviso do painel usa a causa e cai na frase antiga só sem ela', () => {
    const PAINEL = readFileSync(join(__dirname, '../app/(dashboard)/dashboard/page.tsx'), 'utf8');
    expect(PAINEL).toContain(
      '(causaDaParada(i.fonte, i.ultimoErro) ?? `O ${fonte.nome} não respondeu às últimas tentativas.`)',
    );
  });
});
