import { JOB_DATAJUD_SYNC, JOB_DJEN_SYNC, comTravaDeJob } from '@core/infra';
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
   * 220 minutos. O que importava era a trava JAMAIS expirar com a rodada
   * correndo, porque aí duas passariam a disputar a mesma cota — e quem
   * garantia isso era o orçamento de tempo da rodada, que resolvia o problema
   * da trava CORTANDO A LEITURA no meio.
   *
   * 03/11/2026: NÃO É MAIS O TTL QUE PRECISA COBRIR A DURAÇÃO. A trava se
   * renova a cada minuto enquanto o job vive, então ela só expira quando o job
   * morre de verdade. Quarenta e cinco minutos é o silêncio que basta para dar
   * a rodada por morta — curto o suficiente para o DataJud da noite seguinte
   * não encontrar trava velha, e 45 vezes a folga da batida de um minuto.
   */
  private readonly TRAVA_TTL_MIN = 45;

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
      {
        ttlMinutos: this.TRAVA_TTL_MIN,
        /*
          O DIÁRIO ESPERA O DATAJUD TERMINAR — 03/11/2026.

          Os dois puxam da MESMA cota do CNJ (20 consultas por minuto, serial e
          compartilhada por IP), e em 3 das 30 noites medidas o DataJud ainda
          estava rodando às 05:00: 207, 197 e 208 minutos, contra 101 de
          mediana. As duas rodadas disputando é a origem dos 38% de 429 que já
          custaram uma colheita inteira.

          ESPERAR, E NÃO PULAR (`cedeA`): pular a vez de um cron diário é
          perder a noite, e o Diário publica em D+0 — é o dado que vira prazo.
          Começar 40 minutos mais tarde não custa nada; não começar, custa.

          O TETO ERA DE 90 MINUTOS E ESTAVA ERRADO. Estourado, o Diário
          começava JUNTO com o DataJud — exatamente a sobreposição que este
          bloco existe para impedir. O dono apontou o desenho certo no mesmo
          dia: *"a prioridade é CNJ e DataJud e depois os outros. Mesmo que
          estoure o teto, nem que estoure o horário, mas continue para que
          nenhum processo e atualização fique de fora"*.

          Então ele ESPERA o quanto for preciso. Nas noites ruins de outubro a
          consulta ao CNJ levou 149 e 160 segundos em média (contra 33 em
          03/11): 160 processos a esse ritmo são mais de seis horas, e um teto
          de 90 minutos jogaria o Diário de volta para cima do DataJud na
          única noite em que isso dói. Começar às 09:00 lendo tudo é melhor que
          começar às 06:30 e brigar por cota.

          As dez horas abaixo não são orçamento: a trava bate o ponto a cada
          minuto, então ela só fica vigente enquanto o DataJud está VIVO. Se o
          DataJud cair, a linha expira em 45 minutos e a vez sai sozinha. Dez
          horas é a desconfiança de uma trava que se renova sem o job andar.
        */
        esperaPor: JOB_DATAJUD_SYNC,
        esperaMaxMinutos: 600,
      },
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
