import { JOB_DATAJUD_SYNC, comTravaDeJob } from '@core/infra';
import { valeTentarDeNovo } from './utils/cota-do-cnj.util';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OrigemSincronizacao } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

import { AudienciasService } from './audiencias.service';
import { ProcessosService } from './processos.service';
import { FONTE_DATAJUD, SincronizacaoLogService } from './sincronizacao-log.service';
import { pularJobSemModulo } from '../../tenant/job-do-modulo';
import { integracaoAtiva } from '../../tenant/tenant.config';

/**
 * O QUE ACONTECEU NUMA RODADA DO DATAJUD — a matéria-prima da linha de resumo.
 *
 * `pulada` é a rodada que não começou porque outra detinha a trava.
 */
export type RodadaDatajud =
  | { pulada: true }
  | {
      pulada?: false;
      /** Processos que a varredura se propôs a consultar. */
      elegiveis: number;
      ok: number;
      comNovas: number;
      novas: number;
      falhas: number;
      /**
       * Processos que ficaram sem consulta. Entram primeiro na noite seguinte,
       * porque a fila ordena pela leitura mais antiga.
       */
      naoConsultados?: number;
      /**
       * POR QUE a rodada parou antes de varrer tudo — e nunca "deu a hora".
       *
       * Até 03/11/2026 a única resposta possível era o relógio, e a frase dizia
       * isso. Hoje a rodada só para quando a fonte parou de atender: a mensagem
       * precisa carregar o motivo, porque "ficaram 60 para amanhã" sem motivo
       * manda a equipe procurar defeito onde não há.
       */
      porqueParou?: string | null;
      /** Mensagem do erro que interrompeu a rodada, ou null. */
      quebrou: string | null;
    };

/**
 * A LINHA DE RESUMO DA RODADA DO DATAJUD — rodou, rodou sem alvo, foi pulada.
 *
 * O DataJud era a única rotina externa sem linha por rodada: gravava uma linha
 * por PROCESSO, e só. Uma noite com a trava ocupada ("pulando esta rodada", um
 * warn que ia só para o stdout) ou sem processo elegível passava sem linha
 * nenhuma, e o painel só estranhava o silêncio dois dias úteis depois
 * (auditoria dos robôs, 13/09/2026). DJEN e SICONFI já gravavam; isto devolve a
 * simetria, e as três respostas deixam de ser o mesmo buraco no log.
 *
 * PULADA É SUCESSO, e de propósito. Depois que a releitura da tela ganhou trava
 * própria, quem pode deter `datajud-sync` às 02:00 é outra réplica fazendo a
 * mesma varredura — a noite não se perdeu. Gravar falha empurraria a fonte para
 * INSTÁVEL por uma varredura que aconteceu.
 *
 * Função pura: o texto é o que alguém lê ao investigar, então é testado com
 * valores, não com `toContain` no fonte.
 */
export function linhaDeResumoDatajud(r: RodadaDatajud): {
  sucesso: boolean;
  mensagemErro: string;
  novasMovimentacoes: number;
} {
  if (r.pulada) {
    return {
      sucesso: true,
      novasMovimentacoes: 0,
      mensagemErro:
        'Rodada pulada: outra varredura do DataJud detinha a trava (outra réplica rodando, ou uma rodada interrompida há menos de 3 horas).',
    };
  }
  const tentativas = r.ok + r.falhas;
  if (r.quebrou) {
    return {
      sucesso: false,
      novasMovimentacoes: r.novas,
      mensagemErro: `Rodada interrompida: ${r.quebrou} (${tentativas} de ${r.elegiveis} processo(s) consultado(s) antes da quebra).`,
    };
  }
  if (r.elegiveis === 0) {
    return {
      sucesso: true,
      novasMovimentacoes: 0,
      mensagemErro: 'Rodada sem alvo: nenhum processo elegível para consulta.',
    };
  }
  // Tentou tudo e nada voltou: não é "rodou". É o CNJ, a rede ou a cota.
  if (tentativas > 0 && r.falhas === tentativas) {
    return {
      sucesso: false,
      novasMovimentacoes: 0,
      mensagemErro: `Rodada sem resposta: as ${tentativas} consulta(s) falharam.`,
    };
  }
  const novidades = `${r.comNovas} com novidade (${r.novas} movimentação(ões) nova(s))`;
  /*
    QUEM FICOU PARA A PRÓXIMA NOITE APARECE NA LINHA — e não só no stdout do
    Railway, que tem retenção própria. Sem esta frase, uma rodada cortada pelo
    tempo seria indistinguível de uma rodada curta, e o número que explica a
    fila atrasada viveria só no log do contêiner.
  */
  const ficaram = r.naoConsultados
    ? `, ${r.naoConsultados} ficaram para a próxima noite (${r.porqueParou ?? 'a rodada parou antes'})`
    : '';
  return {
    sucesso: true,
    novasMovimentacoes: r.novas,
    mensagemErro:
      r.falhas > 0
        ? `Rodada concluída com ${r.falhas} de ${tentativas} consulta(s) em falha; ${r.ok} processo(s) consultado(s), ${novidades}${ficaram}.`
        : `Rodada concluída: ${r.ok} processo(s) consultado(s), ${novidades}${ficaram}.`,
  };
}

/**
 * Robô de sincronização do DATAJUD.
 *
 * Roda de madrugada (02:00) e varre todos os processos ATIVOS, atualizando o
 * cache local com as novas movimentações — de forma silenciosa (sem auditoria
 * por processo) para não poluir o histórico.
 *
 * Rate limit do CNJ: a API Pública é compartilhada e sensível a rajadas; por
 * isso há um DELAY de 2–3s entre cada consulta e as falhas são isoladas
 * (um processo que der erro não interrompe a varredura).
 */
/** Por quantos dias o log de sincronização é guardado. Ver `podarLogAntigo`. */
const DIAS_DE_LOG = 90;

@Injectable()
export class ProcessosCronService {
  private readonly logger = new Logger(ProcessosCronService.name);
  private readonly DELAY_MIN = 2000;
  private readonly DELAY_MAX = 3000;
  /** Processa em lotes pequenos, com respiro entre eles (fila leve). */
  private readonly TAMANHO_LOTE = 10;
  private readonly PAUSA_ENTRE_LOTES = 5000;
  /**
   * Quanto esperar antes de repetir quem levou 429.
   *
   * A cota do CNJ é por minuto; um minuto inteiro é o menor intervalo que
   * garante que a janela virou. Numa rodada de madrugada, sessenta segundos não
   * custam nada — e é a diferença entre o processo ser lido hoje ou daqui a
   * oito dias, se ele estiver na faixa lenta.
   */
  private readonly PAUSA_APOS_COTA = 60_000;
  /*
   * O TETO DA REPESCAGEM SAIU — 03/11/2026.
   *
   * Eram 40 processos, e a justificativa escrita aqui era: "a rodada, que já
   * leva 2h, encostaria no cron do DJEN das 05h". Essa razão morreu no dia em
   * que o Diário passou a ESPERAR a vez em vez de começar no horário.
   *
   * E o teto custava leitura de verdade. Medido na produção, 45 noites:
   *
   *   noites em que ele mordeu .................... 4
   *   processos sem segunda chance por causa dele . 100
   *   as noites .................................... 29/10 (41), 23/10 (35),
   *                                                  28/10 (23), 17/10 (1)
   *
   * São as MESMAS noites lentas em que o orçamento de tempo cortaria a
   * varredura: o teto, como ele, só agia quando mais doía. E esses 100 não
   * falharam por defeito deles — levaram 429 ou timeout, que quer dizer
   * "tente daqui a pouco", e nunca tiveram o daqui a pouco.
   *
   * Hoje quem põe fim no pior caso é a saúde da fonte
   * (`RECUSAS_SEGUIDAS_PARA_PARAR`), e ela é melhor em dois sentidos: a fila
   * nunca passa do que o laço principal aceitou enfileirar antes de desistir,
   * e a repescagem consulta a mesma régua antes de cada tentativa. Teto por
   * contagem jogava processo fora com o CNJ respondendo bem.
   */
  /**
   * O ORÇAMENTO DE TEMPO DA RODADA, em minutos (29/10/2026).
   *
   * A rodada do DataJud começa às 02h de Teresina; a do DJEN, às 05h. Não
   * havia nada impedindo a primeira de passar da segunda — e passou:
   *
   *   22/10  05:00 → 05:46 ( 46 min)   0% de falha
   *   25/10  05:00 → 06:23 ( 83 min)   4%
   *   27/10  05:00 → 06:58 (118 min)   7%
   *   23/10  05:00 → 08:27 (207 min)  38%   ← invadiu o DJEN
   *   28/10  05:00 → 08:17 (197 min)  28%, e 63% DEPOIS das 08h
   *   29/10  05:00 → 08:28 (208 min)  37%
   *
   * (horários em UTC; 08:00 UTC = 05:00 em Teresina)
   *
   * Os três dias em que ela passou das 05h são os três com mais falha. A cota
   * do CNJ é por endereço de saída e os dois robôs saem pelo mesmo: quando
   * correm juntos, disputam entre si o que já é escasso — e o 429 de um é
   * pago pelo outro.
   *
   * 150 minutos era a mesma régua do DJEN, e terminava 04h30, com meia hora de
   * folga antes dele.
   *
   * ──────────────────────────────────────────────────────────────────────────
   * 03/11/2026 — O RELÓGIO DEIXOU DE MANDAR NA RODADA.
   *
   * Decisão do dono, e ela corrige um erro meu: *"mesmo que estoure o teto,
   * com tanto que não esteja dando problema mesmo na API, nem que estoure o
   * horário, mas continue para que nenhum processo e atualização fique de
   * fora"*.
   *
   * O orçamento existia para o DataJud não invadir as 05:00 do Diário. Essa
   * razão morreu quando o Diário passou a ESPERAR a vez em vez de começar no
   * horário: hoje não há nada a proteger às 05:00, e o corte só faz perder
   * leitura.
   *
   * E ele era uma armadilha dormente. Medido na produção em 45 noites:
   *
   *   noites em que o corte disparou ............. ZERO
   *   rodadas desde que ele entrou (30/10) ....... 92, 94, 95, 99 e 110 min
   *   noites ruins de outubro .................... 197, 207 e 208 min
   *   consulta ao CNJ em 28 e 29/10 .............. 149s e 160s de MÉDIA
   *   consulta ao CNJ em 03/11 ................... 33s
   *
   * Ou seja: nas noites normais ele nunca age, e nas noites em que o CNJ fica
   * lento — as únicas em que agiria — ele cortaria a varredura em ~60 dos 160
   * processos. O corte só aparece quando mais dói, e abandona 100 processos
   * para proteger uma janela que não existe mais.
   *
   * NO LUGAR DELE, DUAS PERGUNTAS DE SAÚDE (ver `RECUSAS_SEGUIDAS_PARA_PARAR`
   * e `LIMITE_ABSOLUTO_MIN`): a rodada segue enquanto o CNJ estiver
   * atendendo, por mais que demore, e só desiste quando ele para de atender.
   *
   * ISTO NÃO CONSERTA A LENTIDÃO, e é importante dizer: a consulta leva ~58s
   * pelo Railway contra 9–20s medidos do Brasil, com a MESMA chave e o MESMO
   * processo. A causa é a rota, e o conserto dela é `DATAJUD_BASE_URL`
   * apontando para a ponte brasileira que o DJEN já usa.
   */
  /**
   * QUANTAS RECUSAS SEGUIDAS DO CNJ ENCERRAM A RODADA.
   *
   * "Recusa" aqui é `valeTentarDeNovo` — cota estourada ou demora além do
   * teto. É a família de falha que fala da FONTE; "tribunal desconhecido" ou
   * "número inválido" falam do processo e não contam, porque nesses casos o
   * CNJ respondeu.
   *
   * Qualquer sucesso zera a conta: o que encerra a rodada é a fonte ter
   * parado, não ter tropeçado.
   *
   * VINTE E CINCO saiu da medição, e com folga. A maior sequência de falhas
   * seguidas em 45 noites foi **10** (10/10), depois 9 e 8 — todas em noites
   * que terminaram bem. Vinte e cinco é duas vezes e meia o pior caso real,
   * então ruído não dispara. O que dispara é o que aconteceu com o Diário em
   * 02 e 03/11: **168 de 168 consultas recusadas**, as duas noites inteiras
   * gastas batendo numa porta fechada.
   */
  private readonly RECUSAS_SEGUIDAS_PARA_PARAR = Number(
    process.env.DATAJUD_RECUSAS_SEGUIDAS,
  ) || 25;
  /**
   * Trava de segurança, não orçamento: nenhuma rodada pode encostar na do dia
   * seguinte.
   *
   * O pior caso plausível é o acervo inteiro na velocidade mais lenta já
   * medida — 160 processos a 160s dão ~7 horas. Vinte horas é quase o triplo
   * disso e ainda deixa 4 horas antes das 02:00 seguintes. Se este número for
   * alcançado, não é lentidão: é laço preso, e aí parar é o certo.
   */
  private readonly LIMITE_ABSOLUTO_MIN = Number(
    process.env.DATAJUD_LIMITE_ABSOLUTO_MIN,
  ) || 20 * 60;
  /**
   * Validade da trava. A varredura leva ~5s por processo (2–3s de espera + a
   * consulta, que o CNJ responde em 10–25s nos casos ruins); 3h dão folga larga
   * sobre o acervo atual sem chegar perto do intervalo de 24h entre execuções.
   */
  /**
   * O TTL NÃO MEDE MAIS A DURAÇÃO DA RODADA — 03/11/2026.
   *
   * Eram 180 minutos, e expiravam no meio da própria varredura: medido em 30
   * noites, mediana 101min, p90 197min, **máximo 208min**. Em três noites (23,
   * 28 e 29/10) a rodada passou do prazo da trava e a linha ficou livre para
   * outra réplica varrer o acervo em paralelo — o dobro de chamadas ao CNJ.
   *
   * A primeira correção foi subir para 240. Era aposta: a duração não é nossa,
   * é a velocidade do CNJ naquela noite — 149 e 160 segundos por consulta em
   * 28 e 29/10, contra 33 em 03/11. A 150 segundos, 160 processos passam de
   * SEIS HORAS, e nenhum número fixo cobre isso sem ficar absurdo.
   *
   * Agora a trava **bate o ponto** a cada minuto enquanto o job vive, então
   * `expira_em` significa "este job está vivo", não "chutei que dura tanto".
   * O prazo passou a medir só uma coisa: **quanto silêncio basta para dar a
   * rodada por morta**. Quarenta e cinco minutos é curto o bastante para a vez
   * sair rápido quando o contêiner cai no meio da madrugada, e 45 batidas de
   * folga sobre o intervalo de renovação.
   */
  private readonly TRAVA_TTL_MIN = 45;

  constructor(
    private readonly prisma: PrismaService,
    private readonly processos: ProcessosService,
    private readonly audiencias: AudienciasService,
    private readonly logSync: SincronizacaoLogService,
  ) {}

  @Cron('0 2 * * *', { name: 'datajud-sync', timeZone: 'America/Fortaleza' })
  async sincronizarAtivos() {
    if (pularJobSemModulo('processos', this.logger, 'DATAJUD-SYNC')) return;
    if (!integracaoAtiva('datajud', process.env.DATAJUD_INTEGRACAO)) {
      // Instalação com acervo jurídico mas sem consulta ao CNJ: os processos
      // existem e são editados à mão, e a varredura noturna simplesmente não
      // acontece. Em `debug` porque, ali, isso é o esperado todo dia.
      this.logger.debug('[DATAJUD-SYNC] Integração não faz parte desta instalação.');
      return;
    }

    // Trava no banco, e não em memória: com duas réplicas da API, dois
    // booleanos de instância valeriam `false` ao mesmo tempo e as duas varreriam
    // o acervo em paralelo — o dobro de chamadas ao CNJ.
    const rodada = await comTravaDeJob(
      this.prisma,
      JOB_DATAJUD_SYNC,
      this.logger,
      { ttlMinutos: this.TRAVA_TTL_MIN },
      () => this.varrer(),
    );
    // A rodada que não começou também fica no log — ver `linhaDeResumoDatajud`.
    if (!rodada.executou) await this.registrarRodada({ pulada: true }, 0);

    // Depois da varredura, e fora da trava: se a poda falhar, o que importa
    // (a sincronização) já aconteceu.
    await this.podarLogAntigo().catch((e) =>
      this.logger.warn(`[DATAJUD-SYNC] Falha ao podar o log: ${(e as Error).message}`),
    );
  }

  /**
   * PODA DO LOG DE SINCRONIZAÇÃO — a única tabela que este sistema apaga sozinho.
   *
   * Medido em 04/09/2026: o banco inteiro tem 48 MB e não corre risco nenhum.
   * O que cresce sem freio é telemetria: 1.176 linhas de log em 31 dias, ~14 mil
   * por ano. Não é urgente; é o tipo de coisa que ninguém lembra de olhar e que
   * em três anos vira a maior tabela do banco por nada.
   *
   * O QUE NÃO É PODADO, e de propósito:
   *
   *  - `auditorias` — é a trilha de quem fez o quê. Num sistema jurídico ela é
   *    prova, não sujeira. Some só se alguém decidir que some, à mão.
   *  - `importacao_linhas` — 7.550 linhas de conferência de importações já
   *    concluídas. Parece lixo e é histórico de uma migração de acervo; apagar
   *    por conta própria tiraria a chance de auditar de onde veio cada processo.
   *  - `comunicacoes_djen` e `movimentacoes_processuais` — são o acervo.
   *
   * Noventa dias cobrem qualquer investigação de "por que o robô parou", que é
   * a única pergunta que este log responde. O painel de saúde olha as últimas
   * 48 horas.
   */
  private async podarLogAntigo() {
    const corte = new Date(Date.now() - DIAS_DE_LOG * 24 * 3_600_000);
    const { count } = await this.prisma.logSincronizacaoDatajud.deleteMany({
      where: { createdAt: { lt: corte } },
    });
    if (count) this.logger.log(`[DATAJUD-SYNC] ${count} log(s) com mais de ${DIAS_DE_LOG} dias removido(s).`);
  }

  private async varrer() {
    const inicio = Date.now();
    // Fora do `try`: a linha de resumo do `finally` precisa do que já foi
    // contado mesmo quando a rodada quebra no meio.
    const rodada = {
      elegiveis: 0, ok: 0, comNovas: 0, novas: 0, falhas: 0, naoConsultados: 0,
      porqueParou: null as string | null,
      /** Quantos voltaram na segunda tentativa depois de um 429. */
      recuperados: 0,
      quebrou: null as string | null,
    };
    /** Os que levaram 429: a cota era de outro, e eles merecem uma segunda vez. */
    const paraTentarDeNovo: string[] = [];

    /*
      A RODADA PARA PELA SAÚDE DA FONTE, NUNCA PELO RELÓGIO — 03/11/2026.

      Enquanto o CNJ responde, ela segue, por mais que a noite ande. O que a
      encerra é ele ter parado de atender: aí cada chamada seguinte é certeza
      de falha, e insistir 100 vezes só enche o log de ruído e atrasa a
      próxima tentativa, que é amanhã de qualquer jeito.
    */
    /** Recusas da FONTE, seguidas. Qualquer resposta boa zera. */
    let recusasSeguidas = 0;
    const aFonteParouDeAtender = () =>
      recusasSeguidas >= this.RECUSAS_SEGUIDAS_PARA_PARAR;
    const passouDoLimiteAbsoluto = () =>
      Date.now() - inicio > this.LIMITE_ABSOLUTO_MIN * 60_000;
    /** O motivo para parar agora, ou `null` para continuar. */
    const motivoParaParar = (): string | null => {
      if (aFonteParouDeAtender()) {
        return `o CNJ recusou ${recusasSeguidas} consultas seguidas`;
      }
      if (passouDoLimiteAbsoluto()) {
        return `a rodada passou de ${Math.round(this.LIMITE_ABSOLUTO_MIN / 60)} horas`;
      }
      return null;
    };

    try {
      // Ativos E pendentes: um processo recém-cadastrado (PENDENTE) também
      // precisa receber os andamentos até ser formalizado.
      const ids = await this.processos.idsParaSincronizar();
      rodada.elegiveis = ids.length;
      const totalLotes = Math.ceil(ids.length / this.TAMANHO_LOTE);
      this.logger.log(
        `[DATAJUD-SYNC] Iniciando varredura de ${ids.length} processo(s) ativo(s)/pendente(s) ` +
          `em ${totalLotes} lote(s) de até ${this.TAMANHO_LOTE}…`,
      );

      for (let inicioLote = 0; inicioLote < ids.length; inicioLote += this.TAMANHO_LOTE) {
        /*
          A PARADA É ENTRE LOTES, e não no meio de um. Cortar no meio deixaria
          o lote pela metade sem que o log dissesse onde parou; entre lotes o
          corte é limpo e custa, no pior caso, os dez do lote em curso.
        */
        const motivo = motivoParaParar();
        if (motivo) {
          rodada.naoConsultados = ids.length - inicioLote;
          rodada.porqueParou = motivo;
          this.logger.warn(
            `[DATAJUD-SYNC] Rodada encerrada porque ${motivo}: ` +
              `${rodada.naoConsultados} processo(s) ficaram para a próxima noite — ` +
              'eles entram primeiro, porque a fila ordena pela leitura mais antiga.',
          );
          break;
        }
        const lote = ids.slice(inicioLote, inicioLote + this.TAMANHO_LOTE);
        const numeroLote = Math.floor(inicioLote / this.TAMANHO_LOTE) + 1;

        // Dentro do lote, as chamadas são SEQUENCIAIS com 2–3s entre elas.
        // Paralelizar aqui seria justamente o que estoura o rate limit do CNJ.
        for (let i = 0; i < lote.length; i++) {
          const id = lote[i];
          try {
            const { novas } = await this.processos.ressincronizarSilencioso(id);
            rodada.ok++;
            recusasSeguidas = 0;
            if (novas > 0) {
              rodada.comNovas++;
              rodada.novas += novas;
              this.logger.log(`[DATAJUD-SYNC] Processo ${id}: ${novas} nova(s) movimentação(ões).`);
            }
          } catch (err) {
            rodada.falhas++;
            /*
              SÓ A RECUSA DA FONTE CONTA. `valeTentarDeNovo` é cota ou demora:
              o CNJ não atendeu. "Tribunal desconhecido" e "número inválido"
              são defeito DAQUELE processo, e nesses casos o CNJ respondeu —
              zerar aqui é o que impede um punhado de processos ruins de
              passar por "a fonte caiu".
            */
            if (valeTentarDeNovo(err)) recusasSeguidas++;
            else recusasSeguidas = 0;
            // Isola a falha (rate limit, CNJ fora do ar, tribunal desconhecido).
            // O motivo detalhado já foi para `logs_sincronizacao_datajud`.
            this.logger.warn(`[DATAJUD-SYNC] Falha no processo ${id}: ${(err as Error).message}`);
            /*
              A REPESCAGEM DEIXOU DE SER SÓ DO 429 (10/10/2026).

              Ela nasceu para a cota, que é "a vez foi de outro". O timeout
              é a mesma natureza — "agora não dá" — e, com a mediana do CNJ
              em 31s contra um teto de 45s, virou o motivo de falha MAIS
              COMUM: 103 das 210 falhas em 12 dias. Esses ficavam de fora da
              fila e perdiam a noite inteira, até cruzar as 48h e virar
              alarme na tela — foram 10 processos assim em 10/10.

              E a segunda tentativa FUNCIONA: medido no fim das últimas
              rodadas, 17 de 19, 13 de 16, 18 de 20 e 28 de 28 deram certo.
            */
            /*
              SEM TETO DE CONTAGEM (03/11/2026). A fila já é limitada por
              construção: ela só cresce enquanto o laço principal segue, e o
              laço principal desiste quando a fonte para de atender. Um teto
              de 40 em cima disso jogava fora 100 processos em 45 noites, todos
              por "tente daqui a pouco" — e nenhum deles teve o daqui a pouco.
            */
            if (valeTentarDeNovo(err)) paraTentarDeNovo.push(id);
          }
          if (i < lote.length - 1) await this.aguardar();
        }

        this.logger.log(`[DATAJUD-SYNC] Lote ${numeroLote}/${totalLotes} concluído.`);
        // Respiro entre lotes — mantém o servidor e o CNJ folgados.
        if (inicioLote + this.TAMANHO_LOTE < ids.length) {
          await new Promise((r) => setTimeout(r, this.PAUSA_ENTRE_LOTES));
        }
      }

      /*
        O 429 NÃO É DEFEITO DO PROCESSO — é a vez de outro (24/09/2026).

        O dono perguntou se valia espaçar as chamadas ou dividir a varredura em
        duas janelas. MEDIDO antes de decidir, e a medição derrubou as duas
        ideias:

          ritmo real da varredura ..... 1 a 2 chamadas por MINUTO
          cota do CNJ ................. 20 por minuto
          429 em 24/09 ................ 9 de 169 (5,3%)
          429 nos 8 dias anteriores ... ZERO

        Não somos nós que estouramos a cota: estamos a um décimo dela. O 429 veio
        de fora — o IP do Railway é compartilhado, e naquela manhã alguém mais
        gastou a cota antes. Espaçar mais só alongaria a rodada sem ganhar nada,
        e dividir em duas janelas DOBRARIA a exposição ao começo de rodada, que
        é justamente onde os 429 caíram.

        O que faltava era simples: 429 quer dizer "tente daqui a pouco", e a
        rodada nunca tentava. Estes voltam UMA vez, no fim, com um respiro maior
        — custa segundos numa rodada de madrugada e devolve o dia de atualização
        que aqueles processos perderam por um motivo que não era deles.

        Uma vez só, de propósito: se a cota ainda estiver estourada na segunda
        tentativa, insistir vira parte do problema.

        10/10/2026: A FILA DEIXOU DE SER SÓ DO 429. O timeout entrou, e com ele
        a maior parte da clientela — a mediana do CNJ subiu de 0,9s (agosto)
        para 31s, e o nosso teto de 45s passou a cortar resposta boa. Ver
        `ehDemoraDoCnj` em `cota-do-cnj.util`, onde a medição está escrita.
      */
      if (paraTentarDeNovo.length) {
        this.logger.log(
          `[DATAJUD-SYNC] ${paraTentarDeNovo.length} processo(s) ficaram sem resposta do CNJ ` +
            '(cota ou demora); tentando de novo uma vez, no fim da rodada.',
        );
        await new Promise((r) => setTimeout(r, this.PAUSA_APOS_COTA));
        for (let i = 0; i < paraTentarDeNovo.length; i++) {
          /*
            A REPESCAGEM SEGUE A MESMA RÉGUA DO LAÇO PRINCIPAL: ela para se o
            CNJ tiver parado de atender, e não porque deu a hora. Ela existe
            justamente para o caso "a cota era de outro" — insistir enquanto a
            fonte responde é o ponto dela; insistir depois que a fonte fechou
            é só gastar madrugada.
          */
          const motivo = motivoParaParar();
          if (motivo) {
            rodada.naoConsultados += paraTentarDeNovo.length - i;
            rodada.porqueParou = motivo;
            this.logger.warn(
              `[DATAJUD-SYNC] Repescagem encerrada porque ${motivo}: ` +
                `${paraTentarDeNovo.length - i} processo(s) ficaram para a próxima noite.`,
            );
            break;
          }
          const id = paraTentarDeNovo[i];
          try {
            const { novas } = await this.processos.ressincronizarSilencioso(id);
            rodada.ok++;
            rodada.falhas--;
            rodada.recuperados++;
            recusasSeguidas = 0;
            if (novas > 0) {
              rodada.comNovas++;
              rodada.novas += novas;
            }
          } catch (err) {
            if (valeTentarDeNovo(err)) recusasSeguidas++;
            else recusasSeguidas = 0;
            this.logger.warn(
              `[DATAJUD-SYNC] ${id} falhou de novo depois da cota: ${(err as Error).message}`,
            );
          }
          if (i < paraTentarDeNovo.length - 1) await this.aguardar();
        }
      }

      this.logger.log(
        `[DATAJUD-SYNC] Concluído em ${Math.round((Date.now() - inicio) / 1000)}s — ` +
          `${rodada.ok} sincronizado(s), ${rodada.comNovas} com novidades (${rodada.novas} mov.), ` +
          `${rodada.falhas} falha(s)` +
          (rodada.recuperados ? `, ${rodada.recuperados} recuperado(s) da cota` : '') +
          '.',
      );
    } catch (err) {
      rodada.quebrou = (err as Error).message;
      this.logger.error(`[DATAJUD-SYNC] Erro na varredura: ${rodada.quebrou}`);
    } finally {
      // Grava até quando quebra — a mesma garantia que o DJEN já dava.
      await this.registrarRodada(rodada, Date.now() - inicio);
    }

    // Radar de audiências: as movimentações novas já entraram classificadas.
    // Este número é o que a equipe vai ver no painel pela manhã — alertas
    // dispensados NÃO voltam, porque a dispensa mora na própria movimentação
    // e a sincronização só insere movimentações ausentes.
    // Fora do `try` da varredura: contar o radar é leitura de conveniência, e
    // um erro nela não pode ficar gravado como "rodada interrompida".
    try {
      const pendentes = await this.audiencias.contarPendentes();
      this.logger.log(`[RADAR-AUDIENCIAS] ${pendentes} audiência(s) aguardando agendamento.`);
    } catch (err) {
      this.logger.warn(`[RADAR-AUDIENCIAS] Não deu para contar: ${(err as Error).message}`);
    }
  }

  /**
   * Uma linha por rodada em `logs_sincronizacao_datajud`, sem processo e sem NPU:
   * ela fala da RODADA. Quem conta "processos sincronizados" por linha do
   * DataJud precisa ignorar `processo_id IS NULL AND numero_cnj IS NULL`.
   */
  private async registrarRodada(rodada: RodadaDatajud, duracaoMs: number) {
    await this.logSync.registrar({
      fonte: FONTE_DATAJUD,
      origem: OrigemSincronizacao.CRON,
      processoId: null,
      numeroCNJ: null,
      duracaoMs,
      ...linhaDeResumoDatajud(rodada),
    });
  }

  /** Espera aleatória entre DELAY_MIN e DELAY_MAX para suavizar as rajadas. */
  private aguardar(): Promise<void> {
    const ms = this.DELAY_MIN + Math.floor(Math.random() * (this.DELAY_MAX - this.DELAY_MIN + 1));
    return new Promise((r) => setTimeout(r, ms));
  }
}
