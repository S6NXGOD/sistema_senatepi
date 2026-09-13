import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  LADO_DO_ROSTO, ROSTOS_EM_PARALELO, RostosService, emParalelo, miniaturaDoRosto,
} from './rostos.service';

const semComentarios = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const CONTROLLER = semComentarios(readFileSync(join(__dirname, 'relatorios.controller.ts'), 'utf8'));

/** Uma foto com transparência, como a que alguém sobe em PNG. */
const png = (alpha = 1) =>
  sharp({ create: { width: 400, height: 300, channels: 4, background: { r: 200, g: 30, b: 30, alpha } } })
    .png()
    .toBuffer();

const decodificar = (dataUrl: string) => Buffer.from(dataUrl.replace(/^data:image\/jpeg;base64,/, ''), 'base64');

interface UsuarioFalso {
  id: string;
  role: string;
  ativo: boolean;
  avatarKey: string | null;
  avatarUrl: string | null;
}

async function cenario(atraso = 0) {
  const arquivos: Record<string, Buffer> = {
    'usuarios/adm/avatar-1.webp': await png(),
    'usuarios/ana/avatar-2.webp': await png(),
    'usuarios/velho/avatar-3.webp': await png(),
    'usuarios/quebrada/avatar-5.webp': Buffer.from('isto não é uma imagem'),
  };
  const usuarios: UsuarioFalso[] = [
    { id: 'adm', role: 'ADMINISTRADOR', ativo: true, avatarKey: 'usuarios/adm/avatar-1.webp', avatarUrl: null },
    { id: 'ana', role: 'ADVOGADO', ativo: true, avatarKey: 'usuarios/ana/avatar-2.webp', avatarUrl: null },
    // Só URL digitada à mão: nunca é buscada.
    { id: 'bia', role: 'ADVOGADO', ativo: true, avatarKey: null, avatarUrl: 'https://externo.exemplo/rosto.png' },
    { id: 'velho', role: 'ADVOGADO', ativo: false, avatarKey: 'usuarios/velho/avatar-3.webp', avatarUrl: null },
    // A chave está no banco e o arquivo sumiu do disco efêmero.
    { id: 'sumida', role: 'TRIAGEM', ativo: true, avatarKey: 'usuarios/sumida/avatar-4.webp', avatarUrl: null },
    { id: 'quebrada', role: 'TRIAGEM', ativo: true, avatarKey: 'usuarios/quebrada/avatar-5.webp', avatarUrl: null },
  ];

  const prisma = {
    user: {
      findMany: jest.fn(async ({ where }: { where: { id?: string; ativo?: boolean; avatarKey?: { not: null } } }) =>
        usuarios
          .filter((u) => where.id === undefined || u.id === where.id)
          .filter((u) => where.ativo === undefined || u.ativo === where.ativo)
          .filter((u) => !(where.avatarKey && where.avatarKey.not === null) || u.avatarKey !== null)
          // O banco devolve só o que o select pede — e a URL externa não está nele.
          .map((u) => ({ id: u.id, avatarKey: u.avatarKey })),
      ),
    },
  };
  let emVoo = 0;
  let maximo = 0;
  const storage = {
    getBuffer: jest.fn(async (chave: string) => {
      emVoo++;
      maximo = Math.max(maximo, emVoo);
      if (atraso) await new Promise((r) => setTimeout(r, atraso));
      emVoo--;
      return arquivos[chave] ?? null;
    }),
  };
  const servico = new RostosService(prisma as never, storage as never);
  return { servico, prisma, storage, usuarios, arquivos, maximo: () => maximo };
}

describe('rostos do PDF do uso — quem recebe o quê', () => {
  it('a gestão recebe as contas ativas com foto legível; conta desativada não vem', async () => {
    const { servico } = await cenario();
    const { rostos } = await servico.montar({ id: 'adm', role: 'ADMINISTRADOR' });
    expect(Object.keys(rostos).sort()).toEqual(['adm', 'ana']);
  });

  it('o advogado recebe só o próprio rosto, e o storage só lê a chave dele', async () => {
    const { servico, storage } = await cenario();
    const { rostos } = await servico.montar({ id: 'ana', role: 'ADVOGADO' });
    expect(Object.keys(rostos)).toEqual(['ana']);
    expect(storage.getBuffer.mock.calls).toEqual([['usuarios/ana/avatar-2.webp']]);
  });

  it('sem avatar_key não vem — e a URL externa não gera busca nenhuma', async () => {
    const buscar = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('não deveria buscar');
    });
    try {
      const { servico, storage } = await cenario();
      expect(await servico.montar({ id: 'bia', role: 'ADVOGADO' })).toEqual({ rostos: {} });
      await servico.montar({ id: 'adm', role: 'ADMINISTRADOR' });
      expect(buscar).not.toHaveBeenCalled();
      expect(storage.getBuffer.mock.calls.flat()).not.toContain('https://externo.exemplo/rosto.png');
    } finally {
      buscar.mockRestore();
    }
  });

  /** O `AvataresInterceptor` assina todo objeto com `avatarKey` — e a chave vazaria. */
  it('a resposta não carrega avatarKey nem a chave do storage', async () => {
    const { servico, usuarios } = await cenario();
    const texto = JSON.stringify(await servico.montar({ id: 'adm', role: 'ADMINISTRADOR' }));
    expect(texto).not.toContain('avatarKey');
    for (const u of usuarios) if (u.avatarKey) expect(texto).not.toContain(u.avatarKey);
  });

  it('arquivo sumido ou ilegível cai nas iniciais, sem derrubar os outros', async () => {
    const { servico } = await cenario();
    const { rostos } = await servico.montar({ id: 'adm', role: 'ADMINISTRADOR' });
    expect(rostos.sumida).toBeUndefined();
    expect(rostos.quebrada).toBeUndefined();
    expect(rostos.adm).toMatch(/^data:image\/jpeg;base64,/);
  });
});

describe('rostos do PDF do uso — a miniatura', () => {
  it('sai JPEG quadrado de 160 px, sem canal alfa', async () => {
    const meta = await sharp(decodificar(await miniaturaDoRosto(await png()))).metadata();
    expect(LADO_DO_ROSTO).toBe(160);
    expect({ formato: meta.format, largura: meta.width, altura: meta.height, alfa: meta.hasAlpha }).toEqual({
      formato: 'jpeg', largura: 160, altura: 160, alfa: false,
    });
  });

  /** Transparência vira branco, e não preto: o círculo do PDF fica sobre papel branco. */
  it('a transparência vira fundo branco', async () => {
    const jpeg = decodificar(await miniaturaDoRosto(await png(0)));
    const { data } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
    expect([data[0], data[1], data[2]].every((canal) => canal >= 250)).toBe(true);
  });

  /** Storage que lança não derruba a rota: aquela pessoa cai nas iniciais, e na próxima tenta de novo. */
  it('storage que lança vira iniciais para aquela pessoa, sem rejeitar', async () => {
    const { servico, storage, arquivos } = await cenario();
    storage.getBuffer.mockImplementation(async (chave: string) => {
      if (chave === 'usuarios/ana/avatar-2.webp') throw new Error('S3 fora do ar');
      return arquivos[chave] ?? null;
    });
    const { rostos } = await servico.montar({ id: 'adm', role: 'ADMINISTRADOR' });
    expect(Object.keys(rostos)).toEqual(['adm']);
    await servico.montar({ id: 'adm', role: 'ADMINISTRADOR' });
    expect(storage.getBuffer.mock.calls.filter(([c]) => c === 'usuarios/ana/avatar-2.webp')).toHaveLength(2);
  });

  it('a mesma chave é lida uma vez; a que falhou é tentada de novo', async () => {
    const { servico, storage } = await cenario();
    await servico.montar({ id: 'adm', role: 'ADMINISTRADOR' });
    await servico.montar({ id: 'adm', role: 'ADMINISTRADOR' });
    const vezes = (chave: string) => storage.getBuffer.mock.calls.filter(([c]) => c === chave).length;
    expect(vezes('usuarios/adm/avatar-1.webp')).toBe(1);
    expect(vezes('usuarios/sumida/avatar-4.webp')).toBe(2);
  });

  it('no máximo quatro leituras do storage ao mesmo tempo', async () => {
    const { servico, maximo } = await cenario(15);
    await servico.montar({ id: 'adm', role: 'ADMINISTRADOR' });
    expect(ROSTOS_EM_PARALELO).toBe(4);
    expect(maximo()).toBeLessThanOrEqual(ROSTOS_EM_PARALELO);
  });

  it('emParalelo respeita o limite e devolve na ordem da entrada', async () => {
    let emVoo = 0;
    let maximo = 0;
    const saida = await emParalelo([5, 1, 4, 2, 3, 6, 7, 8, 9, 10], 4, async (n) => {
      emVoo++;
      maximo = Math.max(maximo, emVoo);
      await new Promise((r) => setTimeout(r, n));
      emVoo--;
      return n * 10;
    });
    expect(maximo).toBe(4);
    expect(saida).toEqual([50, 10, 40, 20, 30, 60, 70, 80, 90, 100]);
    expect(await emParalelo([], 4, async (n: number) => n)).toEqual([]);
  });
});

describe('rostos do PDF do uso — a rota', () => {
  it('não recebe ids, não fica em cache e herda a matriz da classe', () => {
    expect(CONTROLLER).toContain("@Get('produtividade/rostos')");
    expect(CONTROLLER).toContain("@Header('Cache-Control', 'private, no-store')");
    expect(CONTROLLER).toContain('rostosDoUso(@CurrentUser() user: AuthUser)');
    expect(CONTROLLER).toContain("@Modulo('relatorios')");
    expect(CONTROLLER).not.toContain('@Roles(');
  });
});
