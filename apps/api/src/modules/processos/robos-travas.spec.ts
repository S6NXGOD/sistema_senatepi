import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConflictException, Logger } from '@nestjs/common';
import { OrigemSincronizacao } from '@prisma/client';
import {
  JOB_DATAJUD_REAVALIAR,
  JOB_DATAJUD_SYNC,
  JOB_DJEN_SYNC,
  JOB_SICONFI_SYNC,
  comTravaDeJob,
} from '@core/infra';
import { DjenController, VARREDURA_DO_DIARIO_OCUPADA } from './djen.controller';
import { DjenCronService, RODADA_DJEN_PULADA } from './djen-cron.service';
import { ProcessosCronService } from './processos-cron.service';
import { ProcessosService } from './processos.service';
import {
  BUSCA_NO_TESOURO_OCUPADA,
  MunicipiosController,
} from '../municipios/municipios.controller';

/**
 * UM ROBÔ DE CADA VEZ — as rotas manuais, a tela e as rodadas puladas.
 *
 * Auditoria dos robôs (13/09/2026): a varredura manual do DJEN rodava sem a
 * trava que o cron respeita, e duas varreduras simultâneas criavam duas
 * "Cadastrar ação do Diário" para a mesma ação (a primeira ficava órfã). A tela
 * de Processos tomava a trava da noturna e podia fazer o DataJud pular a noite.
 * E rodada pulada era um warn no stdout, sem linha no banco.
 */

/**
 * `travas_job` EM MEMÓRIA, com a mesma regra da consulta de verdade: a tomada
 * só devolve linha se ninguém detém o nome (a de outro dono, vigente, barra o
 * `DO UPDATE`), e a devolução só apaga a linha do próprio dono.
 */
function bancoDasTravas(vigentes: string[] = []) {
  const travas = new Map<string, string>(vigentes.map((n) => [n, 'outra-instancia']));
  const consultas: string[] = [];
  const texto = (partes: TemplateStringsArray) => partes.join('?');
  return {
    travas,
    consultas,
    $queryRaw: jest.fn(async (partes: TemplateStringsArray, ...valores: unknown[]) => {
      const sql = texto(partes);
      if (sql.includes('INSERT INTO travas_job')) {
        const [nome, dono] = valores as string[];
        consultas.push(`tomar:${nome}`);
        if (travas.has(nome)) return [];
        travas.set(nome, dono);
        return [{ dono_id: dono }];
      }
      if (sql.includes('SELECT 1')) {
        consultas.push(`vigente?:${String(valores[0])}`);
        return travas.has(valores[0] as string) ? [{ vigente: 1 }] : [];
      }
      throw new Error(`Consulta inesperada: ${sql}`);
    }),
    $executeRaw: jest.fn(async (partes: TemplateStringsArray, ...valores: unknown[]) => {
      const [nome, dono] = valores as string[];
      if (texto(partes).includes('DELETE FROM travas_job') && travas.get(nome) === dono) {
        travas.delete(nome);
        consultas.push(`soltar:${nome}`);
      }
      return 1;
    }),
  };
}

const logger = new Logger('teste-das-travas');

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
});
afterAll(() => jest.restoreAllMocks());

describe('a trava do job', () => {
  it('livre: roda, devolve o resultado e solta a trava no fim', async () => {
    const banco = bancoDasTravas();
    const r = await comTravaDeJob(banco as never, JOB_DJEN_SYNC, logger, { ttlMinutos: 180 }, async () => 42);
    expect(r).toEqual({ executou: true, resultado: 42 });
    expect(banco.travas.size).toBe(0);
  });

  it('ocupada: não roda a tarefa e não solta a trava de quem a detém', async () => {
    const banco = bancoDasTravas([JOB_DJEN_SYNC]);
    const tarefa = jest.fn(async () => 1);
    const r = await comTravaDeJob(banco as never, JOB_DJEN_SYNC, logger, { ttlMinutos: 180 }, tarefa);
    expect(r).toEqual({ executou: false });
    expect(tarefa).not.toHaveBeenCalled();
    expect(banco.travas.get(JOB_DJEN_SYNC)).toBe('outra-instancia');
  });

  it('a tarefa que quebra propaga o erro e solta a trava', async () => {
    const banco = bancoDasTravas();
    await expect(
      comTravaDeJob(banco as never, JOB_DJEN_SYNC, logger, { ttlMinutos: 180 }, async () => {
        throw new Error('banco fora');
      }),
    ).rejects.toThrow('banco fora');
    expect(banco.travas.size).toBe(0);
  });

  it('cedeA vigente: desiste antes de tentar tomar a própria trava', async () => {
    const banco = bancoDasTravas([JOB_DATAJUD_SYNC]);
    const tarefa = jest.fn(async () => 1);
    const r = await comTravaDeJob(
      banco as never, JOB_DATAJUD_REAVALIAR, logger, { ttlMinutos: 10, cedeA: JOB_DATAJUD_SYNC }, tarefa,
    );
    expect(r).toEqual({ executou: false });
    expect(tarefa).not.toHaveBeenCalled();
    expect(banco.consultas).toEqual([`vigente?:${JOB_DATAJUD_SYNC}`]);
  });

  it('cedeA livre: roda com o PRÓPRIO nome', async () => {
    const banco = bancoDasTravas();
    const r = await comTravaDeJob(
      banco as never, JOB_DATAJUD_REAVALIAR, logger, { ttlMinutos: 10, cedeA: JOB_DATAJUD_SYNC }, async () => 'ok',
    );
    expect(r).toEqual({ executou: true, resultado: 'ok' });
    expect(banco.consultas).toEqual([
      `vigente?:${JOB_DATAJUD_SYNC}`,
      `tomar:${JOB_DATAJUD_REAVALIAR}`,
      `soltar:${JOB_DATAJUD_REAVALIAR}`,
    ]);
  });

  /** Sem `cedeA`, a tomada é a mesma de sempre: nenhuma leitura a mais. */
  it('sem cedeA, não consulta vigência de ninguém', async () => {
    const banco = bancoDasTravas();
    await comTravaDeJob(banco as never, JOB_DATAJUD_SYNC, logger, { ttlMinutos: 180 }, async () => 0);
    expect(banco.consultas).toEqual([`tomar:${JOB_DATAJUD_SYNC}`, `soltar:${JOB_DATAJUD_SYNC}`]);
  });

  /** A prioridade é de mão única: a noturna nunca espera pela tela. */
  it('a noturna roda mesmo com a releitura da tela em andamento', async () => {
    const banco = bancoDasTravas([JOB_DATAJUD_REAVALIAR]);
    const r = await comTravaDeJob(banco as never, JOB_DATAJUD_SYNC, logger, { ttlMinutos: 180 }, async () => 'noite');
    expect(r).toEqual({ executou: true, resultado: 'noite' });
  });
});

describe('a varredura manual do DJEN respeita a trava do robô', () => {
  const montar = (vigentes: string[] = []) => {
    const banco = bancoDasTravas(vigentes);
    const sync = { varrer: jest.fn(async (..._args: unknown[]) => ({ ingeridas: 3 })) };
    const ctrl = new DjenController(banco as never, {} as never, sync as never, {} as never, {} as never, {} as never);
    return { banco, sync, ctrl };
  };

  it('com a rodada das 05:00 correndo, responde 409 com a frase e não varre', async () => {
    const { sync, ctrl } = montar([JOB_DJEN_SYNC]);
    const erro = await ctrl.varrer({ dias: 90 }).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ConflictException);
    expect((erro as ConflictException).getStatus()).toBe(409);
    expect((erro as ConflictException).message).toBe(VARREDURA_DO_DIARIO_OCUPADA);
    expect(sync.varrer).not.toHaveBeenCalled();
  });

  it('livre: varre como MANUAL, com a janela pedida, e solta a trava', async () => {
    const { banco, sync, ctrl } = montar();
    await expect(ctrl.varrer({ dias: 90 })).resolves.toEqual({ ingeridas: 3 });
    expect(sync.varrer).toHaveBeenCalledWith(undefined, OrigemSincronizacao.MANUAL, 90);
    expect(banco.consultas[0]).toBe(`tomar:${JOB_DJEN_SYNC}`);
    expect(banco.travas.size).toBe(0);
  });

  /** O caso da auditoria: dois cliques (ou clique + cron) não viram duas varreduras. */
  it('o segundo pedido, durante a primeira varredura, ouve 409', async () => {
    const { sync, ctrl } = montar();
    let segundo: unknown;
    sync.varrer.mockImplementationOnce(async () => {
      segundo = await ctrl.varrer({}).catch((e: unknown) => e);
      return { ingeridas: 0 };
    });
    await ctrl.varrer({});
    expect(segundo).toBeInstanceOf(ConflictException);
    expect(sync.varrer).toHaveBeenCalledTimes(1);
  });
});

describe('a busca manual no Tesouro respeita a trava da rotina', () => {
  const montar = (vigentes: string[] = []) => {
    const banco = bancoDasTravas(vigentes);
    const siconfi = { sincronizar: jest.fn(async (..._args: unknown[]) => ({ municipios: 1 })) };
    const ctrl = new MunicipiosController(
      {} as never, siconfi as never, {} as never, {} as never, {} as never, banco as never,
    );
    return { banco, siconfi, ctrl };
  };

  it('com a rotina correndo, responde 409 e não consulta o Tesouro', async () => {
    const { siconfi, ctrl } = montar([JOB_SICONFI_SYNC]);
    const erro = await ctrl.sincronizar({ codigos: [2211001] } as never).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ConflictException);
    expect((erro as ConflictException).message).toBe(BUSCA_NO_TESOURO_OCUPADA);
    expect(siconfi.sincronizar).not.toHaveBeenCalled();
  });

  it('livre: busca como MANUAL os códigos pedidos', async () => {
    const { banco, siconfi, ctrl } = montar();
    await expect(ctrl.sincronizar({ codigos: [2211001] } as never)).resolves.toEqual({ municipios: 1 });
    expect(siconfi.sincronizar).toHaveBeenCalledWith(OrigemSincronizacao.MANUAL, [2211001]);
    expect(banco.consultas[0]).toBe(`tomar:${JOB_SICONFI_SYNC}`);
    expect(banco.travas.size).toBe(0);
  });
});

describe('a releitura de instâncias da tela cede à noturna', () => {
  type Retorno = { reavaliados: number; restantes: number; executou: boolean; realinhados: unknown[] };
  const varrerInstancias = (ProcessosService.prototype as unknown as {
    varrerInstancias: (this: unknown, limite: number) => Promise<Retorno>;
  }).varrerInstancias;

  const montar = (vigentes: string[]) => {
    const banco = {
      ...bancoDasTravas(vigentes),
      processo: {
        findMany: jest.fn(async () => [{ id: 'p1' }]),
        count: jest.fn(async () => 0),
      },
    };
    const self = {
      prisma: banco,
      logger,
      datajud: { multiInstanciaAtiva: true },
      reconciliarStatus: jest.fn(async () => []),
      ressincronizarSilencioso: jest.fn(async () => ({ novas: 0 })),
    };
    return { banco, self };
  };

  it('com a noturna vigente, desiste sem reler e devolve a fila inteira como restante', async () => {
    const { self } = montar([JOB_DATAJUD_SYNC]);
    await expect(varrerInstancias.call(self, 10)).resolves.toEqual({
      reavaliados: 0, restantes: 1, executou: false, realinhados: [],
    });
    expect(self.ressincronizarSilencioso).not.toHaveBeenCalled();
  });

  it('livre, relê com a trava própria — nunca com a da noturna', async () => {
    const { banco, self } = montar([]);
    const r = await varrerInstancias.call(self, 10);
    expect(r.executou).toBe(true);
    expect(r.reavaliados).toBe(1);
    expect(banco.consultas).toContain(`tomar:${JOB_DATAJUD_REAVALIAR}`);
    expect(banco.consultas).not.toContain(`tomar:${JOB_DATAJUD_SYNC}`);
  });

  /** Travado no código do cron: a noturna não pergunta pela tela. */
  it('o cron da noturna toma a própria trava sem ceder a ninguém', () => {
    const codigo = readFileSync(join(__dirname, 'processos-cron.service.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(codigo).toContain('JOB_DATAJUD_SYNC,');
    expect(codigo).not.toContain('cedeA');
  });
});

describe('a rodada pulada deixa linha no log', () => {
  const INTEGRACAO = process.env.DATAJUD_INTEGRACAO;
  beforeEach(() => {
    process.env.DATAJUD_INTEGRACAO = 'true';
  });
  afterEach(() => {
    if (INTEGRACAO === undefined) delete process.env.DATAJUD_INTEGRACAO;
    else process.env.DATAJUD_INTEGRACAO = INTEGRACAO;
  });

  const montarDatajud = (vigentes: string[]) => {
    const banco = {
      ...bancoDasTravas(vigentes),
      logSincronizacaoDatajud: { deleteMany: jest.fn(async () => ({ count: 0 })) },
    };
    const processos = { idsParaSincronizar: jest.fn(async () => [] as string[]) };
    const audiencias = { contarPendentes: jest.fn(async () => 0) };
    const logSync = { registrar: jest.fn(async (..._args: unknown[]) => undefined) };
    const cron = new ProcessosCronService(banco as never, processos as never, audiencias as never, logSync as never);
    return { banco, processos, logSync, cron };
  };

  it('DataJud com a trava ocupada: uma linha "pulada", sem processo, e a poda continua', async () => {
    const { banco, processos, logSync, cron } = montarDatajud([JOB_DATAJUD_SYNC]);
    await cron.sincronizarAtivos();
    expect(processos.idsParaSincronizar).not.toHaveBeenCalled();
    expect(logSync.registrar).toHaveBeenCalledTimes(1);
    expect(logSync.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        fonte: 'DATAJUD',
        origem: OrigemSincronizacao.CRON,
        processoId: null,
        numeroCNJ: null,
        sucesso: true,
        mensagemErro: expect.stringMatching(/^Rodada pulada:/),
      }),
    );
    expect(banco.logSincronizacaoDatajud.deleteMany).toHaveBeenCalled();
  });

  it('DataJud livre e sem processo elegível: a linha diz "sem alvo" — não é silêncio', async () => {
    const { banco, logSync, cron } = montarDatajud([]);
    await cron.sincronizarAtivos();
    expect(logSync.registrar).toHaveBeenCalledTimes(1);
    expect(logSync.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        processoId: null,
        numeroCNJ: null,
        sucesso: true,
        mensagemErro: 'Rodada sem alvo: nenhum processo elegível para consulta.',
      }),
    );
    expect(banco.travas.size).toBe(0);
  });

  const montarDjen = (vigentes: string[]) => {
    const banco = bancoDasTravas(vigentes);
    const sync = { varrer: jest.fn(async (..._args: unknown[]) => ({})) };
    const logSync = { registrar: jest.fn(async (..._args: unknown[]) => undefined) };
    const cron = new DjenCronService(
      banco as never, { integracaoAtiva: true } as never, sync as never, logSync as never,
    );
    return { sync, logSync, cron };
  };

  it('DJEN com uma varredura manual correndo: linha "pulada", e não varre', async () => {
    const { sync, logSync, cron } = montarDjen([JOB_DJEN_SYNC]);
    await cron.sincronizarPublicacoes();
    expect(sync.varrer).not.toHaveBeenCalled();
    expect(logSync.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ fonte: 'DJEN', origem: OrigemSincronizacao.CRON, sucesso: true, mensagemErro: RODADA_DJEN_PULADA }),
    );
  });

  /** A varredura que roda grava o próprio resumo; o cron não duplica a linha. */
  it('DJEN livre: varre e o cron não grava linha extra', async () => {
    const { sync, logSync, cron } = montarDjen([]);
    await cron.sincronizarPublicacoes();
    expect(sync.varrer).toHaveBeenCalledTimes(1);
    expect(logSync.registrar).not.toHaveBeenCalled();
  });
});
