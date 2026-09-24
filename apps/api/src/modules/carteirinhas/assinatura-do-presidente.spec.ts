import sharp from 'sharp';
import {
  limparCacheDeAssinatura,
  removerFundoDaAssinatura,
  urlDeAssinaturaAceitavel,
} from './assinatura-do-presidente.util';

/**
 * "A ASSINATURA DO PRESIDENTE TÁ COMO SE FOSSE UM FUNDO. COMO SE ELA TIVESSE
 * COLADA." — o dono, 23/09/2026, sobre o carnê.
 *
 * O cartão herdaria o mesmo defeito, e pior: no carnê o navegador disfarça com
 * filtro CSS, mas o cartão é desenhado no SERVIDOR e não existe filtro. A
 * imagem guardada é a FOTO de uma assinatura em papel — fundo azulado, faixa
 * esverdeada no pé, bordas retas —, e desenhada como está vira um adesivo
 * branco no meio do verso.
 */

/** Uma "assinatura": papel claro com um traço escuro atravessando. */
async function papelComTraco(opts: { largura?: number; altura?: number; luzDoPapel?: number } = {}) {
  const largura = opts.largura ?? 200;
  const altura = opts.altura ?? 80;
  const luz = opts.luzDoPapel ?? 235;
  const raw = Buffer.alloc(largura * altura * 3, luz);
  // Um traço escuro no meio, com margem de papel em volta (é o que se apara).
  for (let y = 30; y < 50; y++) {
    for (let x = 40; x < 160; x++) {
      const p = (y * largura + x) * 3;
      raw[p] = 20;
      raw[p + 1] = 25;
      raw[p + 2] = 60;
    }
  }
  return sharp(raw, { raw: { width: largura, height: altura, channels: 3 } }).png().toBuffer();
}

describe('a URL da assinatura', () => {
  it('aceita https público', () => {
    expect(urlDeAssinaturaAceitavel('https://economic-silver-flq4b30m.edgeone.dev/file.png')).toBe(
      true,
    );
  });

  /**
   * O CAMPO É PREENCHIDO POR GENTE, e o servidor é quem busca. Sem esta trava,
   * a configuração vira uma forma de fazer a API pedir coisas para si mesma e
   * para a rede interna do Railway.
   */
  it.each([
    'http://exemplo.com/a.png',
    'https://localhost/a.png',
    'https://127.0.0.1/a.png',
    'https://10.0.0.5/a.png',
    'https://192.168.1.10/a.png',
    'https://172.20.3.4/a.png',
    'https://169.254.169.254/latest/meta-data',
    'https://api.railway.internal/a.png',
    'file:///etc/passwd',
    'não é url',
    '',
    null,
    undefined,
  ])('recusa %s', (url) => {
    expect(urlDeAssinaturaAceitavel(url as string)).toBe(false);
  });
});

describe('tirar o papel de trás da assinatura', () => {
  beforeEach(() => limparCacheDeAssinatura());

  it('devolve PNG com canal alfa', async () => {
    const saida = await removerFundoDaAssinatura(await papelComTraco());
    expect(saida).not.toBeNull();
    const meta = await sharp(saida as Buffer).metadata();
    expect(meta.format).toBe('png');
    expect(meta.hasAlpha).toBe(true);
  });

  /** O papel some de verdade: o canto de fora do traço fica TRANSPARENTE. */
  it('o papel vira transparente e a tinta fica opaca', async () => {
    const saida = await removerFundoDaAssinatura(await papelComTraco());
    const { data, info } = await sharp(saida as Buffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const alfa = (x: number, y: number) => data[(y * info.width + x) * info.channels + 3];
    // Depois de aparado, sobra basicamente o traço: o miolo é opaco.
    expect(alfa(Math.floor(info.width / 2), Math.floor(info.height / 2))).toBeGreaterThan(200);
  });

  /**
   * APARA AS SOBRAS. Sem isso, o `fit` do PDFKit encolhe a assinatura para a
   * margem de papel caber junto, e o traço sai minúsculo no meio de um vazio.
   */
  it('apara a margem de papel', async () => {
    const saida = await removerFundoDaAssinatura(await papelComTraco());
    const meta = await sharp(saida as Buffer).metadata();
    expect(meta.width).toBeLessThan(200);
    expect(meta.height).toBeLessThan(80);
    expect(meta.width).toBeGreaterThan(0);
  });

  /**
   * E DESISTE QUANDO NÃO É UMA ASSINATURA. Uma foto escura, um logo em fundo
   * preto ou um scan invertido viram um borrão retangular — pior do que não
   * desenhar nada. O cartão então usa a linha, que é o que ele sempre teve.
   */
  it('recusa imagem escura, que viraria um borrão', async () => {
    const escura = await sharp({
      create: { width: 120, height: 60, channels: 3, background: { r: 10, g: 10, b: 10 } },
    })
      .png()
      .toBuffer();
    expect(await removerFundoDaAssinatura(escura)).toBeNull();
  });

  it('recusa papel em branco, que não tem traço nenhum', async () => {
    const branca = await sharp({
      create: { width: 120, height: 60, channels: 3, background: { r: 250, g: 250, b: 250 } },
    })
      .png()
      .toBuffer();
    expect(await removerFundoDaAssinatura(branca)).toBeNull();
  });

  /** Arquivo ilegível nunca derruba a emissão do cartão. */
  it('lixo devolve null em vez de erro', async () => {
    expect(await removerFundoDaAssinatura(Buffer.from('isto não é imagem'))).toBeNull();
    expect(await removerFundoDaAssinatura(Buffer.alloc(0))).toBeNull();
  });
});
