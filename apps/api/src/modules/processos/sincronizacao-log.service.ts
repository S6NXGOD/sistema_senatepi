import { Injectable, Logger } from '@nestjs/common';
import { OrigemSincronizacao } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DatajudIndisponivelError } from './datajud.service';

/** Com quem falamos. `origem` é outra coisa: quem disparou a chamada. */
export const FONTE_DATAJUD = 'DATAJUD';
export const FONTE_DJEN = 'DJEN';

export interface EntradaLogSync {
  processoId?: string | null;
  numeroCNJ: string;
  tribunal?: string | null;
  /** Omitido = DATAJUD, que era a única fonte quando esta tabela nasceu. */
  fonte?: string;
  origem: OrigemSincronizacao;
  sucesso: boolean;
  httpStatus?: number | null;
  mensagemErro?: string | null;
  novasMovimentacoes?: number;
  duracaoMs?: number | null;
}

/**
 * Trilha das chamadas às APIs externas do módulo (`logs_sincronizacao_datajud`).
 *
 * Existe para responder, na manhã seguinte, "o robô rodou? o que falhou e por
 * quê?" — separando rate limit (429) de tribunal fora do ar (5xx). Desde a
 * integração do DJEN a mesma tabela guarda as duas fontes, distinguidas pela
 * coluna `fonte`; o nome da tabela ficou pelo histórico.
 *
 * LGPD: grava só metadado público (NPU, sigla do tribunal) e a mensagem técnica.
 * NUNCA grava o teor de publicação — o texto do DJEN traz nome das partes.
 * O log NUNCA derruba a operação principal: falha ao registrar é engolida.
 */
@Injectable()
export class SincronizacaoLogService {
  private readonly logger = new Logger(SincronizacaoLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async registrar(e: EntradaLogSync): Promise<void> {
    try {
      await this.prisma.logSincronizacaoDatajud.create({
        data: {
          processoId: e.processoId ?? null,
          numeroCNJ: e.numeroCNJ,
          tribunal: e.tribunal ?? null,
          fonte: e.fonte ?? FONTE_DATAJUD,
          origem: e.origem,
          sucesso: e.sucesso,
          httpStatus: e.httpStatus ?? null,
          mensagemErro: e.mensagemErro?.slice(0, 500) ?? null,
          novasMovimentacoes: e.novasMovimentacoes ?? 0,
          duracaoMs: e.duracaoMs ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(`Falha ao gravar log de sincronização: ${(err as Error).message}`);
    }
  }

  /** Extrai o status HTTP de origem quando o erro veio do próprio CNJ. */
  statusDe(err: unknown): number | null {
    return err instanceof DatajudIndisponivelError ? err.statusUpstream : null;
  }

  /** Últimas execuções (para uma futura tela de diagnóstico). */
  listarRecentes(limite = 50, fonte?: string) {
    return this.prisma.logSincronizacaoDatajud.findMany({
      where: fonte ? { fonte } : undefined,
      orderBy: { createdAt: 'desc' },
      take: limite,
      select: {
        id: true, numeroCNJ: true, tribunal: true, fonte: true, origem: true,
        sucesso: true, httpStatus: true, mensagemErro: true,
        novasMovimentacoes: true, duracaoMs: true, createdAt: true,
      },
    });
  }
}
