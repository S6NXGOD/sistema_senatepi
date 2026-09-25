import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatajudIndisponivelError, esperaDoRetryAfter } from './datajud.service';
import { CNJ_JANELA_MS, CotaPorMinuto } from './utils/cota-cnj.util';
import { ehCotaEstourada } from './utils/cota-do-cnj.util';

/**
 * "O DATAJUD RETORNOU HTTP 429. TENTE NOVAMENTE EM INSTANTES." — 25/09/2026.
 *
 * Uma pessoa clicou em "Sincronizar" na ficha do 0001347-25.2023.5.22.0002 e
 * levou essa frase. Medido na produção, com o fuso já corrigido:
 *
 *   varredura da madrugada ...... 05h00–06h35, 164 consultas, 1 × 429
 *   clique da pessoa ............ 13h30
 *   consultas nossas às 13h ..... **1 — a dela**
 *
 * Não havia o que cortar do nosso lado: a cota é por IP, o endereço de saída do
 * Railway é COMPARTILHADO, e o vizinho gastou o minuto. O 429 não é sinal de
 * que estamos abusando; é sinal de que o endereço é de todo mundo.
 *
 * O QUE ESTAVA ERRADO ERA A RESPOSTA. "Tente novamente em instantes" não diz o
 * porquê, não diz o quando, e deixa o botão clicável. Quem clica de novo toma a
 * mesma recusa — foi assim que um único NPU acumulou **35 sincronizações
 * manuais** antes de alguém desistir, em silêncio.
 */
describe('esperaDoRetryAfter — quanto esperar, segundo o próprio CNJ', () => {
  const AGORA = Date.parse('2026-09-25T16:30:00Z');

  it('segundos, a forma comum', () => {
    expect(esperaDoRetryAfter('30', AGORA)).toBe(30_000);
    expect(esperaDoRetryAfter(' 5 ', AGORA)).toBe(5_000);
  });

  /** A RFC também admite data HTTP, e servidor atrás de CDN usa as duas. */
  it('data HTTP vira a diferença até lá', () => {
    expect(esperaDoRetryAfter('Fri, 25 Sep 2026 16:30:45 GMT', AGORA)).toBe(45_000);
  });

  /**
   * CABEÇALHO ABSURDO NÃO PRENDE A FILA DA CASA. Quem chama cai na janela de
   * cota, que é o palpite honesto que já existia — melhor um minuto conhecido
   * que uma hora ditada por um proxy mal configurado.
   */
  it('valor fora de escala é descartado', () => {
    expect(esperaDoRetryAfter('99999', AGORA)).toBeNull();
    expect(esperaDoRetryAfter('Fri, 25 Sep 2026 18:00:00 GMT', AGORA)).toBeNull();
    expect(esperaDoRetryAfter('0', AGORA)).toBeNull();
    expect(esperaDoRetryAfter('-5', AGORA)).toBeNull();
  });

  /** Data que já passou não é espera. */
  it('instante no passado não vira espera', () => {
    expect(esperaDoRetryAfter('Fri, 25 Sep 2026 16:29:00 GMT', AGORA)).toBeNull();
  });

  it('ausente, vazio ou sem sentido: nulo, e quem chama usa a janela', () => {
    expect(esperaDoRetryAfter(null, AGORA)).toBeNull();
    expect(esperaDoRetryAfter(undefined, AGORA)).toBeNull();
    expect(esperaDoRetryAfter('', AGORA)).toBeNull();
    expect(esperaDoRetryAfter('daqui a pouco', AGORA)).toBeNull();
  });
});

describe('o castigo da cota tem prazo legível', () => {
  it('msDeCastigo conta o que falta, e zera sozinho', () => {
    const cota = new CotaPorMinuto();
    expect(cota.msDeCastigo).toBe(0);
    cota.penalizar(30_000);
    expect(cota.msDeCastigo).toBeGreaterThan(28_000);
    expect(cota.msDeCastigo).toBeLessThanOrEqual(30_000);
  });

  /** O padrão é a janela — o palpite honesto de quando o saldo volta. */
  it('sem argumento, o castigo é a janela inteira', () => {
    const cota = new CotaPorMinuto();
    cota.penalizar();
    expect(cota.msDeCastigo).toBeGreaterThan(CNJ_JANELA_MS - 2_000);
  });

  /** Castigo maior não é encurtado por um menor que chegue depois. */
  it('o maior prazo prevalece', () => {
    const cota = new CotaPorMinuto();
    cota.penalizar(60_000);
    cota.penalizar(5_000);
    expect(cota.msDeCastigo).toBeGreaterThan(50_000);
  });
});

/**
 * A MENSAGEM TEM DOIS DESTINATÁRIOS, e o 429 é o caso em que isso mais pesa.
 *
 * "HTTP 429" é código; quem lê a ficha precisa saber (a) que não é culpa dela,
 * (b) que não é problema deste processo, (c) quando tentar de novo e (d) que
 * nada se perde. As quatro coisas cabem em duas frases.
 */
describe('o que a tela recebe quando a cota fecha', () => {
  const erro = new DatajudIndisponivelError(
    'O CNJ recusou por excesso de consultas neste minuto — o limite é do endereço de ' +
      'saída, que dividimos com outros sistemas, e não deste processo. Tente de novo em 58s; ' +
      'a varredura da madrugada lê este processo de qualquer forma.',
    429,
    58,
  );

  it('o corpo leva os segundos, para o botão esperar sozinho', () => {
    expect((erro.getResponse() as { segundosParaTentar?: number }).segundosParaTentar).toBe(58);
    expect(erro.segundosParaTentar).toBe(58);
  });

  it('e não culpa quem clicou nem o processo', () => {
    const texto = (erro.getResponse() as { message: string }).message;
    expect(texto).toContain('não deste processo');
    expect(texto).toContain('endereço de');
    expect(texto).toContain('58s');
    // Código de protocolo não é recado para gente.
    expect(texto).not.toContain('429');
    expect(texto).not.toContain('HTTP');
  });

  /** Erro que NÃO é de cota não impõe espera — travar o botão esconderia defeito. */
  it('outro erro do CNJ não vira contagem regressiva', () => {
    const outro = new DatajudIndisponivelError('O CNJ não respondeu à consulta (erro 502).', 502);
    expect(outro.segundosParaTentar).toBeNull();
    /*
      O CORPO NÃO PODE LEVAR O CAMPO. O Nest embrulha a mensagem num objeto de
      qualquer jeito, então checar o TIPO não prova nada; o que a tela lê é a
      chave, e é a ausência dela que mantém o botão livre.
    */
    expect(outro.getResponse()).not.toHaveProperty('segundosParaTentar');
  });
});

/**
 * O ERRO DE VERDADE É RECONHECIDO COMO COTA — e quase deixou de ser.
 *
 * A repescagem noturna do cron (`processos-cron.service`) só repete o processo
 * quando `ehCotaEstourada` diz que foi cota. Até 25/09/2026 esse reconhecimento
 * vinha POR TEXTO, da palavra "429" dentro da mensagem: `statusUpstream` nunca
 * era lido, porque `DatajudIndisponivelError` estende
 * `ServiceUnavailableException` e o `.status` dele é **503**, o nosso.
 *
 * Ao reescrever a mensagem para falar com gente — sem código de protocolo —, o
 * texto perdeu o "429" e a repescagem teria parado EM SILÊNCIO: o processo
 * viraria falha comum e perderia o dia. Estes testes montam o objeto que o
 * serviço realmente lança, em vez de uma forma inventada à mão.
 */
describe('a cota é reconhecida pelo erro que o serviço lança de verdade', () => {
  const daCota = new DatajudIndisponivelError(
    'O CNJ recusou por excesso de consultas neste minuto — o limite é do endereço de ' +
      'saída, que dividimos com outros sistemas, e não deste processo. Tente de novo em 58s; ' +
      'a varredura da madrugada lê este processo de qualquer forma.',
    429,
    58,
  );

  it('o objeto real é cota, mesmo sem a palavra 429 na frase', () => {
    expect(daCota.message).not.toContain('429');
    expect(ehCotaEstourada(daCota)).toBe(true);
  });

  /** E o 503 do próprio Nest não engana: quem manda é `statusUpstream`. */
  it('o 503 nosso não é confundido com cota', () => {
    const indisponivel = new DatajudIndisponivelError('O CNJ não respondeu (erro 502).', 502);
    expect(ehCotaEstourada(indisponivel)).toBe(false);
  });

  /** A frase nova também é reconhecida por texto, para erro reembrulhado. */
  it('"excesso de consultas" conta, para o erro que perde o tipo no caminho', () => {
    expect(ehCotaEstourada({ message: 'O CNJ recusou por excesso de consultas neste minuto' })).toBe(true);
  });
});

/**
 * A CAUSA DO 429 É O ENDEREÇO DE SAÍDA — e ele deixou de ser cravado no código.
 *
 * A cota do CNJ é por IP, e o IP do Railway é compartilhado com outros clientes
 * da plataforma: nenhum ajuste de ritmo nosso resolve o vizinho. O DJEN já sai
 * por um repassador em VPS brasileira desde 03/09/2026 (`DJEN_BASE_URL`); o
 * DataJud não tinha como, porque a URL era literal.
 *
 * O PADRÃO NÃO MUDA NADA — sem a variável, continua indo direto ao CNJ. Apontar
 * para a ponte é decisão de infraestrutura, e este teste só garante que o
 * caminho existe e que ligar não quebra a montagem da URL.
 */
describe('o endereço do DataJud vem do ambiente', () => {
  const FONTE = readFileSync(join(__dirname, 'datajud.service.ts'), 'utf8').replace(/\r/g, '');

  it('lê DATAJUD_BASE_URL e cai no endereço do CNJ quando não há', () => {
    expect(FONTE).toContain("this.config.get<string>('DATAJUD_BASE_URL')");
    expect(FONTE).toContain("'https://api-publica.datajud.cnj.jus.br'");
  });

  /** Barra no fim viraria `//alias/_search`, que é 404 em proxy que normaliza. */
  it('apara a barra final, que num proxy vira 404', () => {
    expect(FONTE).toContain("replace(" + String.raw`/\/+$/` + ", '')");
    expect('https://ponte.exemplo.br/datajud/'.replace(/\/+$/, '')).toBe(
      'https://ponte.exemplo.br/datajud',
    );
  });
});
