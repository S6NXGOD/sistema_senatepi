import { JOB_DJEN_SYNC, comTravaDeJob } from '@core/infra';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OrigemSincronizacao } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

import { DjenService } from './djen.service';
import { DjenSyncService } from './djen-sync.service';
import { FONTE_DJEN, SincronizacaoLogService } from './sincronizacao-log.service';
import { pularJobSemModulo } from '../../tenant/job-do-modulo';

/** A frase da rodada que não aconteceu porque outra detinha a trava. */
export const RODADA_DJEN_PULADA =
  'Rodada pulada: outra varredura do Diário detinha a trava (outra réplica, ou uma varredura pedida à mão ainda correndo).';

/**
 * Robô de publicações do DJEN.
 *
 * POR QUE ÀS 05:00, E NÃO JUNTO COM O DATAJUD
 * Três horas depois da varredura do CNJ, de propósito. As movimentações do dia
 * já entraram, então a correlação tem a que se ligar: quando a publicação chega
 * para um ato que o DataJud já registrou, ela ENRIQUECE a atividade existente
 * em vez de criar uma segunda. Rodando junto, a ordem seria disputa de sorte.
 *
 * Cadência igual à do DataJud (2–3s entre chamadas): a API do DJEN não devolveu
 * 429 em rajada curta na verificação, mas é infraestrutura pública compartilhada
 * e não há razão para descobrir o limite dela em produção.
 */
@Injectable()
export class DjenCronService {
  private readonly logger = new Logger(DjenCronService.name);
  private readonly DELAY_MIN = 2000;
  private readonly DELAY_MAX = 3000;
  /**
   * Prazo da trava.
   *
   * A duração da rodada é LIMITADA por construção: a cota do CNJ é de 20
   * requisições por minuto e o serviço se segura em 14. Refeita em 14/09/2026,
   * quando a rodada passou a ler o histórico e a janela por número:
   *
   *   OAB ............ 8 advogados × até 20 páginas ........... 160 requisições
   *   histórico ...... 200 processos × até 10 páginas ......... 2.000
   *   número/janela .. 300 processos × até 3 páginas ........... 900
   *
   * O CASO REAL é uma página por consulta, e cada processo é lido UMA vez por
   * noite (quem teve o histórico lido sai da janela). Medido em 14/09/2026 com a
   * simulação contra a produção: 153 processos vivos, 153 chamadas de histórico,
   * nenhum no teto de páginas. Refeita a conta em 15/09/2026: a primeira noite
   * troca a janela desses 153 pelo histórico e fica em ~13 minutos; a noite
   * normal, em ~170–185 chamadas, uns 12 a 14 minutos a 14 por minuto.
   *
   * O PIOR CASO TEÓRICO NÃO CABE: com tudo no teto são ~3.060 requisições, uns
   * 220 minutos. O que importa é que a trava JAMAIS expire com a rodada
   * correndo, porque aí duas passariam a disputar a mesma cota. Quem garante
   * isso desde 15/09/2026 é o orçamento de tempo da própria rodada
   * (`DJEN_ORCAMENTO_DA_RODADA_MIN`, 150 minutos): as consultas por número param
   * ali, e o resto fica para a noite seguinte. Quem mexer no TTL mexe no
   * orçamento junto.
   */
  private readonly TRAVA_TTL_MIN = 180;

  constructor(
    private readonly prisma: PrismaService,
    private readonly djen: DjenService,
    private readonly sync: DjenSyncService,
    private readonly logSync: SincronizacaoLogService,
  ) {}

  @Cron('0 5 * * *', { name: 'djen-sync', timeZone: 'America/Fortaleza' })
  async sincronizarPublicacoes() {
    if (pularJobSemModulo('processos', this.logger, 'DJEN-SYNC')) return;
    if (!this.djen.integracaoAtiva) return;

    const rodada = await comTravaDeJob(
      this.prisma,
      JOB_DJEN_SYNC,
      this.logger,
      { ttlMinutos: this.TRAVA_TTL_MIN },
      async () => {
        const inicio = Date.now();
        try {
          await this.sync.varrer(() => this.aguardar());
          this.logger.log(
            `[DJEN-SYNC] Concluído em ${Math.round((Date.now() - inicio) / 1000)}s.`,
          );
        } catch (err) {
          this.logger.error(`[DJEN-SYNC] Erro na varredura: ${(err as Error).message}`);
        }
      },
    );

    /*
      A RODADA PULADA TAMBÉM DEIXA LINHA — antes era um warn só no stdout.

      Com a trava agora também na rota manual, pular às 05:00 passou a ter um
      motivo corriqueiro: a colheita de histórico pedida à mão ainda correndo.
      Essa grava o próprio resumo (origem MANUAL), mas sem esta linha a noite do
      robô some do log e "foi pulada" fica igual a "não rodou". Sucesso, porque
      a varredura aconteceu — só não foi esta.
    */
    if (!rodada.executou) {
      await this.logSync.registrar({
        fonte: FONTE_DJEN,
        origem: OrigemSincronizacao.CRON,
        processoId: null,
        numeroCNJ: null,
        sucesso: true,
        novasMovimentacoes: 0,
        mensagemErro: RODADA_DJEN_PULADA,
      });
    }
  }

  /** Espera aleatória entre DELAY_MIN e DELAY_MAX para suavizar as rajadas. */
  private aguardar(): Promise<void> {
    const ms = this.DELAY_MIN + Math.floor(Math.random() * (this.DELAY_MAX - this.DELAY_MIN + 1));
    return new Promise((r) => setTimeout(r, ms));
  }
}
