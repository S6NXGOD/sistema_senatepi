import sharp from 'sharp';

/**
 * A ASSINATURA DA PRESIDÊNCIA NO CARTÃO.
 *
 * O carnê já imprime essa assinatura desde sempre — a configuração guarda a
 * URL e o navegador busca a imagem. O cartão é gerado no SERVIDOR, então quem
 * busca somos nós, e isso muda o que precisa ser cuidado.
 *
 * TRÊS TRAVAS NA BUSCA, e nenhuma é decorativa:
 *
 * 1. SÓ `https://`, e nunca para dentro da rede. A URL vem de um campo que o
 *    Administrador preenche. Um servidor que busca qualquer endereço que lhe
 *    mandam é um servidor que alcança `localhost:3333` e a rede interna do
 *    Railway em nome de quem pediu. É pouco provável e é barato de impedir.
 * 2. TEMPO CURTO. A emissão não pode ficar pendurada num domínio de terceiro
 *    que caiu. Estourou, sai a linha para assinar à mão — que é o que o cartão
 *    tinha antes e continua sendo aceitável.
 * 3. GUARDA EM MEMÓRIA. A assinatura muda uma vez por mandato; buscar e tratar
 *    de novo a cada cartão é gastar rede e CPU num arquivo que não mudou. O
 *    primeiro cartão paga, o resto da vida do processo não paga nada.
 *
 * NADA DISSO FALHA A EMISSÃO: toda saída ruim devolve `null` e o cartão sai com
 * a linha. Uma assinatura que não carregou nunca vale um 500 na cara de quem
 * clicou.
 */

const TEMPO_LIMITE_MS = 4_000;
const TAMANHO_MAXIMO = 2 * 1024 * 1024;
/** Teto de pixels antes do tratamento — limita a CPU de um upload enorme. */
const LARGURA_MAXIMA = 1200;

/**
 * O CORTE ENTRE PAPEL E TINTA.
 *
 * `LIMIAR` para cima é papel (some por completo); `PISO` para baixo é tinta
 * cheia. Entre os dois a opacidade cresce, o que preserva a borda suave do
 * traço — um corte seco deixaria a assinatura serrilhada.
 */
const LIMIAR = 205;
const PISO = 70;

/** A cor do traço depois do tratamento: o mesmo grafite do texto do cartão. */
const TINTA: [number, number, number] = [17, 24, 39];

/** Cache por URL: `null` guardado também, para não insistir no que já falhou. */
const cache = new Map<string, Buffer | null>();

/** Endereços que o servidor não deve alcançar em nome de uma configuração. */
function ehHostPrivado(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal')) return true;
  if (/^127\./.test(h) || h === '::1' || h === '0.0.0.0') return true;
  if (/^10\./.test(h) || /^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  return false;
}

export function urlDeAssinaturaAceitavel(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !ehHostPrivado(u.hostname);
  } catch {
    return false;
  }
}

/**
 * TIRA O PAPEL DE TRÁS DA ASSINATURA.
 *
 * "A ASSINATURA DO PRESIDENTE TÁ COMO SE FOSSE UM FUNDO. COMO SE ELA TIVESSE
 * COLADA." — o dono, sobre o carnê, e o cartão herdaria o mesmo defeito.
 *
 * A imagem guardada é a FOTO de uma assinatura em papel: fundo azulado, uma
 * faixa esverdeada embaixo, bordas retas. Desenhada como está, vira um adesivo
 * branco no meio do cartão. No carnê dá para disfarçar com filtro CSS; num PDF
 * desenhado no servidor não existe filtro — é preciso reescrever os pixels.
 *
 * O que sai daqui é um PNG com FUNDO TRANSPARENTE onde só a tinta é opaca, já
 * aparado nas sobras. Falhou qualquer passo, devolve `null` e o cartão usa a
 * linha: melhor sem assinatura do que com um retângulo colado.
 */
export async function removerFundoDaAssinatura(entrada: Buffer): Promise<Buffer | null> {
  try {
    const cinza = sharp(entrada)
      .rotate() // respeita a orientação EXIF de foto tirada no celular
      .resize({ width: LARGURA_MAXIMA, withoutEnlargement: true })
      .greyscale();

    const { data, info } = await cinza.raw().toBuffer({ resolveWithObject: true });
    const total = info.width * info.height;
    if (!total) return null;

    const rgba = Buffer.alloc(total * 4);
    let opacos = 0;
    for (let i = 0; i < total; i++) {
      const luz = data[i * info.channels];
      // Papel claro -> 0; tinta escura -> 255; o meio é a borda do traço.
      let alfa = Math.round(((LIMIAR - luz) / (LIMIAR - PISO)) * 255);
      if (alfa < 0) alfa = 0;
      else if (alfa > 255) alfa = 255;
      if (alfa > 40) opacos++;
      const p = i * 4;
      rgba[p] = TINTA[0];
      rgba[p + 1] = TINTA[1];
      rgba[p + 2] = TINTA[2];
      rgba[p + 3] = alfa;
    }

    /*
      SE QUASE TUDO VIROU TINTA, A IMAGEM NÃO ERA UMA ASSINATURA em papel claro
      — é uma foto escura, um logo em fundo preto, um scan invertido. Tratar
      assim produziria um borrão retangular, que é pior do que não desenhar
      nada. Acima de 60% de pixels opacos, desiste.
    */
    if (opacos / total > 0.6) return null;
    // E se não sobrou traço nenhum, também não há o que desenhar.
    if (opacos / total < 0.0005) return null;

    const png = sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } }).png();
    /*
      APARAR AS SOBRAS. A foto tem margem de papel dos quatro lados; sem aparar,
      o `fit` do PDFKit encolhe a assinatura para caber a margem junto e o traço
      sai minúsculo no meio de um vazio.
    */
    try {
      return await png.clone().trim({ threshold: 1 }).toBuffer();
    } catch {
      return await png.toBuffer();
    }
  } catch {
    return null;
  }
}

/** A imagem da assinatura pronta para desenhar, ou `null` — nunca um erro. */
export async function buscarAssinatura(url: string | null | undefined): Promise<Buffer | null> {
  if (!urlDeAssinaturaAceitavel(url)) return null;
  const chave = url as string;
  if (cache.has(chave)) return cache.get(chave) ?? null;

  let resultado: Buffer | null = null;
  try {
    const resposta = await fetch(chave, { signal: AbortSignal.timeout(TEMPO_LIMITE_MS) });
    if (resposta.ok) {
      const tipo = resposta.headers.get('content-type') ?? '';
      // Um SVG ou um HTML de erro derrubaria o tratamento e o `doc.image`.
      if (/image\/(png|jpe?g|webp)/i.test(tipo)) {
        const bytes = Buffer.from(await resposta.arrayBuffer());
        if (bytes.length && bytes.length <= TAMANHO_MAXIMO) {
          resultado = await removerFundoDaAssinatura(bytes);
        }
      }
    }
  } catch {
    resultado = null;
  }

  cache.set(chave, resultado);
  return resultado;
}

/** Só para teste: o cache é global e sobreviveria entre casos. */
export function limparCacheDeAssinatura(): void {
  cache.clear();
}
