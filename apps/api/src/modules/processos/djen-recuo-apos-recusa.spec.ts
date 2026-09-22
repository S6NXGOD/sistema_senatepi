import { Logger } from '@nestjs/common';

import { DjenService } from './djen.service';

/**
 * O RECUO DEPOIS DE UMA RECUSA — 22/09/2026.
 *
 * Este arquivo existe por causa de uma noite perdida. Com a ponte de volta no
 * ar, a varredura registrou **159 de 165 consultas em falha, em seis segundos**.
 * Seis segundos para 165 chamadas não é rede lenta: é o retry queimando as três
 * tentativas dentro do mesmo bloco de recusa.
 *
 * MEDIDO CONTRA A PONTE, no ritmo exato do cron (14/min):
 *
 *   direto do CNJ, do Brasil ...... 12 de 12 respondem
 *   pela ponte, antes ............. 8 de 16, em blocos de ~4 recusas
 *   pela ponte, com o recuo ....... 13 de 14 (93%), 4 tentativas gastas
 *
 * E o saldo devolvido pelo CNJ nunca desceu de 18 em nenhum dos casos — não era
 * cota. Era o CDN recusando rajada vinda de IP de datacenter.
 *
 * SÃO TRÊS COISAS DIFERENTES POR TRÁS DO MESMO 403, e o serviço tem de separar
 * as três. A pista é o par (cabeçalho de saldo, houve 200 há pouco):
 *
 *   saldo no cabeçalho ............ o CNJ contou: espera a JANELA virar
 *   sem saldo, com 200 recente .... o CDN recusou rajada: RECUO CRESCENTE
 *   sem saldo, sem 200 nenhum ..... bloqueio de origem: DISJUNTOR, sem insistir
 *
 * Confundir a primeira com a terceira custou 159 consultas; confundir a segunda
 * com a primeira fez o retry esperar 1 segundo. Este spec trava as três.
 */

type Cabecalhos = Record<string, string>;

const ITEM = {
  hash: 'h',
  texto: 'ato',
  numero_processo: '00013103620165220101',
  data_disponibilizacao: '2026-09-21',
};

/** Uma resposta do CNJ, com ou sem os cabeçalhos de cota. */
function resposta(status: number, cabecalhos: Cabecalhos = {}, itens = 0) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (n: string) => cabecalhos[n.toLowerCase()] ?? null },
    json: async () => ({
      items: Array.from({ length: itens }, (_, i) => ({ ...ITEM, hash: `h${i}` })),
    }),
    text: async () => '',
  } as unknown as Response;
}

/**
 * A PÁGINA CHEIA É O QUE FAZ HAVER SEGUNDA CHAMADA. O serviço para de paginar
 * quando a página vem com menos de 100 itens — sem isto, a leitura termina na
 * primeira resposta e nenhum retry é exercitado.
 */
const PAGINA_CHEIA = () => resposta(200, { 'x-ratelimit-remaining': '18' }, 100);
/** 403 nu: é assim que o CDN recusa — sem nenhum `X-RateLimit-*`. */
const RECUSA_DO_CDN = () => resposta(403, { 'x-amz-cf-pop': 'GRU1' });
const PAGINA_CURTA = () => resposta(200, { 'x-ratelimit-remaining': '17' }, 1);

const CONFIG = {
  get: (chave: string) =>
    (
      {
        DJEN_BASE_URL: 'http://ponte.local/api/v1',
        DJEN_INTEGRACAO: 'on',
      } as Record<string, string>
    )[chave],
} as never;

describe('o recuo depois de uma recusa do DJEN', () => {
  let esperas: number[];
  let avisos: string[];
  let erros: string[];
  let chamadas: number;
  let fetchOriginal: typeof globalThis.fetch;

  /** Responde na ordem da lista; a última resposta se repete daí em diante. */
  function oCnjResponde(...sequencia: Array<() => Response>) {
    globalThis.fetch = jest.fn(async () => {
      const passo = sequencia[chamadas] ?? sequencia[sequencia.length - 1];
      chamadas++;
      return passo();
    }) as never;
  }

  /** Dispara a leitura e adianta o relógio até ela terminar. */
  async function lerAdiantandoORelogio() {
    const fim = new DjenService(CONFIG).lerPorOab('9226', 'PI', '2026-09-20', '2026-09-22').then(
      (r) => ({ ok: true as const, r }),
      (e) => ({ ok: false as const, e: e as Error }),
    );
    let terminou = false;
    void fim.then(() => {
      terminou = true;
    });
    // Passos de 1s: o `dormir` é um setTimeout, e adiantar tudo de uma vez não
    // deixa as continuações do `await` rodarem entre uma espera e a seguinte.
    for (let i = 0; i < 600 && !terminou; i++) {
      await jest.advanceTimersByTimeAsync(1_000);
    }
    return fim;
  }

  beforeEach(() => {
    esperas = [];
    avisos = [];
    erros = [];
    chamadas = 0;
    fetchOriginal = globalThis.fetch;
    jest.useFakeTimers();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation((m: unknown) => {
      const texto = String(m);
      avisos.push(texto);
      const s = texto.match(/aguardando (\d+)s/);
      if (s) esperas.push(Number(s[1]));
    });
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation((m: unknown) => {
      erros.push(String(m));
    });
  });

  afterEach(() => {
    globalThis.fetch = fetchOriginal;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  /**
   * O CASO QUE DERRUBOU A NOITE. 403 sem saldo, depois de um 200, é o CDN
   * dizendo "devagar"; o bloco dura de 15 a 20 segundos. Esperar 1s três vezes
   * é desistir em 3 segundos — e era isso que acontecia, porque
   * `esperaAteJanelaVirar()` cai no piso de 1s quando a rodada está em ritmo.
   */
  it('403 sem saldo recua 5s e depois 15s — nunca 1s', async () => {
    oCnjResponde(PAGINA_CHEIA, RECUSA_DO_CDN, RECUSA_DO_CDN, PAGINA_CURTA);

    const fim = await lerAdiantandoORelogio();

    expect(esperas).toEqual([5, 15]);
    expect(fim.ok).toBe(true);
    expect(chamadas).toBe(4);
  });

  /** O recuo CRESCE: é o que dá chance de o bloco inteiro passar. */
  it('o recuo cresce a cada tentativa, nunca encolhe', async () => {
    oCnjResponde(PAGINA_CHEIA, RECUSA_DO_CDN);

    await lerAdiantandoORelogio();

    expect(esperas.length).toBeGreaterThan(1);
    esperas.forEach((atual, i) => {
      if (i > 0) expect(atual).toBeGreaterThan(esperas[i - 1]);
    });
  });

  /** O aviso tem de dizer QUAL das duas recusas foi — é o que se lê no log. */
  it('o log nomeia a recusa do CDN, e não "cota excedida"', async () => {
    oCnjResponde(PAGINA_CHEIA, RECUSA_DO_CDN);

    await lerAdiantandoORelogio();

    expect(avisos.some((a) => a.includes('recusa do CDN'))).toBe(true);
    expect(avisos.some((a) => a.includes('cota excedida'))).toBe(false);
  });

  /**
   * COTA É OUTRA COISA, e a espera certa continua sendo a janela. Quando o CNJ
   * manda `X-RateLimit-Remaining`, ele está CONTANDO — o que repõe é o minuto
   * virar, não um recuo arbitrário. Recuar 5s aqui só gastaria tentativa.
   */
  it('403 com saldo espera a janela virar, não a tabela de recuo', async () => {
    oCnjResponde(
      () => resposta(200, { 'x-ratelimit-remaining': '9' }, 100),
      () => resposta(429, { 'x-ratelimit-remaining': '0' }),
      () => resposta(200, { 'x-ratelimit-remaining': '19' }, 1),
    );

    await lerAdiantandoORelogio();

    // A janela é de 60s; o recuo do CDN jamais chegaria perto desse número.
    expect(esperas.length).toBeGreaterThan(0);
    expect(esperas[0]).toBeGreaterThan(45);
    expect(avisos.some((a) => a.includes('cota do CNJ'))).toBe(true);
    expect(avisos.some((a) => a.includes('recusa do CDN'))).toBe(false);
  });

  /**
   * E O DISJUNTOR CONTINUA VALENDO. Este é o contraponto: sem NENHUM 200 —
   * bloqueio de origem de verdade, em que nada passa — insistir só enche o log.
   * Foi por este caminho que 159 consultas caíram; ele não some, só deixa de
   * ser o destino do 403 de quem acabou de ser atendido.
   */
  it('403 sem nenhum 200 anterior continua sendo bloqueio de origem', async () => {
    oCnjResponde(RECUSA_DO_CDN);

    const fim = await lerAdiantandoORelogio();

    expect(fim.ok).toBe(false);
    expect(esperas).toEqual([]);
    // Uma chamada só: o disjuntor não gasta tentativa com origem recusada.
    expect(chamadas).toBe(1);
  });

  /** E o inverso: depois de um 200, o 403 nu NÃO pode abrir o disjuntor. */
  it('um 200 recente impede que o 403 seguinte abra o disjuntor', async () => {
    oCnjResponde(PAGINA_CHEIA, RECUSA_DO_CDN);

    await lerAdiantandoORelogio();

    expect(erros.some((e) => /Bloqueio de origem confirmado/.test(e))).toBe(false);
  });
});
