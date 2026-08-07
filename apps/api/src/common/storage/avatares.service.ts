import { Injectable } from '@nestjs/common';
import { StorageService } from './storage.service';

/**
 * Resolve a FOTO de perfil em qualquer resposta da API.
 *
 * O PROBLEMA QUE ISTO RESOLVE
 * A foto enviada por upload não mora em `User.avatarUrl` — mora no storage, e o
 * banco guarda apenas a CHAVE (`avatarKey`). Ao enviar uma foto, `avatarUrl` é
 * zerado de propósito (`usuarios.service.ts`), porque a URL do S3 é assinada e
 * expira: guardá-la daria um link quebrado poucas horas depois.
 *
 * A consequência é que `avatarUrl` vem NULO para todo mundo que tem foto — e
 * doze consultas espalhadas pelo sistema (agenda, dashboard, dossiê, processos,
 * partes) selecionavam justamente esse campo esperando a foto. O resultado era
 * sempre a inicial no lugar do rosto, mesmo com a foto cadastrada e aparecendo
 * na tela de Usuários, que é a única que assinava a URL na hora.
 *
 * POR QUE UM RESOLVEDOR ÚNICO, E NÃO A CORREÇÃO EM CADA CONSULTA
 * Porque a correção em cada consulta é o que já falhou: são doze pontos, em
 * respostas aninhadas em profundidades diferentes, e a décima terceira consulta
 * escrita amanhã voltaria a errar sem que nada acusasse. Aqui a regra é uma só:
 * objeto que carrega `avatarKey` tem a foto resolvida, onde quer que ele esteja
 * na resposta.
 *
 * DE BRINDE, a chave do storage nunca vaza para o cliente: ela é removida do
 * objeto depois de resolvida.
 */
@Injectable()
export class AvataresService {
  /**
   * URL assinada por chave.
   *
   * Não é só economia de CPU: a agenda recarrega sozinha a cada 60 segundos, e
   * assinar de novo a cada recarga geraria uma URL diferente para a MESMA foto
   * — o navegador trataria como imagem nova e baixaria tudo outra vez, a cada
   * minuto, em todos os cards. Reaproveitar a URL mantém o cache do navegador
   * funcionando.
   */
  private readonly cache = new Map<string, { url: Promise<string>; expiraEm: number }>();

  /** Validade pedida ao storage. */
  private static readonly VALIDADE_S = 3600;
  /**
   * Por quanto tempo a URL é reaproveitada. Menor que a validade de propósito:
   * uma URL entregue no último segundo do cache ainda precisa funcionar enquanto
   * a página estiver aberta.
   */
  private static readonly REUSO_MS = 45 * 60_000;

  constructor(private readonly storage: StorageService) {}

  /**
   * URL da foto: a do storage quando há chave, senão a URL externa gravada.
   *
   * O cache guarda a PROMESSA, não o resultado. A resposta é percorrida em
   * paralelo, e uma pessoa costuma aparecer em vários cards da mesma tela: com
   * cache só do resultado, todas as ocorrências consultavam o storage antes de
   * a primeira responder, e cada uma recebia uma assinatura DIFERENTE para a
   * mesma foto — o navegador então baixava o mesmo rosto várias vezes.
   */
  async url(avatarKey: string | null, avatarUrl: string | null): Promise<string | null> {
    if (!avatarKey) return avatarUrl ?? null;

    const agora = Date.now();
    const emCache = this.cache.get(avatarKey);
    const pendente = emCache && emCache.expiraEm > agora
      ? emCache.url
      : this.assinar(avatarKey, agora);

    try {
      return await pendente;
    } catch {
      // Storage fora do ar não pode derrubar a resposta inteira: sem foto, a
      // tela cai na inicial, que é o comportamento de sempre.
      return avatarUrl ?? null;
    }
  }

  /** Registra a promessa no cache ANTES de esperar por ela (ver `url`). */
  private assinar(avatarKey: string, agora: number): Promise<string> {
    const url = this.storage.getSignedUrl(avatarKey, AvataresService.VALIDADE_S);
    // Teto simples: a base de usuários é pequena, mas um Map sem limite num
    // processo de vida longa é vazamento na certa.
    if (this.cache.size > 500) this.cache.clear();
    this.cache.set(avatarKey, { url, expiraEm: agora + AvataresService.REUSO_MS });
    // Falha não fica em cache — senão uma indisponibilidade de um segundo
    // apagaria as fotos pelos 45 minutos seguintes.
    url.catch(() => {
      if (this.cache.get(avatarKey)?.url === url) this.cache.delete(avatarKey);
    });
    return url;
  }

  /**
   * Percorre a resposta e resolve toda foto que encontrar.
   *
   * Só toca em objeto que TEM `avatarKey` — nada mais é alterado. Datas,
   * Decimais e Buffers do Prisma são ignorados: percorrê-los não traria nada e
   * transformá-los seria estrago.
   */
  async resolver<T>(payload: T): Promise<T> {
    // A varredura é SÍNCRONA: ela roda em toda resposta da API, e a esmagadora
    // maioria não tem foto nenhuma. Criar uma promessa por campo visitado para
    // depois descobrir que não havia o que resolver custaria caro à toa. O
    // trabalho assíncrono acontece só sobre os objetos que de fato têm foto.
    const comFoto: Record<string, unknown>[] = [];
    this.coletar(payload, 0, comFoto);
    if (!comFoto.length) return payload;

    await Promise.all(
      comFoto.map(async (obj) => {
        obj.avatarUrl = await this.url(
          (obj.avatarKey as string | null) ?? null,
          (obj.avatarUrl as string | null) ?? null,
        );
        delete obj.avatarKey;
      }),
    );
    return payload;
  }

  private coletar(no: unknown, profundidade: number, saida: Record<string, unknown>[]): void {
    // Guarda contra referência circular ou estrutura patológica. Nenhuma
    // resposta legítima da API chega perto disso.
    if (no === null || typeof no !== 'object' || profundidade > 12) return;

    if (Array.isArray(no)) {
      for (const item of no) this.coletar(item, profundidade + 1, saida);
      return;
    }
    // Só objeto simples: instância de classe (Date, Decimal, Buffer, arquivo em
    // stream) fica fora — percorrê-la não traria nada e mexer nela seria estrago.
    const proto = Object.getPrototypeOf(no);
    if (proto !== Object.prototype && proto !== null) return;

    const obj = no as Record<string, unknown>;
    if ('avatarKey' in obj) saida.push(obj);
    for (const valor of Object.values(obj)) this.coletar(valor, profundidade + 1, saida);
  }
}
