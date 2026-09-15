import { Logger } from '@nestjs/common';
import { CaixaDePropostasService } from './caixa-de-propostas.service';
import { CorrelacaoService } from './correlacao.service';
import { DjenController } from './djen.controller';
import { DjenBloqueadoError, DjenService, type LeituraDjen } from './djen.service';
import { STATUS_VIVOS } from './utils/varredura.util';
import { DjenSyncService } from './djen-sync.service';

beforeAll(() => {
  for (const nivel of ['log', 'warn', 'error', 'debug'] as const) {
    jest.spyOn(Logger.prototype, nivel).mockImplementation(() => undefined);
  }
});
afterAll(() => jest.restoreAllMocks());
afterEach(() => jest.useRealTimers());

const NPU = '00008146120265220002';
const NPU_FORMATADO = '0000814-61.2026.5.22.0002';

/** Fixa o relógio sem congelar as promessas. */
function relogio(iso: string) {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  jest.setSystemTime(new Date(iso));
}

const leitura = (l: Partial<LeituraDjen> = {}): LeituraDjen => ({
  itens: [], paginas: 1, bateuNoTeto: false, interrompidaPor: null, rotulo: 'OAB PI 9226', ...l,
});

// ============================================================================
// 1) `paginar`: o teto e a falha no meio deixam de ser silenciosos
// ============================================================================

/**
 * `paginar` devolvia só a lista. Bater no teto era um `warn` no stdout, e uma
 * falha na segunda página jogava fora a primeira. Quem carimba "lido até hoje"
 * não tinha como saber que não era verdade.
 */
describe('a paginação diz se leu tudo', () => {
  const item = (n: number, dia = '2026-09-11') => ({
    hash: `h-${n}`,
    numero_processo: NPU_FORMATADO,
    texto: 'Intimação para ciência.',
    data_disponibilizacao: dia,
    siglaTribunal: 'TRT22',
  });
  const pagina = (quantos: number, inicio = 0) => Array.from({ length: quantos }, (_, i) => item(inicio + i));
  /*
    O CNJ manda `X-RateLimit-Remaining` em toda resposta que chega à API
    (medido em 14/09/2026, pela ponte). O falso imita isso; o que acontece SEM
    o cabeçalho está testado logo abaixo, com `Headers` de verdade.
  */
  const cabecalhos = { get: (nome: string) => (nome.toLowerCase() === 'x-ratelimit-remaining' ? '19' : null) };
  const ok = (items: unknown[]) => ({
    status: 200, ok: true, headers: cabecalhos, json: async () => ({ items }), text: async () => '',
  });
  const http500 = { status: 500, ok: false, headers: cabecalhos, json: async () => ({}), text: async () => 'sistema muito ocupado' };

  const fetchOriginal = global.fetch;
  let fetchFalso: jest.Mock;
  beforeEach(() => {
    fetchFalso = jest.fn();
    global.fetch = fetchFalso as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = fetchOriginal;
  });

  const servico = () =>
    new DjenService({
      get: (k: string) => ({ DJEN_REQ_POR_MINUTO: '1000', DJEN_BASE_URL: 'https://ponte.exemplo/api/v1' } as Record<string, string>)[k],
    } as never);

  it('três páginas cheias com teto de 3: bateu no teto, e os 300 itens voltam', async () => {
    fetchFalso
      .mockResolvedValueOnce(ok(pagina(100, 0)))
      .mockResolvedValueOnce(ok(pagina(100, 100)))
      .mockResolvedValueOnce(ok(pagina(100, 200)));
    const r = await servico().lerPorProcesso(NPU, { de: '2026-09-10', ate: '2026-09-14' });
    expect(r).toMatchObject({ paginas: 3, bateuNoTeto: true, interrompidaPor: null, rotulo: `NPU ${NPU}` });
    expect(r.itens).toHaveLength(300);
    expect(fetchFalso).toHaveBeenCalledTimes(3);
  });

  it('a última página veio pela metade: leu tudo, sem teto', async () => {
    fetchFalso.mockResolvedValueOnce(ok(pagina(100))).mockResolvedValueOnce(ok(pagina(40, 100)));
    const r = await servico().lerPorProcesso(NPU, { maxPaginas: 10 });
    expect(r).toMatchObject({ paginas: 2, bateuNoTeto: false, interrompidaPor: null });
    expect(r.itens).toHaveLength(140);
  });

  it('a segunda página falhou: a primeira NÃO se perde, e a leitura vem marcada', async () => {
    fetchFalso.mockResolvedValueOnce(ok(pagina(100))).mockResolvedValueOnce(http500);
    const r = await servico().lerPorProcesso(NPU, { maxPaginas: 10 });
    expect(r.itens).toHaveLength(100);
    expect(r.paginas).toBe(1);
    expect(r.bateuNoTeto).toBe(false);
    expect(r.interrompidaPor).toBe('O DJEN retornou HTTP 500. Tente novamente em instantes.');
  });

  it('a primeira página falhou: o erro sobe como sempre (o botão continua recebendo a mensagem)', async () => {
    fetchFalso.mockResolvedValueOnce(http500);
    await expect(servico().lerPorProcesso(NPU)).rejects.toThrow('O DJEN retornou HTTP 500');
  });

  /** O CNJ respeita a data junto com o número (medido pela ponte em 13/09/2026). */
  it('com janela manda as datas; o histórico vai sem data nenhuma', async () => {
    fetchFalso.mockResolvedValue(ok([]));
    const s = servico();
    await s.lerPorProcesso(NPU, { de: '2026-09-10', ate: '2026-09-14' });
    await s.lerPorProcesso(NPU, { maxPaginas: 10 });
    const [janela, historico] = fetchFalso.mock.calls.map((c) => new URL(c[0] as string).searchParams);
    expect(janela.get('dataDisponibilizacaoInicio')).toBe('2026-09-10');
    expect(janela.get('dataDisponibilizacaoFim')).toBe('2026-09-14');
    expect(historico.has('dataDisponibilizacaoInicio')).toBe(false);
    expect(historico.get('numeroProcesso')).toBe(NPU);
  });

  it('a OAB vai com os dias de Teresina recebidos, e dia mal formado é recusado antes de sair', async () => {
    fetchFalso.mockResolvedValue(ok([]));
    const s = servico();
    const r = await s.lerPorOab('9226', 'pi', '2026-09-03', '2026-09-14');
    expect(r.rotulo).toBe('OAB PI 9226');
    const params = new URL(fetchFalso.mock.calls[0][0] as string).searchParams;
    expect(params.get('dataDisponibilizacaoInicio')).toBe('2026-09-03');
    await expect(s.lerPorOab('9226', 'PI', '14/09/2026', '2026-09-14')).rejects.toThrow('AAAA-MM-DD');
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  /*
    SEM CABEÇALHO NÃO É SALDO ZERO (14/09/2026). `Headers.get` devolve null, e
    `Number(null)` é 0: o 403 do CDN caía no ramo da cota (um minuto de espera
    por tentativa, disjuntor nunca aberto) e o 200 sem cabeçalho fazia dormir
    antes de cada chamada. Aqui com `Headers` reais, sem cabeçalho nenhum.
  */
  const semCabecalho = (status: number, items: unknown[] = []) => ({
    status, ok: status < 400, headers: new Headers(), json: async () => ({ items }), text: async () => '<html>403</html>',
  });

  it('403 sem cabeçalho três vezes: bloqueio de origem, o disjuntor abre e a quarta nem sai', async () => {
    fetchFalso.mockResolvedValue(semCabecalho(403));
    const s = servico();
    for (let i = 0; i < 3; i++) {
      await expect(s.lerPorProcesso(NPU)).rejects.toBeInstanceOf(DjenBloqueadoError);
    }
    expect(s.bloqueadoNaOrigem).toBe(true);
    await expect(s.lerPorProcesso(NPU)).rejects.toBeInstanceOf(DjenBloqueadoError);
    expect(fetchFalso).toHaveBeenCalledTimes(3);
  });

  it('200 sem cabeçalho: a chamada seguinte sai na hora (o botão não recebe "cota esgotada")', async () => {
    fetchFalso.mockResolvedValue(semCabecalho(200));
    const s = servico();
    await expect(s.lerPorProcesso(NPU, { esperarCota: false })).resolves.toMatchObject({ itens: [] });
    await expect(s.lerPorProcesso(NPU, { esperarCota: false })).resolves.toMatchObject({ itens: [] });
    expect(fetchFalso).toHaveBeenCalledTimes(2);
  });
});

// ============================================================================
// 2) A varredura com banco falso: carimbos, "sem OAB", histórico e botão
// ============================================================================

interface UsuarioFalso {
  id: string;
  nome: string;
  nomeExibicao: string | null;
  role: string;
  ativo: boolean;
  oab: string | null;
  oabUf: string | null;
  djenLidoAte: Date | null;
  /** Processos de que a pessoa é a principal, para o falso avaliar o `where` de verdade. */
  principalDe?: { statusInterno: string; instanciaViva: boolean }[];
}

/** Avalia o filtro de `processo` que `advogadosSemOab` manda ao banco. */
function processoCasa(p: { statusInterno: string; instanciaViva: boolean }, w: Record<string, any>): boolean {
  if (w.OR) return (w.OR as Record<string, any>[]).some((x) => processoCasa(p, x));
  const s = w.statusInterno;
  if (s !== undefined && !(typeof s === 'string' ? s === p.statusInterno : (s.in as string[]).includes(p.statusInterno))) {
    return false;
  }
  if (w.instancias) {
    if (w.instancias.some?.baixada !== false) throw new Error('filtro de instância não simulado');
    if (!p.instanciaViva) return false;
  }
  return true;
}
interface ProcessoFalso {
  id: string;
  numeroCNJ: string | null;
  createdAt: Date;
  ultimaConsultaDjen: Date | null;
  djenHistoricoLidoEm: Date | null;
}

const MORGANA: UsuarioFalso = {
  id: 'u-morgana', nome: 'Morgana Sousa', nomeExibicao: 'Morgana', role: 'ADVOGADO', ativo: true,
  oab: '9226', oabUf: 'PI', djenLidoAte: null,
};

function montar(opcoes: {
  usuarios?: UsuarioFalso[];
  processos?: ProcessoFalso[];
  config?: Record<string, string>;
  lerPorOab?: jest.Mock;
  lerPorProcesso?: jest.Mock;
}) {
  const usuarios = opcoes.usuarios ?? [MORGANA];
  const processos = opcoes.processos ?? [];
  const prisma = {
    user: {
      findMany: jest.fn(async (args: { where: Record<string, unknown> }) => {
        const w = args.where;
        if ('oab' in w) return usuarios.filter((u) => u.ativo && u.oab !== null && u.oabUf !== null);
        if ('OR' in w) {
          const doProcesso = (w.OR as Record<string, any>[]).find((x) => x.processosEquipe)!.processosEquipe.some;
          return usuarios.filter(
            (u) =>
              u.ativo &&
              (u.role === 'ADVOGADO' ||
                (doProcesso.principal === true && (u.principalDe ?? []).some((p) => processoCasa(p, doProcesso.processo)))),
          );
        }
        return [];
      }),
      update: jest.fn(async () => ({})),
    },
    processo: {
      findMany: jest.fn(async (args: { where: Record<string, any>; take?: number }) => {
        const w = args.where;
        if ('djenHistoricoLidoEm' in w) {
          return processos
            .filter((p) => p.numeroCNJ && p.djenHistoricoLidoEm === null)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            .slice(0, args.take);
        }
        if ('OR' in w) {
          const fora: string[] = w.id?.notIn ?? [];
          return processos.filter((p) => p.numeroCNJ && !fora.includes(p.id)).slice(0, args.take);
        }
        return [];
      }),
      findUnique: jest.fn(async (args: { where: { id: string } }) => processos.find((p) => p.id === args.where.id) ?? null),
      update: jest.fn(async () => ({})),
    },
    comunicacaoDjen: { findMany: jest.fn(async () => []) },
    sugestaoProcesso: { findMany: jest.fn(async () => []) },
  };
  const djen = {
    janelaDias: 3,
    lerPorOab: opcoes.lerPorOab ?? jest.fn(async () => leitura()),
    lerPorProcesso: opcoes.lerPorProcesso ?? jest.fn(async () => leitura({ rotulo: `NPU ${NPU}` })),
  };
  const logSync = { registrar: jest.fn(async (..._a: unknown[]) => undefined) };
  const correlacao = { aplicarAposDjen: jest.fn(async () => ({ criadas: 0, enriquecidas: 0 })) };
  const vinculo = { aplicarNosProcessos: jest.fn(async () => undefined), aplicarNoProcesso: jest.fn(async () => undefined) };
  const svc = new DjenSyncService(
    prisma as never,
    { get: (k: string) => opcoes.config?.[k] } as never,
    djen as never,
    logSync as never,
    correlacao as never,
    {} as never,
    { escalarEsquecidas: jest.fn(async () => 0) } as never,
    vinculo as never,
    { reconciliarTodos: jest.fn(async () => undefined) } as never,
  );
  const linha = () => logSync.registrar.mock.calls.at(-1)?.[0] as { sucesso: boolean; mensagemErro: string };
  return { svc, prisma, djen, logSync, correlacao, vinculo, linha };
}

describe('a OAB carimba até que dia foi lida', () => {
  it('lida até 04/09: relê de 03/09 a 14/09 e, lida inteira, carimba 14/09', async () => {
    relogio('2026-09-14T08:00:00Z');
    const { svc, djen, prisma } = montar({ usuarios: [{ ...MORGANA, djenLidoAte: new Date(Date.UTC(2026, 8, 4)) }] });
    await svc.varrer();
    expect(djen.lerPorOab).toHaveBeenCalledWith('9226', 'PI', '2026-09-03', '2026-09-14');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u-morgana' },
      data: { djenLidoAte: new Date('2026-09-14T00:00:00.000Z') },
    });
  });

  /** 22:30 de Teresina já é dia 15 em UTC: o carimbo é do dia daqui. */
  it('pedida às 22:30 de Teresina, o dia é o de Teresina', async () => {
    relogio('2026-09-15T01:30:00Z');
    const { svc, djen, prisma } = montar({});
    await svc.varrer();
    expect(djen.lerPorOab).toHaveBeenCalledWith('9226', 'PI', '2026-09-11', '2026-09-14');
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { djenLidoAte: new Date('2026-09-14T00:00:00.000Z') } }),
    );
  });

  it('bateu no teto: não carimba, e a frase vai na FRENTE da linha de resumo', async () => {
    relogio('2026-09-14T08:00:00Z');
    const { svc, prisma, linha } = montar({
      lerPorOab: jest.fn(async () => leitura({ bateuNoTeto: true, paginas: 20, itens: [] })),
    });
    const resumo = await svc.varrer();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(resumo.consultasNoTeto).toEqual(['OAB PI 9226']);
    expect(linha()).toMatchObject({
      sucesso: true,
      mensagemErro:
        'Teto de páginas atingido em OAB PI 9226: pode haver publicação não lida, e a data de leitura desta consulta não avançou. ' +
        'Varredura concluída: 1 consulta(s), 0 publicação(ões) nova(s).',
    });
  });

  it('falhou na segunda página: não carimba e conta como falha', async () => {
    relogio('2026-09-14T08:00:00Z');
    const { svc, prisma, linha } = montar({
      processos: [{ id: 'p1', numeroCNJ: NPU, createdAt: new Date('2026-08-01T12:00:00Z'), ultimaConsultaDjen: new Date('2026-09-13T08:05:00Z'), djenHistoricoLidoEm: new Date('2026-09-05T08:00:00Z') }],
      lerPorOab: jest.fn(async () => leitura({ interrompidaPor: 'O DJEN retornou HTTP 500. Tente novamente em instantes.' })),
    });
    const resumo = await svc.varrer();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(resumo.falhas).toBe(1);
    expect(linha().mensagemErro).toBe('Varredura concluída com 1 de 2 consulta(s) em falha.');
  });

  it('erro na primeira página: nada lido, nada carimbado', async () => {
    relogio('2026-09-14T08:00:00Z');
    const { svc, prisma } = montar({ lerPorOab: jest.fn(async () => { throw new Error('timeout'); }) });
    const resumo = await svc.varrer();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(resumo.falhas).toBe(1);
  });
});

describe('quem o robô não enxerga', () => {
  const LARA: UsuarioFalso = {
    id: 'u-lara', nome: 'Lara Cortez', nomeExibicao: null, role: 'ADVOGADO', ativo: true, oab: '', oabUf: 'PI', djenLidoAte: null,
  };
  /** Perfil de coordenação, mas é a principal de um processo vivo. */
  const SHERAD: UsuarioFalso = {
    id: 'u-sherad', nome: 'Shérad Lima', nomeExibicao: 'Shérad', role: 'COORDENACAO', ativo: true, oab: null, oabUf: null, djenLidoAte: null,
    principalDe: [{ statusInterno: STATUS_VIVOS[0], instanciaViva: true }],
  };

  /*
    ENCERRADO COM INSTÂNCIA VIVA É VIVO (14/09/2026): o cumprimento de sentença
    corre no 1º grau e o robô consulta o processo toda noite. A principal só de
    um processo assim ficava fora da lista de sem OAB.
  */
  it('a principal só de um encerrado com instância viva entra; a de um encerrado baixado, não', async () => {
    const CUMPRIMENTO: UsuarioFalso = {
      id: 'u-ana', nome: 'Ana Coordenadora', nomeExibicao: null, role: 'COORDENACAO', ativo: true, oab: null, oabUf: null, djenLidoAte: null,
      principalDe: [{ statusInterno: 'ENCERRADO', instanciaViva: true }],
    };
    const BAIXADO: UsuarioFalso = {
      id: 'u-bia', nome: 'Bia Coordenadora', nomeExibicao: null, role: 'COORDENACAO', ativo: true, oab: null, oabUf: null, djenLidoAte: null,
      principalDe: [{ statusInterno: 'ENCERRADO', instanciaViva: false }],
    };
    const { svc } = montar({ usuarios: [MORGANA, CUMPRIMENTO, BAIXADO] });
    await expect(svc.advogadosSemOab()).resolves.toEqual([{ id: 'u-ana', nome: 'Ana Coordenadora', falta: 'OAB' }]);
  });

  /** "Sem OAB no cadastro" para quem tem o número e esqueceu a UF mandava conferir o que estava lá (15/09/2026). */
  it('número sem UF: aparece com `falta: UF`, e não vai à consulta', async () => {
    relogio('2026-09-14T08:00:00Z');
    const CARLOS: UsuarioFalso = {
      id: 'u-carlos', nome: 'Carlos Henrique Silva', nomeExibicao: 'Carlos Henrique', role: 'ADVOGADO', ativo: true,
      oab: '13.217', oabUf: '', djenLidoAte: null,
    };
    const { svc, djen } = montar({ usuarios: [MORGANA, CARLOS] });
    await expect(svc.advogadosSemOab()).resolves.toEqual([{ id: 'u-carlos', nome: 'Carlos Henrique', falta: 'UF' }]);
    await svc.varrer();
    expect(djen.lerPorOab).toHaveBeenCalledTimes(1);
  });

  it('OAB vazia não vai à consulta (não vira falha) e aparece como sem OAB; a principal de outro perfil também', async () => {
    relogio('2026-09-14T08:00:00Z');
    const { svc, djen } = montar({ usuarios: [MORGANA, LARA, SHERAD] });
    const resumo = await svc.varrer();
    expect(djen.lerPorOab).toHaveBeenCalledTimes(1);
    expect(resumo.falhas).toBe(0);
    expect(resumo.advogadosSemOab).toBe(2);
    await expect(svc.advogadosSemOab()).resolves.toEqual([
      { id: 'u-lara', nome: 'Lara Cortez', falta: 'OAB' },
      { id: 'u-sherad', nome: 'Shérad', falta: 'OAB' },
    ]);
  });

  /** A frase só aparecia na rodada com ZERO falhas: bastava uma para ela sumir. */
  it('a frase ATENÇÃO vai na frente mesmo quando a rodada teve falha', async () => {
    relogio('2026-09-14T08:00:00Z');
    const { svc, linha } = montar({
      usuarios: [MORGANA, LARA],
      lerPorOab: jest.fn(async () => { throw new Error('timeout'); }),
    });
    await svc.varrer();
    expect(linha()).toMatchObject({
      sucesso: false,
      mensagemErro:
        'ATENÇÃO: 1 advogado(s) sem OAB não foram consultados. Varredura sem resposta: as 1 consulta(s) falharam.',
    });
  });

  /*
    O CORTE DE 500 DO LOG (14/09/2026). Seis etapas com erro longo do Prisma e o
    teto em cinco processos: o ATENÇÃO vinha por último e caía fora do corte.
    Chama a montagem da linha direto, com o resumo de uma noite assim.
  */
  it('noite com seis etapas quebradas e teto em cinco: o ATENÇÃO sobrevive ao corte de 500', async () => {
    const { svc, linha } = montar({});
    const erroDoPrisma = 'Invalid `prisma.comunicacaoDjen.findMany()` invocation: Can\'t reach database server at `db:5432`. '.padEnd(120, 'x');
    const resumo = {
      advogadosConsultados: 1, processosConsultados: 5, recebidas: 0, ingeridas: 0, descartadas: 0, sugeridas: 0,
      advogadosSemOab: 1, falhas: 0, maiorRecebidaPorConsulta: 0, historicosLidos: 0,
      consultasNoTeto: Array.from({ length: 5 }, (_, i) => `processo 000081${i}-61.2026.5.22.0002`),
      etapasComFalha: ['correlação', 'propostas esquecidas', 'advogados do ato', 'partes do ato', 'conferência da fila no CNJ', 'tarefa de cadastro']
        .map((nome) => `${nome} (${erroDoPrisma})`),
    };
    await (svc as unknown as { registrarResumo: (...a: unknown[]) => Promise<void> }).registrarResumo(resumo, 'CRON', Date.now(), null);
    const gravada = linha().mensagemErro;
    expect(gravada.slice(0, 500)).toMatch(/^ATENÇÃO: 1 advogado\(s\) sem OAB não foram consultados\. Teto de páginas atingido em /);
    // As etapas continuam contadas, só que sem estourar a linha.
    expect(gravada).toContain('Etapa(s) final(is) com falha, as outras rodaram: correlação (');
    expect(gravada).toMatch(/ e mais [1-5]\. /);
  });

  it('GET /djen/status devolve a lista e conta só quem é consultável', async () => {
    const { svc } = montar({ usuarios: [MORGANA, LARA, SHERAD] });
    const ctrl = new DjenController(
      { comunicacaoDjen: { count: async () => 1433 } } as never,
      { integracaoAtiva: true, bloqueadoNaOrigem: false, janelaDias: 3 } as never,
      svc,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(ctrl.status()).resolves.toEqual({
      ativo: true,
      bloqueadoNaOrigem: false,
      janelaDias: 3,
      publicacoes: 1433,
      advogadosComOab: 1,
      advogadosSemOab: [
        { id: 'u-lara', nome: 'Lara Cortez', falta: 'OAB' },
        { id: 'u-sherad', nome: 'Shérad', falta: 'OAB' },
      ],
    });
  });

  /*
    A MAIOR LEITURA E A RODADA PARADA POR TEMPO NA LINHA DE RESUMO (15/09/2026).
    `maiorRecebidaPorConsulta` era calculado e ninguém lia; a parada por tempo é
    processo não lido, e vai na frente, logo depois do ATENÇÃO.
  */
  it('a linha diz a maior leitura e, na frente, quantos processos ficaram por tempo', async () => {
    const { svc, linha } = montar({});
    const base = {
      advogadosConsultados: 8, processosConsultados: 1, recebidas: 60, ingeridas: 12, descartadas: 48, sugeridas: 0,
      advogadosSemOab: 1, falhas: 0, maiorRecebidaPorConsulta: 37, historicosLidos: 0, processosParadosPorTempo: 0,
      consultasNoTeto: [] as string[], etapasComFalha: [] as string[],
    };
    const registrar = (r: typeof base) =>
      (svc as unknown as { registrarResumo: (...a: unknown[]) => Promise<void> }).registrarResumo(r, 'CRON', Date.now(), null);

    await registrar(base);
    expect(linha().mensagemErro).toBe(
      'ATENÇÃO: 1 advogado(s) sem OAB não foram consultados. ' +
        'Varredura concluída: 9 consulta(s), 12 publicação(ões) nova(s), maior leitura: 37 itens.',
    );

    await registrar({ ...base, falhas: 1, processosParadosPorTempo: 42 });
    expect(linha().mensagemErro).toBe(
      'ATENÇÃO: 1 advogado(s) sem OAB não foram consultados. ' +
        'Rodada parada por tempo: 42 processos ficaram para a próxima noite. ' +
        'Varredura concluída com 1 de 10 consulta(s) em falha, maior leitura: 37 itens.',
    );
  });

  /** No SINDSERM não há Diário: nenhuma linha âmbar sobre o que não existe. */
  it('com o Diário desligado, a lista vem vazia e ninguém é consultado', async () => {
    const { svc, prisma } = montar({ usuarios: [LARA] });
    const ctrl = new DjenController(
      {} as never,
      { integracaoAtiva: false, bloqueadoNaOrigem: false, janelaDias: 3 } as never,
      svc,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(ctrl.status()).resolves.toMatchObject({ ativo: false, advogadosComOab: 0, advogadosSemOab: [] });
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});

describe('o histórico pelo número, uma vez por processo', () => {
  const recente: ProcessoFalso = { id: 'p-recente', numeroCNJ: NPU, createdAt: new Date('2026-09-12T15:00:00Z'), ultimaConsultaDjen: null, djenHistoricoLidoEm: null };
  const semHistoricoMaisVelho: ProcessoFalso = { id: 'p-velho', numeroCNJ: '00001000262022522000'.padEnd(20, '2'), createdAt: new Date('2026-09-05T15:00:00Z'), ultimaConsultaDjen: new Date('2026-09-13T08:05:00Z'), djenHistoricoLidoEm: null };
  const jaLido: ProcessoFalso = { id: 'p-lido', numeroCNJ: '00009785920225220004', createdAt: new Date('2026-08-01T15:00:00Z'), ultimaConsultaDjen: new Date('2026-09-10T08:05:00Z'), djenHistoricoLidoEm: new Date('2026-09-04T08:30:00Z') };

  it('sem variável: 200 por noite, 10 páginas, sem filtro de data', async () => {
    relogio('2026-09-14T08:00:00Z');
    const { svc, prisma, djen } = montar({ processos: [recente] });
    await svc.varrer();
    const chamadaDoHistorico = prisma.processo.findMany.mock.calls.find((c) => 'djenHistoricoLidoEm' in c[0].where)!;
    expect(chamadaDoHistorico[0]).toMatchObject({ take: 200, orderBy: { createdAt: 'desc' } });
    expect(djen.lerPorProcesso).toHaveBeenCalledWith(NPU, { esperarCota: true, maxPaginas: 10 });
  });

  /*
    NENHUMA CHAMADA DOBRADA (14/09/2026). Com 200 por noite quase todo processo
    vivo lê o histórico na primeira noite; quem leu não pode voltar a ser
    consultado pela janela na mesma rodada, ou a primeira noite gasta o dobro.
  */
  it('com o padrão: cada processo é consultado uma vez só na noite', async () => {
    relogio('2026-09-14T08:00:00Z');
    const { svc, djen } = montar({ processos: [semHistoricoMaisVelho, recente, jaLido] });
    await svc.varrer();
    expect(djen.lerPorProcesso.mock.calls).toEqual([
      [NPU, { esperarCota: true, maxPaginas: 10 }],
      [semHistoricoMaisVelho.numeroCNJ, { esperarCota: true, maxPaginas: 10 }],
      ['00009785920225220004', { esperarCota: true, maxPaginas: 3, de: '2026-09-07', ate: '2026-09-14' }],
    ]);
  });

  /*
    O HISTÓRICO QUE FALHA NÃO TIRA O PROCESSO DA JANELA (14/09/2026). O id era
    anotado como "lido" antes da consulta: com timeout na consulta sem data, o
    processo passava a noite sem histórico e sem janela.
  */
  it('histórico com erro na primeira página: o processo ainda lê a janela na mesma noite', async () => {
    relogio('2026-09-14T08:00:00Z');
    const { svc, djen, prisma } = montar({
      processos: [recente],
      lerPorProcesso: jest.fn(async (_npu: string, o: { de?: string }) => {
        if (!o.de) throw new Error('O DJEN não respondeu em 30s. Tente de novo em instantes.');
        return leitura({ rotulo: `NPU ${NPU}` });
      }),
    });
    const resumo = await svc.varrer();
    expect(djen.lerPorProcesso.mock.calls).toEqual([
      [NPU, { esperarCota: true, maxPaginas: 10 }],
      [NPU, { esperarCota: true, maxPaginas: 3, de: '2026-09-11', ate: '2026-09-14' }],
    ]);
    expect(prisma.processo.update).toHaveBeenCalledWith({
      where: { id: 'p-recente' },
      data: { ultimaConsultaDjen: new Date('2026-09-14T08:00:00Z') },
    });
    expect(resumo.falhas).toBe(1);
    expect(resumo.historicosLidos).toBe(0);
  });

  it('com teto de 1 por rodada: o mais recente lê o histórico; os outros leem a janela desde a última consulta', async () => {
    relogio('2026-09-14T08:00:00Z');
    const { svc, prisma, djen } = montar({
      processos: [semHistoricoMaisVelho, recente, jaLido],
      config: { DJEN_HISTORICO_POR_RODADA: '1', DJEN_HISTORICO_MAX_PAGINAS: '4' },
    });
    const resumo = await svc.varrer();

    expect(djen.lerPorProcesso.mock.calls).toEqual([
      [NPU, { esperarCota: true, maxPaginas: 4 }],
      [semHistoricoMaisVelho.numeroCNJ, { esperarCota: true, maxPaginas: 3, de: '2026-09-10', ate: '2026-09-14' }],
      ['00009785920225220004', { esperarCota: true, maxPaginas: 3, de: '2026-09-07', ate: '2026-09-14' }],
    ]);
    const agora = new Date('2026-09-14T08:00:00Z');
    expect(prisma.processo.update.mock.calls).toEqual([
      [{ where: { id: 'p-recente' }, data: { ultimaConsultaDjen: agora, djenHistoricoLidoEm: agora } }],
      [{ where: { id: 'p-velho' }, data: { ultimaConsultaDjen: agora } }],
      [{ where: { id: 'p-lido' }, data: { ultimaConsultaDjen: agora } }],
    ]);
    expect(resumo.historicosLidos).toBe(1);
    expect(resumo.processosConsultados).toBe(3);
  });

  /**
   * A TRAVA DE 30 DIAS SAIU. Ela tirava da consulta por número todo processo com
   * publicação gravada no último mês — e a primeira publicação achada escondia
   * as seguintes por 30 dias.
   */
  it('a seleção por número não olha mais "sem publicação recente"', async () => {
    relogio('2026-09-14T08:00:00Z');
    const { svc, prisma } = montar({ processos: [jaLido] });
    await svc.varrer();
    const chamada = prisma.processo.findMany.mock.calls.find((c) => 'OR' in c[0].where && !('djenHistoricoLidoEm' in c[0].where))!;
    expect(chamada[0].where).not.toHaveProperty('comunicacoes');
    expect(chamada[0]).toMatchObject({ take: 300, orderBy: { ultimaConsultaDjen: { sort: 'asc', nulls: 'first' } } });
  });

  it('histórico no teto de páginas: a consulta carimba, o histórico NÃO', async () => {
    relogio('2026-09-14T08:00:00Z');
    const { svc, prisma, linha } = montar({
      processos: [recente],
      lerPorProcesso: jest.fn(async () => leitura({ rotulo: `NPU ${NPU}`, paginas: 10, bateuNoTeto: true })),
    });
    const resumo = await svc.varrer();
    expect(prisma.processo.update).toHaveBeenCalledWith({
      where: { id: 'p-recente' },
      data: { ultimaConsultaDjen: new Date('2026-09-14T08:00:00Z') },
    });
    expect(resumo.historicosLidos).toBe(0);
    expect(linha().mensagemErro).toMatch(
      /^Teto de páginas atingido em processo 0000814-61\.2026\.5\.22\.0002: pode haver publicação não lida/,
    );
  });

  it('histórico com falha no meio: nenhum carimbo', async () => {
    relogio('2026-09-14T08:00:00Z');
    const { svc, prisma } = montar({
      processos: [recente],
      lerPorProcesso: jest.fn(async () => leitura({ rotulo: `NPU ${NPU}`, interrompidaPor: 'timeout' })),
    });
    await svc.varrer();
    expect(prisma.processo.update).not.toHaveBeenCalled();
  });

  /*
    O ORÇAMENTO DE TEMPO (15/09/2026). Cada consulta "leva" 80 minutos no relógio
    falso: a terceira já começaria depois dos 150, e a rodada para ali. Quem
    ficou não ganha carimbo nenhum (o histórico continua nulo e entra primeiro na
    noite seguinte), é contado uma vez só mesmo estando nas duas listas, e a
    frase vai na frente da linha de resumo.
  */
  it('passou de 150 minutos: para antes da próxima consulta, sem carimbo, e diz quantos ficaram', async () => {
    relogio('2026-09-15T08:00:00Z');
    const proc = (id: string, npu: string, criadoEm: string): ProcessoFalso => ({
      id, numeroCNJ: npu, createdAt: new Date(criadoEm), ultimaConsultaDjen: null, djenHistoricoLidoEm: null,
    });
    const processos = [
      proc('p-a', '00000010120265220001', '2026-09-01T12:00:00Z'),
      proc('p-b', '00000020220265220002', '2026-09-05T12:00:00Z'),
      proc('p-c', '00000030320265220003', '2026-09-10T12:00:00Z'),
    ];
    const { svc, djen, prisma, linha } = montar({ usuarios: [], processos });
    const oitentaMinutos = async () => {
      jest.setSystemTime(Date.now() + 80 * 60_000);
    };

    const resumo = await svc.varrer(oitentaMinutos);

    expect(djen.lerPorProcesso.mock.calls.map((c) => c[0])).toEqual(['00000030320265220003', '00000020220265220002']);
    const carimbados = (prisma.processo.update.mock.calls as unknown as [{ where: { id: string } }][]).map((c) => c[0].where.id);
    expect(carimbados).toEqual(['p-c', 'p-b']);
    expect(resumo.processosParadosPorTempo).toBe(1);
    expect(linha().mensagemErro).toBe(
      'Rodada parada por tempo: 1 processo ficou para a próxima noite. ' +
        'Varredura concluída: 2 consulta(s), 0 publicação(ões) nova(s), 2 histórico(s) lido(s) pelo número.',
    );
  });

  it('noite normal, bem abaixo do orçamento: ninguém fica para trás e a frase não aparece', async () => {
    relogio('2026-09-15T08:00:00Z');
    const { svc, linha } = montar({ processos: [recente, jaLido] });
    const resumo = await svc.varrer(async () => { jest.setSystemTime(Date.now() + 5_000); });
    expect(resumo.processosParadosPorTempo).toBe(0);
    expect(linha().mensagemErro).not.toMatch(/parada por tempo/);
  });

  it('zero no ambiente desliga a colheita, e o número continua toda noite', async () => {
    relogio('2026-09-14T08:00:00Z');
    const { svc, prisma, djen } = montar({ processos: [recente], config: { DJEN_HISTORICO_POR_RODADA: '0' } });
    await svc.varrer();
    const chamadaDoHistorico = prisma.processo.findMany.mock.calls.find((c) => 'djenHistoricoLidoEm' in c[0].where)!;
    expect(chamadaDoHistorico[0].take).toBe(0);
    expect(djen.lerPorProcesso).toHaveBeenCalledWith(NPU, { esperarCota: true, maxPaginas: 3, de: '2026-09-11', ate: '2026-09-14' });
  });
});

describe('o botão Sincronizar da ficha', () => {
  it('sem histórico lido: lê o histórico, carimba os dois e rotula o que é antigo na hora', async () => {
    relogio('2026-09-14T13:00:00Z');
    const proc: ProcessoFalso = { id: 'p1', numeroCNJ: NPU, createdAt: new Date('2026-09-12T15:00:00Z'), ultimaConsultaDjen: null, djenHistoricoLidoEm: null };
    const { svc, prisma, djen, correlacao, vinculo } = montar({ processos: [proc] });
    await expect(svc.sincronizarProcesso('p1')).resolves.toEqual({
      ingeridas: 0, recebidas: 0, historico: true, bateuNoTeto: false, interrompida: false,
    });
    expect(djen.lerPorProcesso).toHaveBeenCalledWith(NPU, { esperarCota: false, maxPaginas: 10 });
    const agora = new Date('2026-09-14T13:00:00Z');
    expect(prisma.processo.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { ultimaConsultaDjen: agora, djenHistoricoLidoEm: agora },
    });
    expect(correlacao.aplicarAposDjen).toHaveBeenCalledWith('p1');
    expect(prisma.comunicacaoDjen.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ processoId: 'p1', providencia: null }) }),
    );
    expect(vinculo.aplicarNoProcesso).toHaveBeenCalledWith('p1');
  });

  it('com histórico lido: lê só a janela desde a última consulta', async () => {
    relogio('2026-09-14T13:00:00Z');
    const proc: ProcessoFalso = { id: 'p1', numeroCNJ: NPU, createdAt: new Date('2026-08-01T15:00:00Z'), ultimaConsultaDjen: new Date('2026-09-13T08:05:00Z'), djenHistoricoLidoEm: new Date('2026-09-05T08:00:00Z') };
    const { svc, djen } = montar({ processos: [proc] });
    await expect(svc.sincronizarProcesso('p1')).resolves.toMatchObject({ historico: false });
    expect(djen.lerPorProcesso).toHaveBeenCalledWith(NPU, { esperarCota: false, maxPaginas: 3, de: '2026-09-10', ate: '2026-09-14' });
  });
});

// ============================================================================
// 3) A GARANTIA: ato do histórico com mais de 30 dias NUNCA vira tarefa nem proposta
// ============================================================================

/**
 * A colheita de histórico traz atos de meses atrás para dentro da mesma
 * ingestão e da mesma correlação que criam trabalho. A decisão D3 da rodada 3
 * é que o que tem mais de 30 dias vira FORA_DA_JANELA e nunca tarefa nem
 * proposta. Aqui isso roda com a `CorrelacaoService` e a
 * `CaixaDePropostasService` DE VERDADE, sobre um banco em memória que recusa
 * operador que não conhece (teste que passa por não filtrar nada é o pior).
 *
 * O controle: o MESMO texto, num ato de três dias atrás, vira proposta e,
 * quatro dias depois sem resposta, tarefa. Se o de 3 dias não virasse nada,
 * o teste dos antigos estaria passando no vazio.
 */
describe('o histórico antigo nunca vira trabalho', () => {
  const REPLICA =
    'PODER JUDICIÁRIO DO ESTADO DO PIAUÍ ATO ORDINATÓRIO Intimo a parte autora a ' +
    'apresentar réplica no prazo de 15 dias. CONTESTAÇÃO TEMPESTIVA';

  type Linha = Record<string, any>;

  function bancoEmMemoria() {
    const comunicacoes: Linha[] = [];
    const compromissos: Linha[] = [];
    const processo: Linha = {
      id: 'proc-1', numeroCNJ: NPU, advogadoId: 'u-morgana', filiadoId: null, statusInterno: 'ATIVO',
      createdAt: new Date('2026-08-20T12:00:00Z'), ultimaConsultaDjen: null, djenHistoricoLidoEm: null,
      ultimoMovimentoEm: null, partes: [], instancias: [],
    };

    const igual = (a: unknown, b: unknown) =>
      a instanceof Date || b instanceof Date ? new Date(a as Date).getTime() === new Date(b as Date).getTime() : a === b;

    const casa = (linha: Linha, where: Linha = {}): boolean =>
      Object.entries(where).every(([campo, cond]) => {
        if (campo === 'OR') return (cond as Linha[]).some((w) => casa(linha, w));
        if (campo === 'compromisso') {
          const c = compromissos.find((x) => x.id === linha.compromissoId);
          return !!c && casa(c, cond);
        }
        const v = linha[campo];
        if (cond === null) return v == null;
        if (cond instanceof Date || typeof cond !== 'object') return igual(v, cond);
        return Object.entries(cond as Linha).every(([op, alvo]) => {
          switch (op) {
            case 'not': return alvo === null ? v != null : !igual(v, alvo);
            case 'gte': return v != null && v >= alvo;
            case 'lt': return v != null && v < alvo;
            case 'in': return (alvo as unknown[]).some((a) => igual(v, a));
            case 'notIn': return !(alvo as unknown[]).some((a) => igual(v, a));
            default: throw new Error(`operador não simulado: ${campo}.${op}`);
          }
        });
      });

    let seq = 0;
    const prisma = {
      comunicacaoDjen: {
        createMany: jest.fn(async ({ data }: { data: Linha[] }) => {
          let count = 0;
          for (const d of data) {
            if (comunicacoes.some((c) => c.hash === d.hash)) continue;
            comunicacoes.push({
              id: `pub-${++seq}`, createdAt: new Date(), providencia: null, prazoMencionadoDias: null,
              compromissoId: null, movimentacaoId: null, tarefaPropostaEm: null, tarefaPropostaPara: null,
              tarefaDispensadaEm: null, tarefaDispensadaMotivo: null, ...d,
            });
            count++;
          }
          return { count };
        }),
        findMany: jest.fn(async ({ where, take }: { where: Linha; take?: number }) =>
          comunicacoes.filter((c) => casa(c, where)).slice(0, take ?? Infinity)),
        findFirst: jest.fn(async ({ where }: { where: Linha }) => comunicacoes.find((c) => casa(c, where)) ?? null),
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) => comunicacoes.find((c) => c.id === where.id) ?? null),
        update: jest.fn(async ({ where, data }: { where: { id: string }; data: Linha }) =>
          Object.assign(comunicacoes.find((c) => c.id === where.id)!, data)),
        aggregate: jest.fn(async ({ where }: { where: Linha }) => {
          const datas = comunicacoes.filter((c) => casa(c, where)).map((c) => c.createdAt.getTime());
          return { _min: { createdAt: datas.length ? new Date(Math.min(...datas)) : null } };
        }),
      },
      processo: {
        findMany: jest.fn(async ({ where }: { where: Linha }) => {
          if (where.numeroCNJ?.in) return where.numeroCNJ.in.includes(NPU) ? [processo] : [];
          if ('djenHistoricoLidoEm' in where) return processo.djenHistoricoLidoEm === null ? [processo] : [];
          if (where.comunicacoes?.some && Object.keys(where.comunicacoes.some).length) {
            return comunicacoes.some((c) => c.processoId === processo.id && casa(c, where.comunicacoes.some)) ? [processo] : [];
          }
          if (where.comunicacoes) return [];
          if ('OR' in where) return (where.id?.notIn ?? []).includes(processo.id) ? [] : [processo];
          throw new Error('consulta de processo não simulada');
        }),
        findUnique: jest.fn(async () => processo),
        update: jest.fn(async ({ data }: { data: Linha }) => Object.assign(processo, data)),
        updateMany: jest.fn(async ({ where, data }: { where: Linha; data: Linha }) => {
          if (casa(processo, { ...where, id: undefined === where.id ? processo.id : where.id })) Object.assign(processo, data);
          return { count: 1 };
        }),
      },
      movimentacaoProcessual: { findMany: jest.fn(async () => []), update: jest.fn() },
      compromisso: {
        create: jest.fn(async ({ data }: { data: Linha }) => {
          const c = { id: `comp-${compromissos.length + 1}`, ...data };
          compromissos.push(c);
          return { id: c.id };
        }),
        update: jest.fn(async ({ where, data }: { where: { id: string }; data: Linha }) =>
          Object.assign(compromissos.find((c) => c.id === where.id)!, data)),
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) => compromissos.find((c) => c.id === where.id) ?? null),
      },
      user: {
        findFirst: jest.fn(async ({ where }: { where: Linha }) =>
          where.id === 'u-morgana' || where.role === 'ADMINISTRADOR' ? { id: 'u-morgana' } : null),
        findUnique: jest.fn(async () => ({ id: 'u-morgana', nome: 'Morgana Sousa', nomeExibicao: 'Morgana' })),
        findMany: jest.fn(async ({ where }: { where: Linha }) => ('oab' in where ? [{ ...MORGANA }] : [])),
        update: jest.fn(async () => ({})),
      },
      sugestaoProcesso: { findMany: jest.fn(async () => []) },
    };

    // O processo já era vigiado: uma publicação dele entrou em 01/09.
    comunicacoes.push({
      id: 'pub-0', hash: 'h-vigiado', processoId: 'proc-1', numeroProcesso: NPU, texto: 'Pauta.',
      dataDisponibilizacao: new Date('2026-09-01T00:00:00Z'), createdAt: new Date('2026-09-01T09:00:00Z'),
      providencia: 'NENHUMA', prazoMencionadoDias: null, compromissoId: null, movimentacaoId: null,
      tarefaPropostaEm: null, tarefaPropostaPara: null, tarefaDispensadaEm: null, tarefaDispensadaMotivo: null,
    });
    return { prisma, comunicacoes, compromissos, processo };
  }

  const ato = (hash: string, dia: string) => ({
    hash, numeroProcesso: NPU, siglaTribunal: 'TJPI', tipoComunicacao: 'Intimação', tipoDocumento: null,
    nomeOrgao: 'Vara Única de Simões', nomeClasse: 'Procedimento Comum', meio: 'D', link: `https://pje/${hash}`,
    texto: REPLICA, dataDisponibilizacao: dia, destinatarios: [], advogados: [],
  });
  /** 56 dias, 31 dias (o dia seguinte ao corte) e 3 dias antes de 14/09/2026. */
  const HISTORICO = [ato('h-56-dias', '2026-07-20'), ato('h-31-dias', '2026-08-14'), ato('h-3-dias', '2026-09-11')];

  function montarDeVerdade(itensNaOrigem: ReturnType<typeof ato>[] = HISTORICO) {
    const banco = bancoEmMemoria();
    // O que o CNJ tem publicado: o teste pode acrescentar um ato entre uma noite e outra.
    const origem = [...itensNaOrigem];
    const djen = {
      janelaDias: 3,
      lerPorOab: jest.fn(async () => leitura()),
      // Sem data é o histórico: vem tudo. Com data é a janela: vem o que cabe nela.
      lerPorProcesso: jest.fn(async (_npu: string, o: { de?: string }) =>
        leitura({ rotulo: `NPU ${NPU}`, itens: o.de ? origem.filter((a) => a.dataDisponibilizacao >= o.de!) : [...origem] } as never)),
    };
    const correlacao = new CorrelacaoService(banco.prisma as never);
    const caixa = new CaixaDePropostasService(banco.prisma as never, correlacao);
    const svc = new DjenSyncService(
      banco.prisma as never,
      { get: () => undefined } as never,
      djen as never,
      { registrar: jest.fn(async () => undefined) } as never,
      correlacao,
      {} as never,
      caixa,
      { aplicarNosProcessos: jest.fn(async () => undefined), aplicarNoProcesso: jest.fn(async () => undefined) } as never,
      { reconciliarTodos: jest.fn(async () => undefined) } as never,
    );
    const pub = (hash: string) => banco.comunicacoes.find((c) => c.hash === hash)!;
    return { ...banco, svc, caixa, pub, origem };
  }

  const nuncaVirouTrabalho = (linha: Linha) => {
    expect({
      hash: linha.hash,
      providencia: linha.providencia,
      tarefaDispensadaMotivo: linha.tarefaDispensadaMotivo,
      tarefaPropostaEm: linha.tarefaPropostaEm,
      compromissoId: linha.compromissoId,
    }).toEqual({
      hash: linha.hash,
      providencia: 'ELABORAR_MANIFESTACAO',
      tarefaDispensadaMotivo: 'FORA_DA_JANELA',
      tarefaPropostaEm: null,
      compromissoId: null,
    });
  };

  it('na rodada da noite: os de 56 e 31 dias só ganham rótulo; o de 3 dias vira proposta', async () => {
    relogio('2026-09-14T08:00:00Z');
    const { svc, pub, processo, compromissos } = montarDeVerdade();
    const resumo = await svc.varrer();

    expect(resumo.historicosLidos).toBe(1);
    expect(processo.djenHistoricoLidoEm).toEqual(new Date('2026-09-14T08:00:00Z'));
    nuncaVirouTrabalho(pub('h-56-dias'));
    nuncaVirouTrabalho(pub('h-31-dias'));

    // O controle: o mesmo texto, dentro da janela, vira trabalho.
    const recente = pub('h-3-dias');
    expect(recente.providencia).toBe('ELABORAR_MANIFESTACAO');
    expect(recente.prazoMencionadoDias).toBe(15);
    expect(recente.tarefaPropostaEm ?? recente.compromissoId).not.toBeNull();
    expect(recente.tarefaDispensadaMotivo).toBeNull();
    expect(compromissos.length).toBe(recente.compromissoId ? 1 : 0);
  });

  it('quatro dias depois, sem ninguém responder: a rede escala a de 3 dias e continua sem tocar nas antigas', async () => {
    relogio('2026-09-14T08:00:00Z');
    const { svc, caixa, pub, compromissos } = montarDeVerdade();
    await svc.varrer();

    relogio('2026-09-18T08:00:00Z');
    await svc.varrer();
    await caixa.escalarEsquecidas();

    nuncaVirouTrabalho(pub('h-56-dias'));
    nuncaVirouTrabalho(pub('h-31-dias'));
    expect(pub('h-3-dias').compromissoId).not.toBeNull();
    // Uma tarefa só existe, e é a do ato recente.
    expect(compromissos).toHaveLength(1);
    expect(compromissos[0].processoId).toBe('proc-1');
  });

  it('pelo botão da ficha: o histórico antigo ganha o rótulo na hora, sem esperar a noite', async () => {
    relogio('2026-09-14T13:00:00Z');
    const { svc, pub, processo } = montarDeVerdade();
    await expect(svc.sincronizarProcesso('proc-1')).resolves.toMatchObject({ historico: true, recebidas: 3, ingeridas: 3 });

    expect(processo.djenHistoricoLidoEm).toEqual(new Date('2026-09-14T13:00:00Z'));
    nuncaVirouTrabalho(pub('h-56-dias'));
    nuncaVirouTrabalho(pub('h-31-dias'));
    expect(pub('h-3-dias').tarefaPropostaEm ?? pub('h-3-dias').compromissoId).not.toBeNull();
  });

  // ==========================================================================
  // As cópias do mesmo ato: uma comunicação por destinatário, o mesmo link
  // ==========================================================================

  /*
    O DJEN manda o MESMO ato uma vez para cada destinatário, com hash próprio e
    o mesmo link (14/09/2026). A consulta por número toda noite e o histórico
    passaram a trazer a cópia da outra parte, e ela virava uma segunda proposta,
    reabria a recusa ou criava outra tarefa depois da concluída.
  */
  const LINK_DO_ATO = 'https://comunica.pje.jus.br/consulta/certidao/ato-11-09';
  const copia = (hash: string) => ({ ...ato(hash, '2026-09-11'), link: LINK_DO_ATO });
  const COPIA_AUTOR = copia('h-copia-reclamante');
  const COPIA_REU = copia('h-copia-reclamada');
  const abertas = (caixa: CaixaDePropostasService) => caixa.listar('u-morgana', true);

  it('as duas cópias na mesma noite: uma proposta só e, esquecida, uma tarefa só', async () => {
    relogio('2026-09-14T08:00:00Z');
    const { svc, caixa, pub, compromissos } = montarDeVerdade([COPIA_AUTOR, COPIA_REU]);
    await svc.varrer();

    expect(pub('h-copia-reclamante').tarefaPropostaEm).not.toBeNull();
    expect(pub('h-copia-reclamada')).toMatchObject({ tarefaPropostaEm: null, tarefaDispensadaMotivo: 'COPIA_DO_MESMO_ATO' });
    expect(await abertas(caixa)).toHaveLength(1);

    relogio('2026-09-18T08:00:00Z');
    await svc.varrer();
    await caixa.escalarEsquecidas();
    expect(compromissos).toHaveLength(1);
  });

  it('a recusa fica: a cópia que chega depois não vira proposta de novo', async () => {
    relogio('2026-09-14T08:00:00Z');
    const { svc, caixa, pub, compromissos, origem } = montarDeVerdade([COPIA_AUTOR]);
    await svc.varrer();
    await caixa.recusar(pub('h-copia-reclamante').id, 'u-morgana', 'a ordem é da reclamada');

    relogio('2026-09-15T08:00:00Z');
    origem.push(COPIA_REU);
    await svc.varrer();

    expect(pub('h-copia-reclamada')).toMatchObject({
      tarefaPropostaEm: null,
      compromissoId: null,
      tarefaDispensadaMotivo: 'COPIA_DO_MESMO_ATO',
    });
    expect(await abertas(caixa)).toHaveLength(0);

    relogio('2026-09-19T08:00:00Z');
    await caixa.escalarEsquecidas();
    expect(compromissos).toHaveLength(0);
  });

  it('a tarefa concluída fica: a cópia que chega depois se liga a ela, sem tarefa nova', async () => {
    relogio('2026-09-14T08:00:00Z');
    const { svc, caixa, pub, compromissos, origem } = montarDeVerdade([COPIA_AUTOR]);
    await svc.varrer();
    const { compromissoId } = await caixa.aceitar(pub('h-copia-reclamante').id, 'u-morgana');
    compromissos.find((c) => c.id === compromissoId)!.status = 'CONCLUIDO';

    relogio('2026-09-15T08:00:00Z');
    origem.push(COPIA_REU);
    await svc.varrer();

    expect(pub('h-copia-reclamada')).toMatchObject({ compromissoId, tarefaPropostaEm: null });
    relogio('2026-09-19T08:00:00Z');
    await caixa.escalarEsquecidas();
    expect(compromissos).toHaveLength(1);
    expect(await abertas(caixa)).toHaveLength(0);
  });

  /*
    O PAR QUE JÁ ESTAVA NA CAIXA. A correlação não cria mais o par, mas a rede
    também não pode escalar duas cópias em duas tarefas, nem escalar por cima de
    uma recusa.
  */
  it('a rede: duas cópias esquecidas viram uma tarefa; a cópia de um ato recusado não vira nenhuma', async () => {
    relogio('2026-09-14T08:00:00Z');
    const { caixa, comunicacoes, compromissos } = montarDeVerdade([]);
    const proposta = (id: string, link: string, extra: Record<string, unknown> = {}) => ({
      id, hash: id, processoId: 'proc-1', numeroProcesso: NPU, texto: REPLICA, link, nomeOrgao: 'Vara Única de Simões',
      dataDisponibilizacao: new Date('2026-09-09T00:00:00Z'), createdAt: new Date('2026-09-09T09:00:00Z'),
      providencia: 'ELABORAR_MANIFESTACAO', prazoMencionadoDias: 15, compromissoId: null, movimentacaoId: null,
      tarefaPropostaEm: new Date('2026-09-09T09:00:00Z'), tarefaPropostaPara: 'u-morgana',
      tarefaDispensadaEm: null, tarefaDispensadaMotivo: null, ...extra,
    });
    comunicacoes.push(
      proposta('esq-1', 'https://pje/ato-a'),
      proposta('esq-2', 'https://pje/ato-a'),
      proposta('rec-1', 'https://pje/ato-b', { tarefaDispensadaEm: new Date('2026-09-10T12:00:00Z'), tarefaDispensadaMotivo: 'RECUSADA_PELO_ADVOGADO' }),
      proposta('rec-2', 'https://pje/ato-b'),
    );

    await expect(caixa.escalarEsquecidas()).resolves.toBe(1);
    expect(compromissos).toHaveLength(1);
    const porId = (id: string) => comunicacoes.find((c) => c.id === id)!;
    expect(porId('esq-2').compromissoId).toBe(porId('esq-1').compromissoId);
    expect(porId('rec-2')).toMatchObject({ compromissoId: null, tarefaDispensadaMotivo: 'COPIA_DO_MESMO_ATO' });
  });
});
