import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ehCotaEstourada, ehDemoraDoCnj, valeTentarDeNovo } from './cota-do-cnj.util';
import { DatajudIndisponivelError } from '../datajud.service';

/**
 * "VALE ESPAÇAR AS CHAMADAS OU DIVIDIR A VARREDURA EM DUAS JANELAS?" — o dono,
 * 24/09/2026, delegando a decisão.
 *
 * A resposta foi NÃO para as duas, e quem decidiu foi a medição:
 *
 *   ritmo real da varredura ..... 1 a 2 chamadas por MINUTO
 *   cota do CNJ ................. 20 por minuto
 *   429 em 24/09 ................ 9 de 169 (5,3%)
 *   429 nos 8 dias anteriores ... ZERO
 *
 * Estamos a um décimo da cota — não somos nós que a estouramos. Espaçar mais
 * alongaria a rodada sem ganhar nada, e dividir em duas janelas DOBRARIA a
 * exposição ao começo de rodada, que é onde os 429 caíram.
 *
 * O conserto certo era outro: 429 quer dizer "tente daqui a pouco", e a rodada
 * nunca tentava. Agora eles voltam uma vez, no fim.
 */
describe('reconhecer a cota estourada', () => {
  it('pelo status do axios', () => {
    expect(ehCotaEstourada({ response: { status: 429 } })).toBe(true);
  });

  it('pelo status do nosso cliente', () => {
    expect(ehCotaEstourada({ status: 429 })).toBe(true);
    expect(ehCotaEstourada({ statusCode: '429' })).toBe(true);
  });

  /**
   * O erro nem sempre chega com status: o disjuntor e o repassador reembrulham
   * e sobra a mensagem. Os três textos abaixo são os que aparecem no log real.
   */
  it.each([
    'O DATAJUD retornou HTTP 429. Tente novamente em instantes.',
    'Request failed with status code 429',
    'Too Many Requests',
    'O CNJ recusou: limite de consultas por minuto',
  ])('pela mensagem: %s', (message) => {
    expect(ehCotaEstourada({ message })).toBe(true);
  });

  /**
   * E NÃO CONFUNDE COM O RESTO. Timeout e "não localizado no índice" são
   * problemas de outra natureza — repetir não resolve nenhum dos dois, e
   * repetir o segundo é o desperdício que já custou 151 consultas num NPU só.
   */
  it.each([
    { message: 'Não foi possível consultar o DATAJUD (CNJ) no momento.' },
    { message: 'timeout of 45000ms exceeded' },
    { response: { status: 404 } },
    { status: 500 },
    { message: 'processo não localizado no índice' },
    null,
    undefined,
    {},
  ])('não é cota: %p', (err) => {
    expect(ehCotaEstourada(err)).toBe(false);
  });

  /** 4290 e 1429 não são 429 — a borda que uma busca de substring erraria. */
  it('não casa com número que só CONTÉM 429', () => {
    expect(ehCotaEstourada({ message: 'erro 4290 no tribunal' })).toBe(false);
    expect(ehCotaEstourada({ message: 'processo 1429 recusado' })).toBe(false);
  });
});

/**
 * E A DECISÃO FICA NO CÓDIGO, não só no commit: a repescagem existe, acontece
 * UMA vez e espera a janela da cota virar.
 */
describe('a repescagem da rodada', () => {
  const cron = readFileSync(join(__dirname, '../processos-cron.service.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  /**
   * 10/10/2026: A FILA PASSOU A ACEITAR O TIMEOUT TAMBÉM.
   *
   * Era só do 429, e o 429 virou minoria: das 210 falhas em 12 dias, 103 foram
   * o nosso próprio teto de 45s estourando contra uma mediana do CNJ de 31s.
   * Esses perdiam a noite inteira sem uma segunda tentativa.
   */
  it('junta quem o CNJ não respondeu — cota OU demora — e tenta de novo no fim', () => {
    expect(cron).toContain('if (valeTentarDeNovo(err) && paraTentarDeNovo.length < this.TETO_DA_REPESCAGEM) {');
    expect(cron).toContain('if (paraTentarDeNovo.length) {');
  });

  /**
   * O TETO DA FILA. Com o timeout dentro dela, uma noite ruim do CNJ mandaria
   * 50 ou 100 processos para a repescagem — e a rodada, que já leva 2h, bateria
   * no cron do DJEN das 05h.
   */
  it('a repescagem tem fim conhecido', () => {
    expect(cron).toContain('TETO_DA_REPESCAGEM = 40');
  });

  /** A cota é POR MINUTO: esperar menos que isso é repetir dentro da mesma janela. */
  it('espera a janela da cota virar antes de repetir', () => {
    expect(cron).toContain('PAUSA_APOS_COTA = 60_000');
    expect(cron).toContain('await new Promise((r) => setTimeout(r, this.PAUSA_APOS_COTA));');
  });

  /** Uma vez só: insistir com a cota estourada é virar parte do problema. */
  it('não vira laço — a repescagem não realimenta a fila', () => {
    const trecho = cron.slice(cron.indexOf('if (paraTentarDeNovo.length) {'));
    const corpo = trecho.slice(0, trecho.indexOf('[DATAJUD-SYNC] Concluído'));
    expect(corpo).not.toContain('paraTentarDeNovo.push');
  });

  /** O resumo conta o que foi recuperado — senão o conserto é invisível. */
  it('a rodada registra quantos voltaram', () => {
    expect(cron).toContain('rodada.recuperados++');
    expect(cron).toContain('recuperado(s) da cota');
  });
});

/**
 * "O CNJ DEMOROU DEMAIS" — a segunda causa que merece repescagem.
 *
 * MEDIDO NA PRODUÇÃO EM 10/10/2026, quando o dono perguntou se havia problema
 * nas leituras. Havia, e não era dos processos:
 *
 *   mediana de uma consulta, de madrugada, pelo Railway
 *     semana de 24/08 ...... 0,9 s
 *     semana de 05/10 ..... 30,5 s        ← 30× mais lenta em seis semanas
 *
 *   falhas por motivo (12 dias)
 *     estouro do NOSSO teto de 45s .... 103
 *     429 ............................. 94
 *
 * O timeout virou a maior causa de falha, e era a única que a rodada não
 * tentava de novo. Os testes abaixo constroem o ERRO DE VERDADE — não uma
 * imitação —, porque a armadilha deste reconhecimento é justamente a camada:
 * `DatajudIndisponivelError` é um 503 por fora, e o código do CNJ mora em
 * `statusUpstream`.
 */
describe('a demora do CNJ é reconhecida pela estrutura, não pela frase', () => {
  it('o erro tipado do timeout é reconhecido', () => {
    const erro = new DatajudIndisponivelError('O CNJ não respondeu em 90s.', 408);
    expect(ehDemoraDoCnj(erro)).toBe(true);
    expect(valeTentarDeNovo(erro)).toBe(true);
    // E NÃO é confundido com cota: a repescagem do 429 espera 60s por causa da
    // janela; misturar os dois faria a contagem do resumo mentir.
    expect(ehCotaEstourada(erro)).toBe(false);
  });

  /**
   * A FRASE PODE SER REESCRITA SEM QUEBRAR NADA — foi exatamente o que quase
   * aconteceu com o 429, e a lição está no topo deste arquivo.
   */
  it('não depende do texto da mensagem', () => {
    expect(ehDemoraDoCnj(new DatajudIndisponivelError('qualquer outra redação', 408))).toBe(true);
    expect(ehDemoraDoCnj(new DatajudIndisponivelError('o CNJ demorou demais', 503))).toBe(false);
  });

  /** O aborto cru, caso algum caminho novo não passe pelo erro tipado. */
  it('o AbortError do fetch também conta', () => {
    const abort = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    expect(ehDemoraDoCnj(abort)).toBe(true);
    expect(valeTentarDeNovo(abort)).toBe(true);
  });

  /**
   * O QUE NÃO VOLTA PARA A FILA: o erro que a segunda tentativa repetiria
   * igual. NPU que o índice não conhece não vira menos desconhecido em cinco
   * minutos — e insistir seria gastar cota para nada.
   */
  it('o que não muda com o tempo fica de fora', () => {
    expect(valeTentarDeNovo(new DatajudIndisponivelError('Processo não localizado no índice.', 404))).toBe(false);
    expect(valeTentarDeNovo(new Error('tribunal sem alias'))).toBe(false);
    expect(valeTentarDeNovo(null)).toBe(false);
    expect(valeTentarDeNovo(undefined)).toBe(false);
  });

  /** As duas causas entram na mesma fila, que é o ponto da mudança. */
  it('cota e demora são a mesma fila', () => {
    expect(valeTentarDeNovo(new DatajudIndisponivelError('cota', 429))).toBe(true);
    expect(valeTentarDeNovo(new DatajudIndisponivelError('demora', 408))).toBe(true);
  });
});

/**
 * O TETO DE ESPERA, e por que ele subiu.
 *
 * Com a mediana do CNJ em 31s, um teto de 45s é 1,45× a mediana — ele deixa de
 * ser rede de segurança e passa a cortar resposta boa. 90s é ~3× a mediana.
 */
describe('o teto de espera do DataJud', () => {
  const servico = readFileSync(join(__dirname, '../datajud.service.ts'), 'utf8');

  it('o padrão é 90s, e continua ajustável por ambiente', () => {
    expect(servico).toContain("Number(this.config.get('DATAJUD_TIMEOUT_MS')) || 90_000");
  });

  /** O timeout sai tipado — senão a repescagem não o enxerga. */
  it('o estouro do teto vira 408, e não um 503 genérico', () => {
    const i = servico.indexOf("const isTimeout = (err as Error)?.name === 'AbortError';");
    expect(i).toBeGreaterThan(0);
    const trecho = servico.slice(i, i + 1600);
    expect(trecho).toContain('if (isTimeout) {');
    expect(trecho).toContain('new DatajudIndisponivelError(');
    expect(trecho).toContain('408,');
  });
});
