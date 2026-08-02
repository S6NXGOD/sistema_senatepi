import { PADROES, janelaCheckin, lerConfiguracoes, normalizarConfiguracoes } from './configuracoes-evento';

/**
 * `configuracoes` é uma coluna JSON: o banco aceita qualquer coisa. Estes
 * testes são o contrato que impede uma chave escrita errada de virar
 * `undefined` — que é falsy — e liberar uma assembleia inteira SEM ERRO NENHUM.
 */
describe('lerConfiguracoes', () => {
  it('objeto vazio devolve os padrões', () => {
    expect(lerConfiguracoes({})).toEqual(PADROES);
  });

  it('nulo e indefinido não quebram', () => {
    expect(lerConfiguracoes(null)).toEqual(PADROES);
    expect(lerConfiguracoes(undefined)).toEqual(PADROES);
  });

  it('adimplência começa DESLIGADA', () => {
    // 70% da base histórica não tem carnê emitido. Ligar por padrão barraria
    // quase todo mundo na primeira assembleia.
    expect(PADROES.exigeAdimplencia).toBe(false);
  });

  it('respeita as chaves booleanas informadas', () => {
    const c = lerConfiguracoes({ exigeAdimplencia: true, habilitarVotacao: true });
    expect(c.exigeAdimplencia).toBe(true);
    expect(c.habilitarVotacao).toBe(true);
    expect(c.habilitarSorteio).toBe(false);
  });

  it('IGNORA valor de tipo errado e mantém o padrão', () => {
    // "true" (string) não é true. Aceitar seria o começo de um evento que
    // exige adimplência sem ninguém ter pedido.
    const c = lerConfiguracoes({ exigeAdimplencia: 'true', habilitarVotacao: 1 });
    expect(c.exigeAdimplencia).toBe(false);
    expect(c.habilitarVotacao).toBe(false);
  });

  it('descarta chave desconhecida', () => {
    const c = lerConfiguracoes({ exigeAdimplenciaa: true, xpto: 'lixo' }) as unknown as Record<string, unknown>;
    expect(c.exigeAdimplenciaa).toBeUndefined();
    expect(c.xpto).toBeUndefined();
    expect(c.exigeAdimplencia).toBe(false);
  });

  it('limita a janela de abertura a valores sãos', () => {
    expect(lerConfiguracoes({ checkinAbreMinutosAntes: 30 }).checkinAbreMinutosAntes).toBe(30);
    // 99999 minutos são 69 dias: erro de digitação, não intenção.
    expect(lerConfiguracoes({ checkinAbreMinutosAntes: 99999 }).checkinAbreMinutosAntes)
      .toBe(PADROES.checkinAbreMinutosAntes);
    expect(lerConfiguracoes({ checkinAbreMinutosAntes: -5 }).checkinAbreMinutosAntes)
      .toBe(PADROES.checkinAbreMinutosAntes);
  });

  it('normalizar é o mesmo contrato da leitura', () => {
    expect(normalizarConfiguracoes({ habilitarVotacao: true, lixo: 1 }))
      .toEqual({ ...PADROES, habilitarVotacao: true });
  });
});

describe('janelaCheckin', () => {
  const cfg = { ...PADROES, checkinAbreMinutosAntes: 60, checkinFechaMinutosDepois: 0 };
  const base = new Date('2026-08-10T19:00:00Z');
  const evento = (over = {}) => ({
    dataInicio: base,
    dataFim: null as Date | null,
    status: 'AGENDADO',
    ...over,
  });

  it('fechado antes da janela, dizendo QUANDO abre', () => {
    const r = janelaCheckin(evento(), cfg, new Date('2026-08-10T17:00:00Z'));
    expect(r.aberto).toBe(false);
    expect(r.motivo).toContain('60');
  });

  it('aberto dentro da janela prévia', () => {
    expect(janelaCheckin(evento(), cfg, new Date('2026-08-10T18:30:00Z')).aberto).toBe(true);
  });

  it('sem data de fim, segue aberto — assembleia não tem hora para acabar', () => {
    expect(janelaCheckin(evento(), cfg, new Date('2026-08-10T23:00:00Z')).aberto).toBe(true);
  });

  it('com data de fim, fecha depois dela', () => {
    const e = evento({ dataFim: new Date('2026-08-10T21:00:00Z') });
    expect(janelaCheckin(e, cfg, new Date('2026-08-10T20:00:00Z')).aberto).toBe(true);
    expect(janelaCheckin(e, cfg, new Date('2026-08-10T21:30:00Z')).aberto).toBe(false);
  });

  it('evento cancelado ou realizado não aceita entrada', () => {
    const agora = new Date('2026-08-10T19:30:00Z');
    expect(janelaCheckin(evento({ status: 'CANCELADO' }), cfg, agora).aberto).toBe(false);
    expect(janelaCheckin(evento({ status: 'REALIZADO' }), cfg, agora).aberto).toBe(false);
  });

  it('sempre explica o motivo — "fechado" sem razão gera ligação para a secretaria', () => {
    const r = janelaCheckin(evento({ status: 'CANCELADO' }), cfg, base);
    expect(r.motivo.length).toBeGreaterThan(10);
  });
});
