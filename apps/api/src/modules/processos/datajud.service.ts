import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * DatajudService — cliente da API Pública do DATAJUD (CNJ).
 *
 * LGPD (Lei nº 13.709/2018): a API Pública do DATAJUD retorna apenas METADADOS
 * PROCESSUAIS PÚBLICOS (classe, assunto, órgão julgador, movimentações). Ela NÃO
 * expõe dados pessoais das partes. Por isso:
 *  - os logs registram somente o NPU (dado público) e o tribunal — nunca dados
 *    pessoais;
 *  - o mapeamento descarta qualquer campo que porventura pudesse conter dado
 *    pessoal, guardando apenas metadados de interesse jurídico.
 */

export interface MovimentacaoDatajud {
  dataMovimento: string; // ISO
  descricao: string;
  codigoMovimento: number | null;
}

export interface ProcessoDatajud {
  numeroCNJ: string; // 20 dígitos
  tribunal: string | null;
  classeProcessual: string | null;
  assuntoPrincipal: string | null;
  orgaoJulgador: string | null;
  grau: string | null;
  dataDistribuicao: string | null; // ISO
  valorCausa: number | null;
  /** Público não traz nomes das partes (LGPD) — mantido por contrato, quase sempre vazio. */
  partes: string[];
  movimentacoes: MovimentacaoDatajud[];
}

@Injectable()
export class DatajudService {
  private readonly logger = new Logger(DatajudService.name);
  private readonly baseUrl = 'https://api-publica.datajud.cnj.jus.br';
  private readonly apiKey: string;
  private readonly timeoutMs = 15_000;

  constructor(private readonly config: ConfigService) {
    // Header exata da API Pública do DATAJUD (configurável por ambiente).
    this.apiKey = this.config.get<string>(
      'DATAJUD_API_KEY',
      'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==',
    );
  }

  /** Alias/índice do tribunal no DATAJUD (ex.: TJPI → api_publica_tjpi). */
  private aliasTribunal(sigla: string): string {
    const s = (sigla || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!s) throw new BadRequestException('Informe a sigla do tribunal (ex.: TJPI, TRT22, TRF1).');
    return `api_publica_${s}`;
  }

  /**
   * Consulta um processo pelo NPU (número único do CNJ) no índice do tribunal.
   * A busca é um POST com query Elasticsearch (match em `numeroProcesso`).
   * Retorna metadados normalizados ou `null` quando não encontrado.
   */
  async buscarProcessoPorNPU(npu: string, siglaTribunal: string): Promise<ProcessoDatajud | null> {
    const numero = (npu || '').replace(/\D/g, '');
    if (numero.length !== 20) {
      throw new BadRequestException('NPU inválido — informe os 20 dígitos do número único (CNJ).');
    }
    const alias = this.aliasTribunal(siglaTribunal);
    const url = `${this.baseUrl}/${alias}/_search`;

    // LGPD: log apenas com dado público (NPU + tribunal), sem nada pessoal.
    this.logger.log(`[DATAJUD] Consultando NPU ${numero} em ${alias}`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `APIKey ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: { match: { numeroProcesso: numero } } }),
        signal: controller.signal,
      });

      if (!res.ok) {
        this.logger.warn(`[DATAJUD] HTTP ${res.status} ao consultar ${alias} (NPU ${numero})`);
        throw new ServiceUnavailableException(
          `O DATAJUD retornou HTTP ${res.status}. Tente novamente em instantes.`,
        );
      }

      const json = (await res.json()) as { hits?: { hits?: Array<{ _source?: unknown }> } };
      const fonte = json?.hits?.hits?.[0]?._source as Record<string, any> | undefined;
      if (!fonte) {
        this.logger.log(`[DATAJUD] Nenhum resultado para NPU ${numero} em ${alias}`);
        return null;
      }

      const processo = this.mapear(fonte, numero);
      this.logger.log(`[DATAJUD] NPU ${numero}: ${processo.movimentacoes.length} movimentação(ões) recebidas`);
      return processo;
    } catch (err) {
      // Erros HTTP tratados acima são repropagados; o resto vira 503 amigável.
      if (err instanceof HttpException) throw err;
      const isTimeout = (err as Error)?.name === 'AbortError';
      this.logger.error(
        `[DATAJUD] Falha ao consultar ${alias} (NPU ${numero}): ${isTimeout ? 'timeout' : (err as Error).message}`,
      );
      throw new ServiceUnavailableException('Não foi possível consultar o DATAJUD (CNJ) no momento.');
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Normaliza datas do DATAJUD para ISO-8601 (ou `null` se inválida).
   * O CNJ costuma devolver datas ISO (`2018-05-10T00:00:00.000Z`), mas também
   * aparecem formatos compactos (`yyyyMMddHHmmss` / `yyyyMMdd`). Aceitamos ambos
   * para que uma data mal-formada nunca chegue como `Invalid Date` no Prisma.
   */
  private parseData(v: unknown): string | null {
    if (v == null) return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString();
    const s = String(v).trim();
    if (!s) return null;
    if (/^\d{14}$/.test(s)) {
      const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}Z`;
      const d = new Date(iso);
      return isNaN(d.getTime()) ? null : d.toISOString();
    }
    if (/^\d{8}$/.test(s)) {
      const d = new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00Z`);
      return isNaN(d.getTime()) ? null : d.toISOString();
    }
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  /**
   * Extrai apenas o essencial da resposta (gigante) do Elasticsearch.
   * NÃO copia dados pessoais — só metadados processuais públicos.
   */
  private mapear(src: Record<string, any>, numeroFallback: string): ProcessoDatajud {
    const assuntos: any[] = Array.isArray(src.assuntos) ? src.assuntos : [];
    const principal = assuntos.find((a) => a?.principal) ?? assuntos[0];
    const movimentos: any[] = Array.isArray(src.movimentos) ? src.movimentos : [];

    return {
      numeroCNJ: src.numeroProcesso ? String(src.numeroProcesso).replace(/\D/g, '') : numeroFallback,
      tribunal: src.tribunal ?? null,
      classeProcessual: src.classe?.nome ?? null,
      assuntoPrincipal: principal?.nome ?? null,
      orgaoJulgador: src.orgaoJulgador?.nome ?? null,
      grau: src.grau ?? null,
      dataDistribuicao: this.parseData(src.dataAjuizamento),
      valorCausa: typeof src.valorCausa === 'number' ? src.valorCausa : null,
      // A API pública não traz nomes das partes (LGPD); mantemos vazio por padrão.
      partes: [],
      movimentacoes: movimentos
        .map((m) => ({
          dataMovimento: this.parseData(m?.dataHora),
          descricao: m?.nome ?? null,
          codigoMovimento: typeof m?.codigo === 'number' ? m.codigo : null,
        }))
        .filter((m): m is MovimentacaoDatajud => !!m.dataMovimento && !!m.descricao)
        .sort((a, b) => new Date(b.dataMovimento).getTime() - new Date(a.dataMovimento).getTime()),
    };
  }
}
