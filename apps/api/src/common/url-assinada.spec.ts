import { ConfigService } from '@nestjs/config';
import { StorageService } from '@core/infra';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

/**
 * A URL ASSINADA DO DRIVER LOCAL.
 *
 * Antes, `/uploads/<chave>` era servida sem autenticação e a URL nunca expirava:
 * uma credencial permanente e irrevogável para documento pessoal — inclusive
 * laudo médico, dado sensível do art. 11 da LGPD. Bastava vazar uma vez.
 *
 * Estes casos exercitam a assinatura de verdade. O porteiro que a exige no
 * `/uploads` está no `main.ts`; sem ele a assinatura seria enfeite, e por isso
 * `seguranca.spec.ts` também garante que ele continua lá.
 */
describe('URL assinada (driver local)', () => {
  let dir: string;
  let storage: StorageService;
  const CHAVE = 'filiados/abc/laudo.pdf';

  const criar = (extra: Record<string, string> = {}) => {
    const valores: Record<string, string> = {
      STORAGE_DRIVER: 'local',
      STORAGE_LOCAL_DIR: dir,
      STORAGE_PUBLIC_URL: 'https://api.exemplo.test',
      JWT_ACCESS_SECRET: 'segredo-de-teste-bem-forte',
      ...extra,
    };
    return new StorageService({
      get: (c: string, p?: string) => valores[c] ?? p,
    } as unknown as ConfigService);
  };

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'senatepi-url-'));
    storage = criar();
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const partes = (url: string) => {
    const q = new URL(url).searchParams;
    return { exp: q.get('exp') ?? undefined, sig: q.get('sig') ?? undefined };
  };

  it('a URL sai com expiração e assinatura', async () => {
    const url = await storage.getSignedUrl(CHAVE);
    expect(url).toContain('/uploads/filiados/abc/laudo.pdf');
    const { exp, sig } = partes(url);
    expect(Number(exp)).toBeGreaterThan(Date.now() / 1000);
    expect(sig).toBeTruthy();
  });

  it('a assinatura emitida é aceita', async () => {
    const { exp, sig } = partes(await storage.getSignedUrl(CHAVE));
    expect(storage.urlAssinadaValida(CHAVE, exp, sig)).toBe(true);
  });

  /** O ataque óbvio: pegar uma URL válida e esticar o prazo. */
  it('RECUSA quando a expiração é adulterada', async () => {
    const { exp, sig } = partes(await storage.getSignedUrl(CHAVE));
    const esticado = String(Number(exp) + 999_999);
    expect(storage.urlAssinadaValida(CHAVE, esticado, sig)).toBe(false);
  });

  /** O outro: usar a assinatura de um arquivo para baixar outro. */
  it('RECUSA a assinatura de OUTRO arquivo', async () => {
    const { exp, sig } = partes(await storage.getSignedUrl(CHAVE));
    expect(storage.urlAssinadaValida('filiados/abc/outro.pdf', exp, sig)).toBe(false);
  });

  it('RECUSA URL expirada', async () => {
    const passado = String(Math.floor(Date.now() / 1000) - 10);
    const { sig } = partes(await storage.getSignedUrl(CHAVE));
    expect(storage.urlAssinadaValida(CHAVE, passado, sig)).toBe(false);
  });

  it('RECUSA quando falta assinatura ou expiração', () => {
    expect(storage.urlAssinadaValida(CHAVE, undefined, undefined)).toBe(false);
    expect(storage.urlAssinadaValida(CHAVE, '99999999999', undefined)).toBe(false);
    expect(storage.urlAssinadaValida(CHAVE, undefined, 'qualquer')).toBe(false);
  });

  it('RECUSA expiração que não é número', async () => {
    const { sig } = partes(await storage.getSignedUrl(CHAVE));
    expect(storage.urlAssinadaValida(CHAVE, 'amanha', sig)).toBe(false);
  });

  /**
   * Trocar o segredo invalida tudo que foi emitido antes — é o que dá poder de
   * REVOGAÇÃO EM MASSA. Antes não havia como revogar uma URL vazada; agora há.
   */
  it('a assinatura de uma instalação não vale na outra', async () => {
    const { exp, sig } = partes(await storage.getSignedUrl(CHAVE));
    const outra = criar({ JWT_ACCESS_SECRET: 'outro-segredo-completamente-diferente' });
    expect(outra.urlAssinadaValida(CHAVE, exp, sig)).toBe(false);
  });

  /** Chave com espaço e acento precisa sobreviver ao percent-encoding da URL. */
  it('funciona com chave que exige codificação', async () => {
    const chave = 'filiados/abc/laudo médico (2).pdf';
    const url = await storage.getSignedUrl(chave);
    const { exp, sig } = partes(url);
    expect(storage.urlAssinadaValida(chave, exp, sig)).toBe(true);
    // E o caminho decodificado pelo porteiro tem de bater com a chave original.
    const caminho = new URL(url).pathname.replace('/uploads/', '');
    const reconstruida = caminho.split('/').map(decodeURIComponent).join('/');
    expect(reconstruida).toBe(chave);
  });
});
