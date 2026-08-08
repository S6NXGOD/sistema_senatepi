import {
  BadRequestException, HttpException, Injectable, Logger, NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { apenasDigitosCnpj, cnpjValido, formatarCnpj } from '../../common/utils/cnpj.util';
import { DadosCnpj } from './dto/empresa.dto';
import { tenant } from '../../tenant/tenant.config';

/** Resposta da BrasilAPI (só o que consumimos; ela devolve muito mais). */
interface RespostaBrasilApi {
  cnpj?: string;
  razao_social?: string;
  nome_fantasia?: string;
  cep?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  descricao_situacao_cadastral?: string;
}

/**
 * Consulta de CNPJ na BrasilAPI (https://brasilapi.com.br/api/cnpj/v1/{cnpj}).
 *
 * Serviço externo, público e gratuito: pode ficar fora do ar, aplicar limite de
 * requisições ou demorar. Por isso TODA falha vira uma exceção HTTP com
 * mensagem em português — quem chama nunca recebe erro cru — e o cadastro
 * manual continua possível na tela.
 */
@Injectable()
export class BrasilApiService {
  private readonly logger = new Logger(BrasilApiService.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: ConfigService) {
    this.baseUrl =
      this.config.get<string>('BRASILAPI_URL') ?? 'https://brasilapi.com.br/api/cnpj/v1';
    this.timeoutMs = Number(this.config.get('BRASILAPI_TIMEOUT_MS')) || 12_000;
  }

  /**
   * Busca e normaliza os dados de um CNPJ.
   * O dígito verificador é conferido ANTES da chamada: erro de digitação não
   * gasta requisição no serviço externo nem faz o usuário esperar o timeout.
   */
  async consultar(cnpjEntrada: string): Promise<Omit<DadosCnpj, 'jaCadastrada'>> {
    const cnpj = apenasDigitosCnpj(cnpjEntrada);

    if (cnpj.length !== 14) {
      throw new BadRequestException('O CNPJ deve ter 14 dígitos.');
    }
    if (!cnpjValido(cnpj)) {
      throw new BadRequestException(
        `CNPJ ${formatarCnpj(cnpj)} é inválido — confira os números digitados.`,
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/${cnpj}`, {
        // A BrasilAPI responde 403 para requisições sem User-Agent.
        headers: { 'User-Agent': `${tenant.sigla}/1.0`, Accept: 'application/json' },
        signal: controller.signal,
      });

      // 400 e 404 significam a mesma coisa na prática: a Receita não tem esse CNPJ.
      if (res.status === 404 || res.status === 400) {
        throw new NotFoundException(
          `CNPJ ${formatarCnpj(cnpj)} não foi encontrado na base da Receita Federal.`,
        );
      }
      if (res.status === 429) {
        throw new ServiceUnavailableException(
          'Muitas consultas de CNPJ em pouco tempo. Aguarde um instante e tente de novo.',
        );
      }
      if (!res.ok) {
        this.logger.warn(`[BRASILAPI] HTTP ${res.status} ao consultar CNPJ ${cnpj}`);
        throw new ServiceUnavailableException(
          'A consulta de CNPJ está indisponível no momento. Você pode preencher os dados manualmente.',
        );
      }

      const j = (await res.json()) as RespostaBrasilApi;
      if (!j?.razao_social) {
        throw new NotFoundException(
          `CNPJ ${formatarCnpj(cnpj)} não retornou dados cadastrais.`,
        );
      }

      this.logger.log(`[BRASILAPI] CNPJ ${cnpj} consultado com sucesso`);
      return {
        cnpj,
        razaoSocial: this.texto(j.razao_social) ?? '',
        nomeFantasia: this.texto(j.nome_fantasia),
        cep: j.cep ? j.cep.replace(/\D/g, '') : null,
        logradouro: this.texto(j.logradouro),
        numero: this.texto(j.numero),
        complemento: this.texto(j.complemento),
        bairro: this.texto(j.bairro),
        cidade: this.texto(j.municipio),
        uf: this.texto(j.uf)?.toUpperCase() ?? null,
        situacao: this.texto(j.descricao_situacao_cadastral),
      };
    } catch (err) {
      // As exceções já tratadas acima sobem como estão.
      if (err instanceof HttpException) throw err;
      const timeout = (err as Error)?.name === 'AbortError';
      this.logger.error(
        `[BRASILAPI] Falha ao consultar CNPJ ${cnpj}: ${timeout ? 'timeout' : (err as Error).message}`,
      );
      throw new ServiceUnavailableException(
        timeout
          ? 'A consulta de CNPJ demorou demais para responder. Tente de novo ou preencha os dados manualmente.'
          : 'Não foi possível consultar o CNPJ agora. Você pode preencher os dados manualmente.',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /** Campos vazios da BrasilAPI vêm como '' — viram null para não poluir o cadastro. */
  private texto(v: string | undefined | null): string | null {
    const t = (v ?? '').trim();
    return t.length ? t : null;
  }
}
