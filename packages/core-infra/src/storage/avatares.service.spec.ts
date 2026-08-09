import { AvataresService } from './avatares.service';
import { StorageService } from './storage.service';

/** Storage de mentira: devolve uma URL previsível e conta as assinaturas. */
function fakeStorage() {
  const chamadas: string[] = [];
  return {
    chamadas,
    servico: {
      getSignedUrl: async (key: string) => {
        chamadas.push(key);
        return `https://cdn.exemplo/${key}?assinatura=${chamadas.length}`;
      },
    } as unknown as StorageService,
  };
}

describe('AvataresService — a foto de perfil em qualquer resposta', () => {
  it('resolve a chave do storage em URL', async () => {
    const { servico } = fakeStorage();
    const s = new AvataresService(servico);
    const r = await s.resolver({ responsavel: { nome: 'Ana', avatarKey: 'usuarios/1.jpg', avatarUrl: null } });
    expect(r.responsavel.avatarUrl).toMatch(/^https:\/\/cdn\.exemplo\/usuarios\/1\.jpg/);
  });

  /** A chave é dado interno do storage; o cliente não tem o que fazer com ela. */
  it('remove a chave do objeto entregue', async () => {
    const { servico } = fakeStorage();
    const alvo: Record<string, unknown> = { avatarKey: 'usuarios/1.jpg', avatarUrl: null };
    await new AvataresService(servico).resolver(alvo);
    expect('avatarKey' in alvo).toBe(false);
  });

  it('sem chave, mantém a URL externa que estiver gravada', async () => {
    const { servico, chamadas } = fakeStorage();
    const r = await new AvataresService(servico).resolver({
      avatarKey: null, avatarUrl: 'https://externo/foto.png',
    });
    expect(r.avatarUrl).toBe('https://externo/foto.png');
    expect(chamadas).toHaveLength(0);
  });

  it('alcança objetos aninhados e listas — é onde as fotos da agenda estão', async () => {
    const { servico } = fakeStorage();
    const r = await new AvataresService(servico).resolver({
      items: [
        { id: 'a', responsavel: { avatarKey: 'k1', avatarUrl: null }, criador: { avatarKey: 'k2', avatarUrl: null } },
        { id: 'b', responsavel: { avatarKey: null, avatarUrl: null } },
      ],
    });
    expect(r.items[0].responsavel.avatarUrl).toContain('k1');
    expect(r.items[0].criador!.avatarUrl).toContain('k2');
    expect(r.items[1].responsavel.avatarUrl).toBeNull();
  });

  /**
   * A agenda recarrega a cada 60s. URL nova a cada recarga faria o navegador
   * rebaixar todas as fotos, sempre.
   */
  it('assina a mesma chave uma vez só e reaproveita', async () => {
    const { servico, chamadas } = fakeStorage();
    const s = new AvataresService(servico);
    const r = await s.resolver({
      a: { avatarKey: 'mesma', avatarUrl: null },
      b: { avatarKey: 'mesma', avatarUrl: null },
    });
    await s.resolver({ c: { avatarKey: 'mesma', avatarUrl: null } });
    expect(chamadas).toEqual(['mesma']);
    expect(r.a.avatarUrl).toBe(r.b.avatarUrl);
  });

  it('storage fora do ar não derruba a resposta', async () => {
    const quebrado = {
      getSignedUrl: async () => { throw new Error('sem storage'); },
    } as unknown as StorageService;
    const r = await new AvataresService(quebrado).resolver({ avatarKey: 'k', avatarUrl: null });
    expect(r.avatarUrl).toBeNull();
  });

  it('não mexe em resposta sem foto, nem quebra com data e nulo', async () => {
    const { servico, chamadas } = fakeStorage();
    const entrada = { total: 3, quando: new Date('2026-08-06T10:00:00Z'), nada: null, texto: 'ok' };
    const r = await new AvataresService(servico).resolver({ ...entrada });
    expect(r).toEqual(entrada);
    expect(chamadas).toHaveLength(0);
  });
});
