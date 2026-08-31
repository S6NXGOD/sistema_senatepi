import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';

/**
 * O NOME DO ARQUIVO SOBREVIVE ATÉ A PASTA DE DOWNLOADS.
 *
 * O defeito, relatado em 31/08/2026: "ao baixar um PDF de uma atividade, ele
 * vem com o nome estranho e aleatório". Vinha mesmo. A chave no bucket é opaca
 * por LGPD — `<prefixo>/anexos/<uuid>.pdf` — e era ela que virava o nome do
 * arquivo salvo, embora o nome original estivesse gravado no banco desde o
 * upload. Quem anexava o termo assinado a uma atividade e o baixava de volta
 * recebia `3f9a1c02-….pdf`.
 */
function servico(extra: Record<string, string> = {}): StorageService {
  const valores: Record<string, string> = {
    STORAGE_DRIVER: 'local',
    STORAGE_LOCAL_DIR: '/tmp/uploads-teste',
    STORAGE_PUBLIC_URL: 'https://api.exemplo.org',
    STORAGE_URL_SECRET: 'segredo-de-teste-que-nao-vale-nada',
    ...extra,
  };
  const config = {
    get: (chave: string, padrao?: string) => valores[chave] ?? padrao,
  } as unknown as ConfigService;
  return new StorageService(config);
}

describe('URL assinada com nome de arquivo', () => {
  const CHAVE = 'filiados/abc/anexos/3f9a1c02-9d1e-4c6f-a0b1-2233445566aa.pdf';

  it('sem nome, a URL continua exatamente como era', async () => {
    const url = await servico().getSignedUrl(CHAVE);
    expect(url).toContain('/uploads/');
    expect(url).toMatch(/[?&]exp=\d+/);
    expect(url).toMatch(/[&?]sig=/);
    expect(url).not.toContain('nome=');
  });

  it('com nome, ele viaja na query — é o que o porteiro lê', async () => {
    const url = await servico().getSignedUrl(CHAVE, 3600, 'Termo assinado.pdf');
    expect(url).toContain(`nome=${encodeURIComponent('Termo assinado.pdf')}`);
  });

  it('acento no nome vai percent-encoded, não cru', async () => {
    const url = await servico().getSignedUrl(CHAVE, 3600, 'Petição inicial.pdf');
    expect(url).toContain(encodeURIComponent('Petição inicial.pdf'));
    expect(url).not.toContain('ç');
  });

  /**
   * O nome fica FORA da assinatura de propósito: ele não dá acesso a nada —
   * quem tem a URL já pode baixar o conteúdo — e incluí-lo obrigaria a
   * reassinar toda vez que alguém renomeasse o anexo. A prova é que a mesma
   * chave, com nomes diferentes, produz a MESMA assinatura.
   */
  it('o nome não entra no HMAC', async () => {
    const s = servico();
    const a = new URL(await s.getSignedUrl(CHAVE, 3600, 'um.pdf'));
    const b = new URL(await s.getSignedUrl(CHAVE, 3600, 'outro-bem-diferente.pdf'));
    // `exp` depende do relógio; comparamos assinando o mesmo instante.
    a.searchParams.set('exp', '0');
    b.searchParams.set('exp', '0');
    expect(a.searchParams.get('sig')).toBe(b.searchParams.get('sig'));
  });

  /** E a assinatura continua valendo: o nome não pode invalidar a URL. */
  it('a URL com nome continua passando na validação', async () => {
    const s = servico();
    const url = new URL(await s.getSignedUrl(CHAVE, 3600, 'Termo assinado.pdf'));
    expect(
      s.urlAssinadaValida(
        CHAVE,
        url.searchParams.get('exp') ?? undefined,
        url.searchParams.get('sig') ?? undefined,
      ),
    ).toBe(true);
  });
});
