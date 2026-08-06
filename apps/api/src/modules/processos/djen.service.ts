import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { flagLigada } from '../../common/utils/flag.util';
import { limparTextoPublicacao } from './utils/providencia.util';

/**
 * DjenService — cliente da API Comunica PJe (DJEN / CNJ).
 *
 * O QUE ELA ENTREGA QUE O DATAJUD NÃO ENTREGA
 * O teor da publicação. O DataJud devolve o rótulo do ato ("Expedição de
 * documento") e deixa `conteudo` nulo quase sempre; o DJEN devolve o texto
 * inteiro da intimação, que é onde está a providência e o prazo.
 *
 * A API é PÚBLICA — não exige chave nem cabeçalho de autenticação (verificado
 * contra o ambiente de produção). Por isso não há segredo a configurar aqui,
 * apenas URL base e timeout.
 *
 * LGPD: ao contrário do DataJud, o `texto` traz nome das partes. Nenhum log
 * deste serviço imprime teor — só NPU, tribunal e contagens, mesma disciplina
 * já adotada em `DatajudService`.
 */

/** Falha vinda do próprio DJEN, carregando o status HTTP de ORIGEM. */
export class DjenIndisponivelError extends ServiceUnavailableException {
  constructor(
    mensagem: string,
    readonly statusUpstream: number,
  ) {
    super(mensagem);
  }
}

/** Advogado intimado, como o DJEN o descreve. */
export interface AdvogadoDjen {
  nome: string | null;
  numeroOab: string | null;
  ufOab: string | null;
}

/** Parte destinatária da comunicação. */
export interface DestinatarioDjen {
  nome: string | null;
  /** "A" (ativo) / "P" (passivo), como o DJEN envia. */
  polo: string | null;
}

/** Uma publicação/intimação, já normalizada para o formato do sistema. */
export interface ComunicacaoDjenDto {
  /** Chave natural — é o que garante idempotência na ingestão. */
  hash: string;
  /** NPU com 20 dígitos. */
  numeroProcesso: string;
  siglaTribunal: string;
  tipoComunicacao: string | null;
  /** Texto livre por tribunal — exibição apenas, nunca regra. */
  tipoDocumento: string | null;
  nomeOrgao: string | null;
  nomeClasse: string | null;
  meio: string | null;
  link: string | null;
  /** Teor integral do ato. */
  texto: string;
  /** ISO (yyyy-mm-dd). */
  dataDisponibilizacao: string;
  destinatarios: DestinatarioDjen[];
  advogados: AdvogadoDjen[];
}

/** Formato bruto de um item devolvido pela API (campos em snake_case misto). */
interface ItemBruto {
  hash?: unknown;
  numero_processo?: unknown;
  siglaTribunal?: unknown;
  tipoComunicacao?: unknown;
  tipoDocumento?: unknown;
  nomeOrgao?: unknown;
  nomeClasse?: unknown;
  meio?: unknown;
  link?: unknown;
  texto?: unknown;
  data_disponibilizacao?: unknown;
  destinatarios?: unknown;
  destinatarioadvogados?: unknown;
}

/**
 * Teto de páginas por consulta.
 *
 * A API devolve `count` saturado em 10000 — não dá para confiar nele como
 * total. A paginação para quando uma página vem vazia; este teto existe só para
 * que um comportamento inesperado do CNJ não prenda o robô num laço infinito.
 */
const MAX_PAGINAS = 20;
const ITENS_POR_PAGINA = 100;

/**
 * LIMITE DE REQUISIÇÕES DO DJEN — medido, não estimado.
 *
 * A API responde com `X-RateLimit-Limit: 20` e `X-RateLimit-Remaining`, e a
 * janela repõe o saldo em ~60 s (verificado: seis chamadas seguidas levaram o
 * saldo de 19 a 14, e um minuto depois ele voltou a 19).
 *
 * Estourar não devolve 429: o CloudFront à frente da API corta com **403**. Foi
 * o que apareceu como "O DJEN retornou HTTP 403" ao clicar em "Buscar no DJEN" —
 * a paginação disparava até 20 chamadas em rajada e consumia a cota inteira
 * numa tacada.
 *
 * O teto local fica ABAIXO do limite real de propósito: o saldo é por IP, e a
 * varredura noturna, o botão da tela e uma segunda réplica da API dividem a
 * mesma cota sem saber uma da outra.
 */
const LIMITE_PADRAO_POR_MINUTO = 14;
const JANELA_MS = 60_000;
/** Abaixo disto, espera a janela virar em vez de gastar o resto do saldo. */
const RESERVA_MINIMA = 2;
/** Tentativas extras quando o CNJ corta por excesso (403/429). */
const MAX_TENTATIVAS = 3;

@Injectable()
export class DjenService {
  private readonly logger = new Logger(DjenService.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly ativa: boolean;
  /** Janela de dias que cada varredura cobre para trás. */
  readonly janelaDias: number;

  /** Teto local de requisições por minuto (fica abaixo do limite real do CNJ). */
  private readonly limitePorMinuto: number;
  /** Instantes das requisições feitas na janela corrente. */
  private readonly historico: number[] = [];
  /**
   * Fila de um: TODA chamada ao DJEN passa por aqui, em série.
   *
   * Sem isto, duas varreduras simultâneas (o robô e alguém clicando no botão)
   * consultariam o mesmo contador ao mesmo tempo, cada uma achando que tem saldo
   * — e as duas estourariam junto.
   */
  private fila: Promise<unknown> = Promise.resolve();
  /** Último saldo informado pelo próprio CNJ (`X-RateLimit-Remaining`). */
  private saldoInformado: number | null = null;

  constructor(private readonly config: ConfigService) {
    this.baseUrl =
      this.config.get<string>('DJEN_BASE_URL') || 'https://comunicaapi.pje.jus.br/api/v1';
    this.timeoutMs = Number(this.config.get('DJEN_TIMEOUT_MS')) || 30_000;
    this.janelaDias = Number(this.config.get('DJEN_JANELA_DIAS')) || 3;
    this.limitePorMinuto =
      Number(this.config.get('DJEN_REQ_POR_MINUTO')) || LIMITE_PADRAO_POR_MINUTO;
    this.ativa = flagLigada(this.config.get<string>('DJEN_INTEGRACAO'));
  }

  /** A integração está ligada? (o Guard das rotas e o cron leem daqui) */
  get integracaoAtiva(): boolean {
    return this.ativa;
  }

  /**
   * Publicações de um advogado, por inscrição na OAB, em todos os tribunais.
   *
   * É a consulta que sustenta a varredura diária: UMA chamada por advogado
   * cobre o país inteiro. Numa verificação real, a busca por uma única OAB
   * devolveu publicações de 22 tribunais distintos (TJPI, TJCE, TRF5, TJSP…).
   * A alternativa — consultar processo a processo — multiplicaria as chamadas
   * pelo tamanho do acervo.
   */
  async buscarPorOab(
    numeroOab: string,
    ufOab: string,
    de: Date,
    ate: Date,
  ): Promise<ComunicacaoDjenDto[]> {
    const oab = (numeroOab || '').replace(/\D/g, '');
    const uf = (ufOab || '').trim().toUpperCase();
    if (!oab || !/^[A-Z]{2}$/.test(uf)) {
      throw new BadRequestException('Informe número da OAB e UF válidos (ex.: 13217 / PI).');
    }
    return this.paginar(
      {
        numeroOab: oab,
        ufOab: uf,
        dataDisponibilizacaoInicio: dataIso(de),
        dataDisponibilizacaoFim: dataIso(ate),
      },
      `OAB ${oab}/${uf}`,
    );
  }

  /**
   * Publicações de UM processo, por NPU.
   *
   * Complementa a varredura por OAB: pega o processo em que a OAB do sindicato
   * não consta do polo — herdado de outro escritório, substabelecimento não
   * lançado no tribunal — e que por isso nunca apareceria na consulta acima.
   */
  async buscarPorProcesso(npu: string): Promise<ComunicacaoDjenDto[]> {
    const numero = (npu || '').replace(/\D/g, '');
    if (numero.length !== 20) {
      throw new BadRequestException('NPU inválido — informe os 20 dígitos do número único (CNJ).');
    }
    return this.paginar({ numeroProcesso: numero }, `NPU ${numero}`);
  }

  // -------------------------------------------------------------------------

  /**
   * Percorre as páginas até esgotar.
   *
   * Para quando a página volta vazia, e NÃO quando atinge `count`: aquele campo
   * satura em 10000 e mentiria sobre o total em qualquer consulta grande.
   */
  private async paginar(
    filtros: Record<string, string>,
    rotulo: string,
  ): Promise<ComunicacaoDjenDto[]> {
    const acumulado: ComunicacaoDjenDto[] = [];

    for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
      const itens = await this.consultar({
        ...filtros,
        pagina: String(pagina),
        itensPorPagina: String(ITENS_POR_PAGINA),
      });
      acumulado.push(...itens);
      if (itens.length < ITENS_POR_PAGINA) break;

      if (pagina === MAX_PAGINAS) {
        this.logger.warn(
          `[DJEN] ${rotulo}: teto de ${MAX_PAGINAS} páginas atingido — pode haver publicação não lida.`,
        );
      }
    }

    // LGPD: contagem e identificador público apenas — nunca o teor.
    this.logger.log(`[DJEN] ${rotulo}: ${acumulado.length} publicação(ões) recebida(s).`);
    return acumulado;
  }

  /**
   * Enfileira a consulta e respeita a cota antes de disparar.
   *
   * Todas as chamadas passam por aqui em SÉRIE. Paralelismo aqui não traria
   * ganho — a cota é por minuto, não por conexão — e traria o 403.
   */
  private consultar(params: Record<string, string>): Promise<ComunicacaoDjenDto[]> {
    const proxima = this.fila.then(() => this.consultarAgora(params));
    // A fila não pode morrer por causa de uma consulta que falhou: o `catch`
    // aqui só a mantém encadeada; o erro segue para quem chamou.
    this.fila = proxima.catch(() => undefined);
    return proxima;
  }

  private async consultarAgora(
    params: Record<string, string>,
    tentativa = 1,
  ): Promise<ComunicacaoDjenDto[]> {
    await this.aguardarCota();

    const url = `${this.baseUrl}/comunicacao?${new URLSearchParams(params).toString()}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      this.historico.push(Date.now());
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      // O CNJ informa o saldo restante a cada resposta — usar o número dele é
      // melhor que confiar só na nossa contagem, que não enxerga outra réplica
      // da API consumindo a mesma cota do mesmo IP.
      const restante = Number(res.headers.get('x-ratelimit-remaining'));
      this.saldoInformado = Number.isFinite(restante) ? restante : null;

      // 403 é como o CloudFront do CNJ corta excesso de requisições — não é
      // falta de permissão. 429 aparece em alguns pontos. Ambos merecem espera
      // e nova tentativa, não uma mensagem de erro para o usuário.
      if ((res.status === 403 || res.status === 429) && tentativa < MAX_TENTATIVAS) {
        clearTimeout(timer);
        const espera = this.esperaAteJanelaVirar();
        this.logger.warn(
          `[DJEN] HTTP ${res.status} (cota excedida) — aguardando ${Math.ceil(espera / 1000)}s ` +
            `e tentando de novo (${tentativa + 1}/${MAX_TENTATIVAS}).`,
        );
        this.historico.length = 0; // a janela vai virar; a contagem antiga não vale mais
        await dormir(espera);
        return this.consultarAgora(params, tentativa + 1);
      }

      if (!res.ok) {
        throw new DjenIndisponivelError(
          res.status === 403 || res.status === 429
            ? 'O DJEN está limitando as consultas no momento (cota por minuto). Tente de novo em um minuto.'
            : `O DJEN retornou HTTP ${res.status}. Tente novamente em instantes.`,
          res.status,
        );
      }

      const json = (await res.json()) as { items?: unknown };
      const itens = Array.isArray(json?.items) ? json.items : [];
      return itens
        .map((i) => this.mapear(i as ItemBruto))
        .filter((c): c is ComunicacaoDjenDto => c !== null);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      const isTimeout = (err as Error)?.name === 'AbortError';
      this.logger.error(
        `[DJEN] Falha na consulta: ${isTimeout ? 'timeout' : (err as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'Não foi possível consultar as publicações do DJEN no momento.',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /** Segura a próxima chamada até haver saldo na janela de um minuto. */
  private async aguardarCota(): Promise<void> {
    const agora = Date.now();
    // Descarta o que saiu da janela.
    while (this.historico.length && agora - this.historico[0] >= JANELA_MS) {
      this.historico.shift();
    }

    // O CNJ disse que está no fim — respeita o número dele, não o nosso.
    if (this.saldoInformado !== null && this.saldoInformado <= RESERVA_MINIMA) {
      const espera = this.esperaAteJanelaVirar();
      this.logger.log(`[DJEN] Saldo do CNJ em ${this.saldoInformado} — pausando ${Math.ceil(espera / 1000)}s.`);
      this.saldoInformado = null;
      this.historico.length = 0;
      await dormir(espera);
      return;
    }

    if (this.historico.length < this.limitePorMinuto) return;

    const espera = this.esperaAteJanelaVirar();
    this.logger.log(`[DJEN] Cota local atingida — pausando ${Math.ceil(espera / 1000)}s.`);
    await dormir(espera);
    return this.aguardarCota();
  }

  /** Quanto falta para a requisição mais antiga sair da janela (+1s de folga). */
  private esperaAteJanelaVirar(): number {
    const maisAntiga = this.historico[0];
    if (!maisAntiga) return JANELA_MS;
    return Math.max(1_000, JANELA_MS - (Date.now() - maisAntiga) + 1_000);
  }

  /**
   * Item bruto → DTO. Devolve `null` para o que não serve.
   *
   * Descarta sem hash, sem texto ou sem NPU de 20 dígitos: sem hash não há
   * idempotência, sem texto a publicação não acrescenta nada ao que o DataJud
   * já dá, e sem NPU não há como casar com processo nenhum.
   */
  private mapear(item: ItemBruto): ComunicacaoDjenDto | null {
    const hash = texto(item.hash);
    // Parte dos tribunais publica o ato em HTML (verificado no TJPI: atos do PJe
    // chegam com <div>, <img> e entidades). Limpar aqui, na entrada, faz o banco
    // guardar o teor já legível — e evita que a tela, a atividade da agenda e o
    // classificador limpem cada um do seu jeito.
    const bruto = texto(item.texto);
    const conteudo = bruto ? limparTextoPublicacao(bruto) : null;
    const numeroProcesso = texto(item.numero_processo)?.replace(/\D/g, '') ?? '';
    const data = texto(item.data_disponibilizacao);

    if (!hash || !conteudo || numeroProcesso.length !== 20 || !data) return null;

    const advogadosBrutos = Array.isArray(item.destinatarioadvogados)
      ? item.destinatarioadvogados
      : [];
    const destinatariosBrutos = Array.isArray(item.destinatarios) ? item.destinatarios : [];

    return {
      hash,
      numeroProcesso,
      siglaTribunal: texto(item.siglaTribunal)?.toUpperCase() ?? 'ND',
      tipoComunicacao: texto(item.tipoComunicacao),
      tipoDocumento: texto(item.tipoDocumento),
      nomeOrgao: texto(item.nomeOrgao),
      nomeClasse: texto(item.nomeClasse),
      meio: texto(item.meio),
      link: texto(item.link),
      texto: conteudo,
      dataDisponibilizacao: data,
      destinatarios: destinatariosBrutos.map((d: any) => ({
        nome: texto(d?.nome),
        polo: texto(d?.polo),
      })),
      // O DJEN aninha o advogado dentro do vínculo (`{advogado: {...}}`).
      advogados: advogadosBrutos.map((a: any) => ({
        nome: texto(a?.advogado?.nome),
        numeroOab: texto(a?.advogado?.numero_oab),
        ufOab: texto(a?.advogado?.uf_oab)?.toUpperCase() ?? null,
      })),
    };
  }
}

/** Campo de texto do JSON, aparado; null quando ausente ou vazio. */
function texto(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

/** Data no formato que a API espera (yyyy-mm-dd). */
function dataIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Pausa simples — usada só para respeitar a cota do CNJ. */
function dormir(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
