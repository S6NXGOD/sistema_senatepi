import { StatusProcesso } from '@prisma/client';
import { DIAS_RECHECAGEM_DORMENTE, filtroDeVarredura } from './varredura.util';

/**
 * O filtro da varredura é um `where` do Prisma — não dá para "rodá-lo" aqui.
 * O que estes testes travam é a DECISÃO que ele codifica, que é onde o defeito
 * morava: um processo encerrado com tudo baixado saía da varredura para sempre,
 * enquanto a linha do tempo prometia que "o robô reabre sozinho".
 *
 * Por isso as asserções olham a ESTRUTURA do filtro, e cada uma corresponde a
 * uma frase que o sistema afirma ao usuário.
 */
const AGORA = new Date('2026-08-09T20:40:00.000Z');

/** Os três ramos do OR, na ordem em que o filtro os declara. */
function ramos(dias?: number) {
  const f = filtroDeVarredura(AGORA, dias);
  return (f.OR ?? []) as Record<string, any>[];
}

describe('quem o robô consulta de madrugada', () => {
  it('nunca consulta processo sem NPU — nem que mudem o status à mão', () => {
    expect(filtroDeVarredura(AGORA).numeroCNJ).toEqual({ not: null });
  });

  it('a faixa rápida cobre os três status VIVOS', () => {
    const vivos = ramos()[0].statusInterno.in;
    expect(vivos).toContain(StatusProcesso.ATIVO);
    expect(vivos).toContain(StatusProcesso.PENDENTE);
    // O defeito mais grave: "procedente, em fase de execução" é um processo
    // vivo, com prazo e audiência, e não era consultado.
    expect(vivos).toContain(StatusProcesso.GANHO_EXECUCAO);
  });

  it('mantém o encerrado com instância sem baixa na faixa rápida', () => {
    // Cumprimento de sentença correndo no 1º grau depois do trânsito no 2º.
    expect(ramos()[1]).toEqual({
      statusInterno: StatusProcesso.ENCERRADO,
      instancias: { some: { baixada: false } },
    });
  });

  /**
   * O TESTE DO DEFEITO. Antes, `ENCERRADO` só entrava com instância viva —
   * então o processo que o próprio robô encerrou (todas baixadas) nunca mais
   * era consultado, e a promessa "reabre sozinho na próxima movimentação" não
   * tinha como se cumprir.
   */
  it('o encerrado com TUDO baixado volta a ser consultado, na faixa lenta', () => {
    const dormentes = ramos()[2].statusInterno.in;
    expect(dormentes).toContain(StatusProcesso.ENCERRADO);
  });

  it('a faixa lenta também cobre arquivado, suspenso e improcedente', () => {
    const dormentes = ramos()[2].statusInterno.in;
    expect(dormentes).toContain(StatusProcesso.ARQUIVADO);
    expect(dormentes).toContain(StatusProcesso.SUSPENSO);
    expect(dormentes).toContain(StatusProcesso.IMPROCEDENTE);
  });

  it('PRE_PROCESSUAL não entra em nenhuma faixa', () => {
    const todos = [...ramos()[0].statusInterno.in, ...ramos()[2].statusInterno.in];
    expect(todos).not.toContain(StatusProcesso.PRE_PROCESSUAL);
  });

  it('o corte da faixa lenta fica N dias atrás', () => {
    const corte = ramos(7)[2].OR[1].ultimaSincronizacao.lt as Date;
    expect(corte.toISOString()).toBe('2026-08-02T20:40:00.000Z');
  });

  it('quem nunca foi sincronizado entra sempre — silêncio não é "está em dia"', () => {
    expect(ramos()[2].OR[0]).toEqual({ ultimaSincronizacao: null });
  });

  it('o intervalo padrão é semanal', () => {
    expect(DIAS_RECHECAGEM_DORMENTE).toBe(7);
    expect(ramos()[2].OR[1].ultimaSincronizacao.lt).toEqual(
      ramos(DIAS_RECHECAGEM_DORMENTE)[2].OR[1].ultimaSincronizacao.lt,
    );
  });
});
