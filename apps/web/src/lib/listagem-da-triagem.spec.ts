import { oSeloDeSituacaoAcrescenta, tempoDoAtendimento } from './atendimentos';
import { diasDeAtraso } from './agenda';

/**
 * "ESSA LISTAGEM DA TRIAGEM/ATENDIMENTO ESTÁ BOA? NÃO HÁ ALGO PARA MELHORAR NA
 * UI, COLORAÇÃO, FILTROS E LISTAGEM?" — o dono, 21/09/2026.
 *
 * Havia, e o maior problema era duas colunas contando o mesmo fato. Nas onze
 * linhas do print, "Resultado" e "Status" nunca discordaram:
 *
 *   Consulta marcada    ×  Aguardando a consulta
 *   Consulta atendida   ×  Concluído
 *
 * E não podiam discordar: desde 15/09/2026 o atendimento fecha SOZINHO quando o
 * advogado conclui a consulta. Duas colunas para um fato é o defeito do atraso
 * que aparecia em quatro superfícies no painel do advogado.
 */
const com = (extra: Record<string, unknown>) =>
  ({ status: 'PENDENTE', encaminhamento: { id: 'c1' }, ...extra }) as never;

describe('o selo de situação só aparece quando acrescenta', () => {
  it('"Consulta marcada" já diz que se aguarda a consulta: o selo some', () => {
    expect(oSeloDeSituacaoAcrescenta(com({ status: 'PENDENTE', fila: 'CONSULTA' }))).toBe(false);
  });

  it('"Consulta atendida" já diz que concluiu: o selo some', () => {
    expect(oSeloDeSituacaoAcrescenta(com({ status: 'CONCLUIDO' }))).toBe(false);
  });

  /** A bola ainda é da triagem — o chip fala da consulta, não de quem age. */
  it('pendente COM A TRIAGEM: o selo fica, porque diz outra coisa', () => {
    expect(oSeloDeSituacaoAcrescenta(com({ status: 'PENDENTE', fila: 'TRIAGEM' }))).toBe(true);
  });

  /** O chip nunca fala de cancelamento. */
  it('cancelado: o selo fica sempre', () => {
    expect(oSeloDeSituacaoAcrescenta(com({ status: 'CANCELADO' }))).toBe(true);
    expect(oSeloDeSituacaoAcrescenta(com({ status: 'CANCELADO', fila: 'CONSULTA' }))).toBe(true);
  });

  it('sem encaminhamento nenhum, o selo é a única voz', () => {
    expect(oSeloDeSituacaoAcrescenta({ status: 'CONCLUIDO' } as never)).toBe(true);
    expect(oSeloDeSituacaoAcrescenta({ status: 'PENDENTE', encaminhamento: null } as never)).toBe(true);
  });

  /**
   * API ANTIGA, SEM O CAMPO `fila` (janela de troca). Sem saber a fila, o selo
   * FICA: esconder informação por causa de um campo ausente é o modo de falhar
   * que apaga a tela; mostrar de novo é só redundância.
   */
  it('sem o campo fila, o selo fica', () => {
    expect(oSeloDeSituacaoAcrescenta(com({ status: 'PENDENTE' }))).toBe(true);
  });
});

/**
 * A COLUNA "DATA" VIROU "ESPERA". "21/09/2026, 09:52" é preciso e responde a
 * pergunta errada: quem abre a fila da triagem quer saber o que está parado há
 * mais tempo.
 */
describe('há quanto tempo espera', () => {
  const agora = new Date('2026-09-21T13:00:00.000Z');
  const diasAtras = (n: number) =>
    new Date(agora.getTime() - n * 86_400_000).toISOString();

  it('conta em dias de calendário, não em blocos de 24h', () => {
    // 23h de ontem em Teresina: menos de 24h atrás, e ainda assim é "1 dia".
    expect(diasDeAtraso('2026-09-21T01:00:00.000Z', agora)).toBe(1);
  });

  it('hoje é zero', () => {
    expect(diasDeAtraso('2026-09-21T11:00:00.000Z', agora)).toBe(0);
  });

  it('conta os dias passados', () => {
    expect(diasDeAtraso(diasAtras(6), agora)).toBe(6);
  });

  /** Data futura não vira número negativo na tela. */
  it('o que ainda não chegou não está esperando', () => {
    expect(diasDeAtraso(diasAtras(-3), agora)).toBe(0);
  });
});

/**
 * A COLUNA DO TEMPO NÃO COBRA QUEM JÁ ENTREGOU — 21/09/2026.
 *
 * "Por que fica essa 'espera há 4 dias' sendo que não é problema da triagem? A
 * triagem já fez a parte dela direcionando." E: "dá a impressão que a triagem
 * está atrasando ou atrasada."
 *
 * Correção de rota de uma coluna que eu criei na véspera: ela contava os dias
 * desde o registro para TODO atendimento pendente, inclusive os que já estão
 * com consulta marcada — onde a bola é do advogado e existe data na agenda.
 */
describe('de quem é a espera', () => {
  const consulta = (inicio: string) => ({
    estado: 'AGENDADA' as const, compromissoId: 'c1', inicio,
    responsavel: null, linkReuniao: null, local: null,
  });

  it('com consulta marcada, mostra a DATA dela — ninguém está atrasado', () => {
    expect(
      tempoDoAtendimento({
        status: 'PENDENTE',
        createdAt: '2026-09-17T12:00:00.000Z',
        fila: 'CONSULTA',
        encaminhamento: consulta('2026-09-24T14:30:00.000Z'),
      }),
    ).toEqual({ tipo: 'CONSULTA', quando: '2026-09-24T14:30:00.000Z' });
  });

  it('esperando a triagem, conta os dias — é a única fila desta tela', () => {
    expect(
      tempoDoAtendimento({
        status: 'PENDENTE',
        createdAt: '2026-09-17T12:00:00.000Z',
        fila: { fila: 'TRIAGEM', motivo: 'FALTA_CONCLUIR' },
      }),
    ).toEqual({ tipo: 'ESPERA', desde: '2026-09-17T12:00:00.000Z' });
  });

  /** A consulta que voltou para a triagem VOLTA a contar: ali alguém precisa agir. */
  it('consulta sem registro há 2 dias úteis volta a ser espera da triagem', () => {
    expect(
      tempoDoAtendimento({
        status: 'PENDENTE',
        createdAt: '2026-09-15T12:00:00.000Z',
        fila: { fila: 'TRIAGEM', motivo: 'CONSULTA_SEM_REGISTRO' },
        encaminhamento: consulta('2026-09-17T09:00:00.000Z'),
      }).tipo,
    ).toBe('ESPERA');
  });

  it('fechado mostra a data do registro: a pergunta ali é "quando foi"', () => {
    expect(
      tempoDoAtendimento({ status: 'CONCLUIDO', createdAt: '2026-09-15T12:00:00.000Z' }),
    ).toEqual({ tipo: 'DATA', quando: '2026-09-15T12:00:00.000Z' });
  });

  /**
   * API ANTIGA, SEM `fila`: cai em espera, que é o comportamento de antes. Sem
   * saber de quem é a vez, mostrar o relógio é menos pior que esconder.
   */
  it('sem o campo fila, continua contando', () => {
    expect(
      tempoDoAtendimento({ status: 'PENDENTE', createdAt: '2026-09-17T12:00:00.000Z' }).tipo,
    ).toBe('ESPERA');
  });
});
