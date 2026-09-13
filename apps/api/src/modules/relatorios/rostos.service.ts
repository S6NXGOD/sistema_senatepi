import { Injectable, Logger } from '@nestjs/common';
import { StorageService } from '@core/infra';
import sharp from 'sharp';
import { PrismaService } from '../../prisma/prisma.service';
import { quemEntraNoUso } from './produtividade.service';

/**
 * AS FOTOS DO PDF DO USO — miniatura pronta, feita no servidor.
 *
 * POR QUE PELA API, e não pelo navegador: no driver local, `/uploads` é servido
 * antes do CORS, então `fetch()` falha e desenhar o `<img>` num canvas o
 * contamina; no S3, depende de um CORS de bucket que ninguém versionou; e o web
 * nem recebe a chave (o `AvataresInterceptor` a apaga). Abrir CORS na pasta que
 * guarda laudo médico por causa de uma foto não compensa. Aqui o storage é lido
 * por `getBuffer`, que funciona nos dois drivers.
 *
 * O QUE SAI, e o que nunca sai:
 *  · só o rosto de quem a pessoa JÁ vê na aba (`quemEntraNoUso`) e só conta
 *    ativa. A rota não aceita ids: sem enumeração;
 *  · JPEG de 160 px — serve para reconhecer no cartão da pessoa (círculo de
 *    14 mm, perto de 300 dpi), não para reaproveitar. Uns 5 a 8 KB cada;
 *  · nenhuma propriedade `avatarKey` na resposta: o interceptor global
 *    assinaria a URL e a chave do storage vazaria;
 *  · `avatarUrl` digitada à mão é ignorada. Buscá-la no servidor seria SSRF;
 *    sem foto, o PDF desenha as iniciais.
 */

export const LADO_DO_ROSTO = 160;
export const QUALIDADE_DO_ROSTO = 78;
/** Leituras simultâneas no storage. O S3 serial seguraria o PDF; vinte de uma vez, o servidor. */
export const ROSTOS_EM_PARALELO = 4;
/** Teto do cache: a equipe é pequena, mas Map sem limite em processo de vida longa é vazamento. */
const MAX_EM_CACHE = 500;

export interface Rostos {
  rostos: Record<string, string>;
}

/** A foto enviada vira JPEG quadrado, com fundo branco onde houver transparência. */
export async function miniaturaDoRosto(original: Buffer): Promise<string> {
  const jpeg = await sharp(original)
    .rotate()
    .resize(LADO_DO_ROSTO, LADO_DO_ROSTO, { fit: 'cover' })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: QUALIDADE_DO_ROSTO })
    .toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
}

/** `fn` sobre cada item, no máximo `limite` ao mesmo tempo, com o resultado na ordem da entrada. */
export async function emParalelo<T, R>(itens: T[], limite: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const saida = new Array<R>(itens.length);
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < itens.length) {
      const i = proximo++;
      saida[i] = await fn(itens[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, trabalhador));
  return saida;
}

@Injectable()
export class RostosService {
  private readonly logger = new Logger(RostosService.name);

  /**
   * Miniatura por CHAVE do storage. A chave muda a cada upload
   * (`avatar-<uuid>.webp`), então foto trocada é chave nova e o cache nunca
   * serve rosto velho. Guarda a promessa, para duas gerações de PDF ao mesmo
   * tempo não lerem o mesmo arquivo duas vezes; falha não fica guardada.
   */
  private readonly cache = new Map<string, Promise<string | null>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async montar(usuario: { id: string; role: string }): Promise<Rostos> {
    const comFoto = await this.prisma.user.findMany({
      where: { ...quemEntraNoUso(usuario), ativo: true, avatarKey: { not: null } },
      select: { id: true, avatarKey: true },
    });

    const lidos = await emParalelo(comFoto, ROSTOS_EM_PARALELO, async (u) => ({
      id: u.id,
      dataUrl: u.avatarKey ? await this.miniatura(u.avatarKey) : null,
    }));

    const rostos: Record<string, string> = {};
    for (const { id, dataUrl } of lidos) if (dataUrl) rostos[id] = dataUrl;
    return { rostos };
  }

  private miniatura(chave: string): Promise<string | null> {
    const emCache = this.cache.get(chave);
    if (emCache) return emCache;

    /*
      Nada aqui pode rejeitar. Hoje `getBuffer` já engole o erro e devolve
      null, mas a leitura fica DENTRO do try assim mesmo: se um driver novo
      lançar, a promessa rejeitada ficaria no cache e a rota inteira daria 500 —
      o PDF perderia todas as fotos por causa de uma. Qualquer falha vira
      `null`, e aquela pessoa sai com as iniciais.
    */
    const pendente = (async () => {
      try {
        const original = await this.storage.getBuffer(chave);
        // Disco efêmero: a chave pode estar no banco e o arquivo não. Cai nas iniciais.
        if (!original) return null;
        return await miniaturaDoRosto(original);
      } catch (e) {
        this.logger.warn(`Foto de perfil fora do PDF (${chave}): ${(e as Error).message}`);
        return null;
      }
    })();

    if (this.cache.size >= MAX_EM_CACHE) this.cache.clear();
    this.cache.set(chave, pendente);
    void pendente.then((r) => {
      if (r === null && this.cache.get(chave) === pendente) this.cache.delete(chave);
    });
    return pendente;
  }
}
