import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { esperaDoRetryAfter } from '../../common/retry-after.util';

const SYNC = readFileSync(join(__dirname, 'siconfi-sync.service.ts'), 'utf8').replace(/\r/g, '');
const CLIENTE = readFileSync(join(__dirname, 'siconfi.service.ts'), 'utf8').replace(/\r/g, '');

/**
 * "O TESOURO NACIONAL RECUSOU 43 DAS 43 LEITURAS REGISTRADAS HOJE" — a faixa do
 * painel, 06/10/2026, e o dono perguntando se a API do SICONFI estava boa.
 *
 * ESTAVA. Testada minutos depois: **200 em três tentativas seguidas**. Quem
 * passou do limite fomos nós.
 *
 * MEDIDO NA PRODUÇÃO:
 *
 *   municípios da rodada ................. 60
 *   recusados com 429 .................... 42
 *   tempo entre a primeira e a última .... 16 segundos
 *   falhas do SICONFI em toda a história . este dia, e só ele
 *
 * Os 18 primeiros passaram; do 19º em diante veio "pedidos demais" — e o laço
 * seguiu a 250 ms, levando 42 recusas sem desacelerar um milissegundo. 429 não
 * é falha do município: é pedido de calma, e tratá-lo como falha comum é o
 * mesmo mal-entendido que fazia a faixa do CNJ dizer "o CNJ recusou" quando era
 * a nossa varredura passando do teto.
 */
describe('o 429 do Tesouro faz a rodada recuar', () => {
  it('o município volta para a fila em vez de virar falha', () => {
    expect(SYNC).toContain('private async comRecuoNo429<T>(codigo: number, ler: () => Promise<T>)');
    expect(SYNC).toContain('const [pessoal, saude] = await this.comRecuoNo429(codigo, () =>');
  });

  /** Só o 429. Insistir num 500 é gastar a madrugada repetindo o que não muda. */
  it('qualquer outro erro sobe na hora', () => {
    expect(SYNC).toContain("if (erro?.statusUpstream !== 429 || ultima) throw e;");
  });

  /** Quem sabe quanto esperar é quem recusou; a tabela é só reserva. */
  it('a espera vem do `Retry-After`, com recuo tabelado de reserva', () => {
    expect(SYNC).toContain('esperaDoRetryAfter(erro.retryAfter) ?? SiconfiSyncService.RECUO_429_MS[i]');
    expect(SYNC).toContain('private static readonly RECUO_429_MS = [5_000, 15_000, 45_000];');
  });

  /** E o cabeçalho precisa chegar lá — era descartado no cliente. */
  it('o cliente carrega o Retry-After no erro', () => {
    expect(CLIENTE).toContain('readonly retryAfter?: string | null,');
    expect(CLIENTE).toContain("resposta.headers.get('retry-after'),");
  });

  /**
   * A RODADA NÃO MORRE POR CAUSA DE UM. Esgotadas as tentativas, o erro sobe e
   * o município entra no resumo como falha — como era antes.
   */
  it('o recuo tem fim', () => {
    expect(SYNC).toContain('const ultima = i >= SiconfiSyncService.RECUO_429_MS.length;');
  });
});

/**
 * A CONTA DO `Retry-After` SAIU DE DENTRO DO DATAJUD.
 *
 * Nasceu em `datajud.service.ts` e o Tesouro precisou da mesma. Importar o
 * serviço de um módulo Nest a partir de outro fecha ciclo de importação, e isso
 * só o dev pega — a armadilha que já custou caro ao ligar Contas Públicas ao
 * processo. Por isso mora em `common`.
 */
describe('esperaDoRetryAfter, agora compartilhada', () => {
  const AGORA = Date.parse('2026-10-06T14:30:00Z');

  it('segundos', () => {
    expect(esperaDoRetryAfter('30', AGORA)).toBe(30_000);
  });

  it('data HTTP', () => {
    expect(esperaDoRetryAfter('Tue, 06 Oct 2026 14:30:45 GMT', AGORA)).toBe(45_000);
  });

  it('valor fora de escala é descartado', () => {
    expect(esperaDoRetryAfter('99999', AGORA)).toBeNull();
    expect(esperaDoRetryAfter('0', AGORA)).toBeNull();
  });

  it('ausente é nulo, e quem chama usa o próprio palpite', () => {
    expect(esperaDoRetryAfter(null, AGORA)).toBeNull();
    expect(esperaDoRetryAfter(undefined, AGORA)).toBeNull();
    expect(esperaDoRetryAfter('', AGORA)).toBeNull();
  });

  /** O módulo de municípios NÃO importa o serviço do DataJud. */
  it('o sync do SICONFI lê do util comum, não do DataJud', () => {
    expect(SYNC).toContain("from '../../common/retry-after.util'");
    expect(SYNC).not.toContain('datajud.service');
  });
});
