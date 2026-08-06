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

@Injectable()
export class DjenService {
  private readonly logger = new Logger(DjenService.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly ativa: boolean;
  /** Janela de dias que cada varredura cobre para trás. */
  readonly janelaDias: number;

  constructor(private readonly config: ConfigService) {
    this.baseUrl =
      this.config.get<string>('DJEN_BASE_URL') || 'https://comunicaapi.pje.jus.br/api/v1';
    this.timeoutMs = Number(this.config.get('DJEN_TIMEOUT_MS')) || 30_000;
    this.janelaDias = Number(this.config.get('DJEN_JANELA_DIAS')) || 3;
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

  private async consultar(params: Record<string, string>): Promise<ComunicacaoDjenDto[]> {
    const url = `${this.baseUrl}/comunicacao?${new URLSearchParams(params).toString()}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new DjenIndisponivelError(
          `O DJEN retornou HTTP ${res.status}. Tente novamente em instantes.`,
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
