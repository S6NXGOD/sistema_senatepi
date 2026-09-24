import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ehCotaEstourada } from './cota-do-cnj.util';

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

  it('junta quem levou 429 e tenta de novo no fim', () => {
    expect(cron).toContain('if (ehCotaEstourada(err)) paraTentarDeNovo.push(id);');
    expect(cron).toContain('if (paraTentarDeNovo.length) {');
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
