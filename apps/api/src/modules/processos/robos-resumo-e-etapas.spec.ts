import { Logger } from '@nestjs/common';
import { OrigemSincronizacao } from '@prisma/client';
import { ProcessosCronService, linhaDeResumoDatajud } from './processos-cron.service';
import { DjenSyncService } from './djen-sync.service';

beforeAll(() => {
  for (const nivel of ['log', 'warn', 'error', 'debug'] as const) {
    jest.spyOn(Logger.prototype, nivel).mockImplementation(() => undefined);
  }
});
afterAll(() => jest.restoreAllMocks());

/**
 * A RODADA DO DATAJUD GRAVA O QUE ACONTECEU — rodou, rodou sem alvo, quebrou.
 *
 * Até 13/09/2026 o DataJud era a única rotina externa sem linha de resumo: uma
 * noite sem processo elegível, ou que quebrava antes do primeiro processo, não
 * deixava linha nenhuma, e o painel só estranhava dois dias úteis depois.
 */
describe('a linha de resumo do DataJud', () => {
  const rodada = (r: Partial<{ elegiveis: number; ok: number; comNovas: number; novas: number; falhas: number; quebrou: string | null }>) => ({
    elegiveis: 0, ok: 0, comNovas: 0, novas: 0, falhas: 0, quebrou: null, ...r,
  });

  it('pulada pela trava é sucesso — outra varredura aconteceu', () => {
    const l = linhaDeResumoDatajud({ pulada: true });
    expect(l.sucesso).toBe(true);
    expect(l.novasMovimentacoes).toBe(0);
    expect(l.mensagemErro).toMatch(/^Rodada pulada: outra varredura do DataJud detinha a trava/);
  });

  it('sem processo elegível é sucesso, e diz isso', () => {
    expect(linhaDeResumoDatajud(rodada({}))).toEqual({
      sucesso: true,
      novasMovimentacoes: 0,
      mensagemErro: 'Rodada sem alvo: nenhum processo elegível para consulta.',
    });
  });

  it('quebra no meio é falha, com o motivo e até onde chegou', () => {
    const l = linhaDeResumoDatajud(rodada({ elegiveis: 10, ok: 2, falhas: 1, novas: 4, quebrou: 'conexão encerrada' }));
    expect(l.sucesso).toBe(false);
    expect(l.novasMovimentacoes).toBe(4);
    expect(l.mensagemErro).toBe(
      'Rodada interrompida: conexão encerrada (3 de 10 processo(s) consultado(s) antes da quebra).',
    );
  });

  /** A lista de ids que não veio (banco fora) não pode ser lida como "sem alvo". */
  it('quebra antes de saber os elegíveis continua sendo quebra, não "sem alvo"', () => {
    const l = linhaDeResumoDatajud(rodada({ quebrou: 'banco fora' }));
    expect(l.sucesso).toBe(false);
    expect(l.mensagemErro).toMatch(/^Rodada interrompida: banco fora/);
  });

  it('todas as consultas em falha é falha', () => {
    expect(linhaDeResumoDatajud(rodada({ elegiveis: 4, falhas: 4 }))).toEqual({
      sucesso: false,
      novasMovimentacoes: 0,
      mensagemErro: 'Rodada sem resposta: as 4 consulta(s) falharam.',
    });
  });

  it('parte em falha é sucesso, e conta as falhas', () => {
    const l = linhaDeResumoDatajud(rodada({ elegiveis: 10, ok: 8, falhas: 2, comNovas: 1, novas: 3 }));
    expect(l.sucesso).toBe(true);
    expect(l.mensagemErro).toBe(
      'Rodada concluída com 2 de 10 consulta(s) em falha; 8 processo(s) consultado(s), 1 com novidade (3 movimentação(ões) nova(s)).',
    );
  });

  it('tudo certo', () => {
    expect(linhaDeResumoDatajud(rodada({ elegiveis: 10, ok: 10, comNovas: 2, novas: 7 }))).toEqual({
      sucesso: true,
      novasMovimentacoes: 7,
      mensagemErro: 'Rodada concluída: 10 processo(s) consultado(s), 2 com novidade (7 movimentação(ões) nova(s)).',
    });
  });
});

describe('a varredura do DataJud grava a linha em toda saída', () => {
  const montar = (opcoes: {
    ids: () => Promise<string[]>;
    ressincronizar?: (id: string) => Promise<{ novas: number }>;
    radar?: () => Promise<number>;
  }) => {
    const processos = {
      idsParaSincronizar: jest.fn(opcoes.ids),
      ressincronizarSilencioso: jest.fn(opcoes.ressincronizar ?? (async () => ({ novas: 0 }))),
    };
    const audiencias = { contarPendentes: jest.fn(opcoes.radar ?? (async () => 0)) };
    const logSync = { registrar: jest.fn(async (..._args: unknown[]) => undefined) };
    const cron = new ProcessosCronService({} as never, processos as never, audiencias as never, logSync as never);
    // Sem os 2–3 s entre consultas: o que se testa é a contagem, não a cadência.
    (cron as unknown as { aguardar: () => Promise<void> }).aguardar = async () => undefined;
    // E sem o minuto de espera da repescagem de cota, pelo mesmo motivo.
    (cron as unknown as { PAUSA_APOS_COTA: number }).PAUSA_APOS_COTA = 0;
    const varrer = () => (cron as unknown as { varrer: () => Promise<void> }).varrer();
    return { processos, logSync, varrer };
  };

  const linha = (logSync: { registrar: jest.Mock }) => {
    expect(logSync.registrar).toHaveBeenCalledTimes(1);
    return logSync.registrar.mock.calls[0][0] as Record<string, unknown>;
  };

  it('conta sucesso, novidade e falha de cada processo, numa linha sem processo', async () => {
    const { logSync, varrer } = montar({
      ids: async () => ['a', 'b', 'c'],
      /*
        O ERRO GENÉRICO DEIXOU DE SER '429' (24/09/2026): desde a repescagem da
        cota, 429 quer dizer "tente de novo" e o processo volta no fim da
        rodada — este teste conta falhas, e passaria a contar zero. O que ele
        mede continua sendo a contagem; o 429 tem teste próprio abaixo.
      */
      ressincronizar: async (id) => {
        if (id === 'b') throw new Error('tribunal desconhecido');
        return { novas: id === 'a' ? 2 : 0 };
      },
    });
    await varrer();
    const l = linha(logSync);
    expect(l).toMatchObject({
      fonte: 'DATAJUD',
      origem: OrigemSincronizacao.CRON,
      processoId: null,
      numeroCNJ: null,
      sucesso: true,
      novasMovimentacoes: 2,
      mensagemErro:
        'Rodada concluída com 1 de 3 consulta(s) em falha; 2 processo(s) consultado(s), 1 com novidade (2 movimentação(ões) nova(s)).',
    });
    expect(typeof l.duracaoMs).toBe('number');
  });

  /**
   * A REPESCAGEM DA COTA — decidida medindo, em 24/09/2026.
   *
   * A varredura faz 1 a 2 chamadas por MINUTO contra uma cota de 20/min: não
   * somos nós que a estouramos. Os 9 erros 429 daquela manhã (contra ZERO nos
   * oito dias anteriores) vieram do IP compartilhado do Railway. 429 quer dizer
   * "tente daqui a pouco", e a rodada nunca tentava.
   */
  it('quem levou 429 volta no fim da rodada, e deixa de contar como falha', async () => {
    let tentativasDeB = 0;
    const { processos, logSync, varrer } = montar({
      ids: async () => ['a', 'b', 'c'],
      ressincronizar: async (id) => {
        if (id !== 'b') return { novas: 0 };
        tentativasDeB++;
        if (tentativasDeB === 1) throw new Error('O DATAJUD retornou HTTP 429.');
        return { novas: 1 };
      },
    });
    await varrer();
    expect(tentativasDeB).toBe(2);
    expect(processos.ressincronizarSilencioso).toHaveBeenCalledTimes(4);
    const l = linha(logSync);
    expect(l.sucesso).toBe(true);
    // Nenhuma falha sobra: o 'b' foi recuperado.
    expect(l.mensagemErro).toBe(
      'Rodada concluída: 3 processo(s) consultado(s), 1 com novidade (1 movimentação(ões) nova(s)).',
    );
  });

  /** Uma vez só: insistir com a cota estourada é virar parte do problema. */
  it('se o 429 insistir, tenta só mais uma vez e conta a falha', async () => {
    let tentativas = 0;
    const { processos, logSync, varrer } = montar({
      ids: async () => ['a'],
      ressincronizar: async () => { tentativas++; throw new Error('429'); },
    });
    await varrer();
    expect(tentativas).toBe(2);
    expect(processos.ressincronizarSilencioso).toHaveBeenCalledTimes(2);
    expect(linha(logSync).sucesso).toBe(false);
  });

  /** Timeout NÃO é cota: repetir não resolve, e a rodada não gasta chamada à toa. */
  it('timeout não entra na repescagem', async () => {
    let tentativas = 0;
    const { varrer } = montar({
      ids: async () => ['a'],
      ressincronizar: async () => { tentativas++; throw new Error('timeout of 45000ms exceeded'); },
    });
    await varrer();
    expect(tentativas).toBe(1);
  });

  it('a lista de elegíveis que quebra ainda grava a linha, como falha', async () => {
    const { logSync, varrer } = montar({ ids: async () => { throw new Error('banco fora'); } });
    await varrer();
    expect(linha(logSync)).toMatchObject({ sucesso: false, mensagemErro: expect.stringMatching(/^Rodada interrompida: banco fora/) });
  });

  /** O radar é leitura de conveniência: se falhar, a rodada não vira "interrompida". */
  it('um erro ao contar o radar de audiências não contamina a linha', async () => {
    const { logSync, varrer } = montar({
      ids: async () => ['a'],
      radar: async () => { throw new Error('timeout'); },
    });
    await expect(varrer()).resolves.toBeUndefined();
    expect(linha(logSync)).toMatchObject({ sucesso: true, mensagemErro: 'Rodada concluída: 1 processo(s) consultado(s), 0 com novidade (0 movimentação(ões) nova(s)).' });
  });
});

/**
 * AS ETAPAS FINAIS DO DJEN FALHAM SOZINHAS — e a rede de prazo roda primeiro.
 *
 * Rodavam em fila sem proteção: uma falha de topo em "ligar advogados" pulava
 * `cobrarEsquecidas`, a rede que transforma em tarefa a proposta com prazo que
 * ninguém respondeu (auditoria dos robôs, 13/09/2026).
 */
describe('as etapas finais da varredura do DJEN', () => {
  const montar = (quebra: Partial<Record<'correlacao' | 'advogados' | 'partes', Error>> = {}) => {
    const prisma = {
      user: {
        // Um advogado com OAB (a varredura tem alvo) e ninguém sem OAB. A lista
        // de "sem OAB" filtra na aplicação, então o mesmo advogado com OAB
        // válida não entra nela.
        findMany: jest.fn(async () => [
          { id: 'u1', nome: 'Morgana', nomeExibicao: null, oab: '9226', oabUf: 'PI', djenLidoAte: null },
        ]),
        update: jest.fn(async () => ({})),
      },
      processo: {
        findMany: jest.fn(async (args: { where: { comunicacoes?: { some?: { providencia?: null } } } }) => {
          const daCorrelacao = args.where.comunicacoes?.some && 'providencia' in args.where.comunicacoes.some;
          if (daCorrelacao && quebra.correlacao) throw quebra.correlacao;
          return [];
        }),
      },
      comunicacaoDjen: { findMany: jest.fn(async () => []) },
      sugestaoProcesso: { findMany: jest.fn(async () => []) },
    };
    const leitura = (rotulo: string) => ({ itens: [], paginas: 1, bateuNoTeto: false, interrompidaPor: null, rotulo });
    const djen = {
      janelaDias: 3,
      lerPorOab: jest.fn(async () => leitura('OAB PI 9226')),
      lerPorProcesso: jest.fn(async () => leitura('NPU 00008146120265220002')),
    };
    const logSync = { registrar: jest.fn(async (..._args: unknown[]) => undefined) };
    const caixa = { cobrarEsquecidas: jest.fn(async () => 0) };
    const vinculo = {
      aplicarNosProcessos: jest.fn(async () => {
        if (quebra.advogados) throw quebra.advogados;
      }),
    };
    const partes = {
      reconciliarTodos: jest.fn(async () => {
        if (quebra.partes) throw quebra.partes;
      }),
    };
    const svc = new DjenSyncService(
      prisma as never,
      { get: () => undefined } as never,
      djen as never,
      logSync as never,
      { aplicarAposDjen: jest.fn() } as never,
      {} as never,
      caixa as never,
      vinculo as never,
      partes as never,
    );
    return { svc, prisma, logSync, caixa, vinculo, partes };
  };

  it('a rede de prazo roda logo depois da correlação, antes das outras', async () => {
    const { svc, caixa, vinculo, partes } = montar();
    await svc.varrer();
    const [escalar] = caixa.cobrarEsquecidas.mock.invocationCallOrder;
    expect(escalar).toBeLessThan(vinculo.aplicarNosProcessos.mock.invocationCallOrder[0]);
    expect(escalar).toBeLessThan(partes.reconciliarTodos.mock.invocationCallOrder[0]);
  });

  it('correlação quebrada: a rede e as demais etapas rodam, e a falha vai para a linha', async () => {
    const { svc, prisma, logSync, caixa, vinculo, partes } = montar({ correlacao: new Error('banco instável') });
    const resumo = await svc.varrer();
    expect(caixa.cobrarEsquecidas).toHaveBeenCalledTimes(1);
    expect(vinculo.aplicarNosProcessos).toHaveBeenCalledTimes(1);
    expect(partes.reconciliarTodos).toHaveBeenCalledTimes(1);
    // conferência da fila + tarefa de cadastro
    expect(prisma.sugestaoProcesso.findMany).toHaveBeenCalledTimes(2);
    expect(resumo.etapasComFalha).toEqual(['correlação (banco instável)']);
    expect(logSync.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        fonte: 'DJEN',
        sucesso: false,
        mensagemErro:
          'Etapa(s) final(is) com falha, as outras rodaram: correlação (banco instável). ' +
          'Varredura concluída: 1 consulta(s), 0 publicação(ões) nova(s).',
      }),
    );
  });

  it('duas etapas quebradas aparecem as duas, na ordem em que rodaram', async () => {
    const { svc, caixa } = montar({ advogados: new Error('a'), partes: new Error('b') });
    const resumo = await svc.varrer();
    expect(caixa.cobrarEsquecidas).toHaveBeenCalled();
    expect(resumo.etapasComFalha).toEqual(['advogados do ato (a)', 'partes do ato (b)']);
  });

  it('sem falha em etapa, a linha continua como antes', async () => {
    const { svc, logSync } = montar();
    const resumo = await svc.varrer();
    expect(resumo.etapasComFalha).toEqual([]);
    expect(logSync.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ sucesso: true, mensagemErro: 'Varredura concluída: 1 consulta(s), 0 publicação(ões) nova(s).' }),
    );
  });

  /** Quebra ANTES das etapas finais continua propagando, com linha gravada. */
  it('quebra na ingestão ainda propaga e grava "interrompida"', async () => {
    const { svc, prisma, logSync, caixa } = montar();
    prisma.user.findMany.mockRejectedValueOnce(new Error('sem conexão'));
    await expect(svc.varrer()).rejects.toThrow('sem conexão');
    expect(caixa.cobrarEsquecidas).not.toHaveBeenCalled();
    expect(logSync.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ sucesso: false, mensagemErro: 'Varredura interrompida: sem conexão' }),
    );
  });
});
