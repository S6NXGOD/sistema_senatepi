import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrigemSincronizacao, Prisma, StatusProcesso } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CorrelacaoService } from './correlacao.service';
import {
  ComunicacaoDjenDto,
  DjenService,
  PAGINAS_DO_NUMERO_NA_JANELA,
  type LeituraDjen,
} from './djen.service';
import { DatajudService } from './datajud.service';
import { instanciaBaixada } from './utils/audiencia.util';
import { FONTE_DJEN, SincronizacaoLogService } from './sincronizacao-log.service';
import { classificarProvidencia } from './utils/providencia.util';
import { nossoPoloNoAto, type PoloDetectado } from './utils/acao-nossa.util';
import { chaveOab, separarAdvogadosDoAto } from './utils/advogados-do-ato.util';
import { VinculoDeAdvogadoService } from './vinculo-de-advogado.service';
import { PartesDoDiarioService } from './partes-do-diario.service';
import {
  DIAS_RECHECAGEM_DORMENTE,
  DORMENTES,
  STATUS_VIVOS,
} from './utils/varredura.util';
import {
  coberturaDoDiario,
  colunaDateDoDia,
  diaDaColunaDate,
  DJEN_HISTORICO_MAX_PAGINAS_PADRAO,
  DJEN_HISTORICO_POR_RODADA_PADRAO,
  DJEN_ORCAMENTO_DA_RODADA_MIN,
  DJEN_TETO_RECUPERACAO_DIAS,
  faltaNaOab,
  inteiroDoAmbiente,
  janelaDaOab,
  janelaDoNumero,
  oabConsultavel,
  passouDoOrcamento,
  podeCarimbar,
  type CoberturaDoDiario,
} from './utils/djen-leitura.util';
import { anotarReserva } from '../agenda/equipe.util';
import { diaBR, noveDaManhaBR, proximoHorarioUtilBR } from './utils/data-br.util';
import { NpuUtils } from './utils/npu.util';
import { fecharTarefaDeCadastro } from './utils/tarefa-de-cadastro.util';
import { CaixaDePropostasService } from './caixa-de-propostas.service';

/**
 * Até quando uma ação do Diário ainda merece virar TAREFA de cadastro.
 *
 * Trinta dias — a mesma régua da correlação (`JANELA_DIAS`) e do robô de
 * prazos, e pela mesma razão: mais velho que isso, a tarefa nasce como eco.
 * Medido em 07/09/2026: das 30 sugestões pendentes, 7 estão nesta janela. As
 * outras 23 continuam na fila da tela, que é coletiva e não cobra ninguém.
 */
const DIAS_PARA_AGENDAR_CADASTRO = 30;

/** Como o polo aparece na descrição da tarefa — frase, não sigla. */
const POLO_NA_TAREFA: Record<string, string> = {
  ATIVO: 'Ação movida pelo sindicato',
  PASSIVO: 'Ação movida CONTRA o sindicato',
  AMBOS: 'O sindicato está nos dois polos',
  INDEFINIDO: 'Ação do sindicato (polo não informado no ato)',
};

/** Resumo de uma varredura, para o log e para a rota manual. */
/**
 * A FRAÇÃO DE CONSULTAS EM FALHA A PARTIR DA QUAL A RODADA NÃO É SUCESSO.
 *
 * ERA 100% — `falhas === tentativas` — e foi assim que a produção registrou
 * como BEM-SUCEDIDA, em 20/09/2026, uma rodada com "159 de 165 consulta(s) em
 * falha". Com a rodada marcada OK, a faixa de saúde não acendeu, e no dia
 * seguinte o dono clicou em "Buscar agora" e recebeu "Busca concluída — nada
 * novo no Diário" de uma varredura em que NENHUMA das 165 consultas respondeu.
 *
 * Um quarto é folgado dos dois lados: nos dez dias anteriores ao incidente, o
 * número normal de falhas por rodada foi ZERO — então não há alarme falso a
 * temer — e ainda assim ele pega qualquer queda que deixe a leitura
 * incompleta a ponto de ninguém poder confiar no silêncio.
 */
export const FRACAO_DE_FALHA_QUE_REPROVA = 0.25;

export interface ResumoVarreduraDjen {
  advogadosConsultados: number;
  processosConsultados: number;
  recebidas: number;
  /** Publicações gravadas (as repetidas são ignoradas pelo hash único). */
  ingeridas: number;
  /** Descartadas por não haver processo cadastrado com aquele NPU. */
  descartadas: number;
  /**
   * Advogados ATIVOS sem OAB no cadastro — invisíveis para a varredura.
   *
   * A busca é por OAB: sem o número, a pessoa não entra na consulta e as
   * intimações dela nunca chegam. Fica no resumo porque é uma falha que, de
   * outro modo, se manifesta como silêncio.
   */
  advogadosSemOab: number;
  /**
   * Das descartadas, quantas eram AÇÕES NOSSAS ainda sem cadastro.
   *
   * Fica no resumo porque é o único lugar onde o volume aparece: a publicação
   * de terceiro não é persistida, e sem este número ninguém saberia dizer se a
   * detecção está achando alguma coisa.
   */
  sugeridas: number;
  falhas: number;
  /**
   * POR QUE ELAS FALHARAM — a contagem por mensagem, do mais frequente.
   *
   * As mensagens de erro de cada consulta iam só para o `logger` do Nest, que
   * no Railway tem retenção própria: a linha que sobrava no BANCO dizia "as 165
   * consulta(s) falharam" e não dizia por quê. Quem lê a faixa precisa saber se
   * é o CNJ fora do ar, se é a ponte brasileira caída ou se é cota — três
   * problemas com três donos diferentes.
   */
  motivosDeFalha?: Record<string, number>;
  /**
   * Consultas que pararam no teto de páginas, pelo rótulo público (OAB ou NPU).
   *
   * Bater no teto era só um `warn` no stdout do Railway, que tem retenção
   * própria: não dava para provar pelo banco que nenhuma consulta encostou
   * nele. Agora vai para a FRENTE da linha de resumo, e a data de leitura
   * daquela consulta não avança (14/09/2026).
   */
  consultasNoTeto: string[];
  /** Maior quantidade de itens que UMA consulta devolveu. Perto de 100 × páginas é teto. */
  maiorRecebidaPorConsulta: number;
  /** Processos cujo histórico foi lido inteiro pelo número e carimbado nesta rodada. */
  historicosLidos: number;
  /**
   * Processos que ficaram sem consulta porque a rodada passou do orçamento de
   * tempo (`DJEN_ORCAMENTO_DA_RODADA_MIN`), contados uma vez só mesmo que
   * estivessem nas duas passadas (15/09/2026). Entram primeiro na noite seguinte.
   */
  processosParadosPorTempo: number;
  /**
   * Etapas finais que quebraram e foram puladas, com o motivo curto.
   *
   * As seis etapas depois da ingestão rodavam em fila, sem proteção entre
   * elas: um `findMany` com o banco instável em "ligar advogados" interrompia
   * a varredura, e a rede de prazo (`escalarEsquecidas`) não rodava — a etapa
   * que protege prazo dependia de todas as anteriores (auditoria dos robôs,
   * 13/09/2026). Agora cada etapa falha sozinha, e a falha vai para
   * `mensagemErro` da linha de resumo: engolir sem gravar esconderia o defeito.
   */
  etapasComFalha: string[];
}

/**
 * Varredura e ingestão das publicações do DJEN.
 *
 * ESTRATÉGIA — varre por OAB, ingere só o que já está cadastrado
 *
 * A consulta por OAB é o transporte eficiente: uma chamada por advogado traz as
 * publicações de todos os tribunais (verificado: 22 siglas distintas numa única
 * consulta). Consultar processo a processo custaria uma chamada por item do
 * acervo, todo dia.
 *
 * Mas o que a API devolve é a carteira INTEIRA daquele advogado, e o sindicato
 * acompanha o próprio acervo — não os processos particulares de quem trabalha
 * nele. Então tudo que não casa com um `Processo.numeroCNJ` cadastrado é
 * DESCARTADO na ingestão: não vira linha, não guarda texto, não guarda parte,
 * não guarda OAB. Fica só a contagem no log, para que o volume seja visível sem
 * que o dado de terceiro seja persistido.
 *
 * CONSULTA POR NÚMERO — o que ACOMPANHA o acervo (reescrito em 14/09/2026).
 *
 * A OAB serve para DESCOBRIR: ação nova, carteira do país inteiro numa chamada.
 * Quem acompanha o processo cadastrado é o número. Antes era o contrário: o
 * número só consultava quem estava 30 dias sem nenhuma publicação gravada, e a
 * primeira publicação achada tirava o processo da consulta por 30 dias. O ato
 * dirigido à parte, o edital e o do advogado de fora chegavam com até 30 dias
 * de atraso, e o que passava disso virava FORA_DA_JANELA sem tarefa nenhuma.
 *
 * Agora são três passadas, nesta ordem:
 *  1. OAB de cada advogado ativo, desde o dia anterior à última leitura boa
 *     (`users.djen_lido_ate`), com teto de 60 dias.
 *  2. HISTÓRICO pelo número, uma vez por processo (`djen_historico_lido_em`
 *     nulo), sem filtro de data, os mais recentes no sistema primeiro.
 *  3. O número de todo processo vivo, toda noite, de `ultima_consulta_djen − 3
 *     dias` até hoje; os dormentes a cada 7 dias.
 */
@Injectable()
export class DjenSyncService {
  private readonly logger = new Logger(DjenSyncService.name);

  /**
   * A JANELA DE TAREFA, em dias — o que é mais velho que isto só é classificado.
   *
   * Chamava-se `DIAS_SEM_PUBLICACAO` porque também decidia quem entrava na
   * consulta por número ("sem publicação em 30 dias"). Essa trava saiu em
   * 14/09/2026; sobrou o uso que ela sempre teve na correlação e no rótulo: a
   * mesma régua de `CorrelacaoService.JANELA_DIAS`. Um ato do histórico com mais
   * de 30 dias recebe FORA_DA_JANELA e nunca vira tarefa nem proposta.
   */
  private readonly DIAS_DA_JANELA_DE_TAREFA = 30;

  /** Quantos processos têm o histórico lido pelo número por noite (`DJEN_HISTORICO_POR_RODADA`). */
  private readonly historicoPorRodada: number;
  /** Até quantas páginas cada leitura de histórico lê (`DJEN_HISTORICO_MAX_PAGINAS`). */
  private readonly historicoMaxPaginas: number;

  /**
   * Teto de processos consultados um a um por rodada.
   *
   * A cota do CNJ é de 20 requisições por minuto, e o serviço se segura em 14.
   * Sem teto, a lista cresceria com o acervo até a rodada passar do prazo da
   * trava do job — e duas execuções começariam a se sobrepor.
   *
   * 300 por noite, até 3 páginas cada. Na produção de 15/09/2026 são ~150
   * processos vivos, uma página cada: uns 11 minutos a 14 por minuto. Como a
   * ordem é "quem foi consultado há mais tempo primeiro", uma rodada cortada
   * (pelo teto ou pelo orçamento de tempo) recomeça pela fatia que ficou para
   * trás. Ajustável por ambiente.
   */
  private readonly maxProcessosPorRodada: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly djen: DjenService,
    private readonly logSync: SincronizacaoLogService,
    private readonly correlacao: CorrelacaoService,
    private readonly datajud: DatajudService,
    private readonly caixa: CaixaDePropostasService,
    private readonly vinculoDeAdvogado: VinculoDeAdvogadoService,
    private readonly partesDoDiario: PartesDoDiarioService,
  ) {
    this.maxProcessosPorRodada =
      Number(this.config.get('DJEN_MAX_PROCESSOS_POR_RODADA')) || 300;
    /*
      OS DOIS TETOS DA COLHEITA DE HISTÓRICO VÊM DO AMBIENTE (14/09/2026).

      A simulação contra a produção ainda estava contando quantos atos essa
      colheita traria quando isto foi escrito. O número certo sai dela, e
      ajustar precisa ser variável e restart, não deploy. Zero em
      `DJEN_HISTORICO_POR_RODADA` desliga a colheita.
    */
    this.historicoPorRodada = inteiroDoAmbiente(
      this.config.get('DJEN_HISTORICO_POR_RODADA'),
      DJEN_HISTORICO_POR_RODADA_PADRAO,
      { min: 0, max: 1_000 },
    );
    this.historicoMaxPaginas = inteiroDoAmbiente(
      this.config.get('DJEN_HISTORICO_MAX_PAGINAS'),
      DJEN_HISTORICO_MAX_PAGINAS_PADRAO,
      { min: 1, max: 50 },
    );
  }

  /**
   * Varredura completa: OAB de cada advogado ativo + complemento por NPU.
   *
   * `aguardar` é injetado pelo chamador para que a cadência (e o respiro entre
   * chamadas) fique com o cron, que é quem conhece o rate limit — e para que a
   * rota manual possa rodar sem espera.
   */
  /**
   * A VARREDURA, com a garantia de deixar rastro até quando quebra.
   *
   * O resumo é gravado num `finally`: se `varrer` estourar no meio — banco
   * fora, correlação com defeito — a rodada teria acontecido e o log ficaria
   * vazio, e a tela diria "não rodou" sobre uma rodada que rodou e explodiu.
   * Seria trocar um diagnóstico errado por outro.
   */
  /**
   * ANOTA POR QUE UMA CONSULTA FALHOU — e guarda a CLASSE do erro, não o texto.
   *
   * "Falha na OAB 9226/PI: ..." e "Falha na OAB 3311/PI: ..." são o mesmo
   * problema com dois rótulos; contadas separadas, nenhuma seria a maioria e a
   * linha do log não diria nada. O número da OAB e o NPU saem da chave.
   */
  private anotarFalha(resumo: ResumoVarreduraDjen, err: unknown) {
    const cru = (err as Error)?.message ?? 'erro desconhecido';
    const classe = cru
      .replace(/\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/g, "NPU")
      .replace(/\b\d{3,7}\/?[A-Z]{0,2}\b/g, "N")
      .slice(0, 160);
    resumo.motivosDeFalha = resumo.motivosDeFalha ?? {};
    resumo.motivosDeFalha[classe] = (resumo.motivosDeFalha[classe] ?? 0) + 1;
  }

  async varrer(
    aguardar: () => Promise<void> = async () => {},
    origem: OrigemSincronizacao = OrigemSincronizacao.CRON,
    /**
     * JANELA ALARGADA DA OAB, PARA UMA VARREDURA ÚNICA.
     *
     * A rodada diária olha 3 dias pela OAB (`DJEN_JANELA_DIAS`), o que basta
     * para o acervo: o processo cadastrado é lido pelo número toda noite, desde
     * a última consulta, e o histórico dele é lido UMA vez, sem filtro de data
     * (as passadas 2 e 3 de `executarVarredura`, desde 14/09/2026).
     *
     * Só que ação NOVA — a que ainda não está no acervo — só pode ser descoberta
     * pela busca por OAB, e essa é limitada pela janela. Um processo do sindicato
     * distribuído há dois meses e que não publicou nos últimos três dias é
     * invisível para sempre.
     *
     * Isto existe para essa colheita: uma passada larga pela OAB que traz o que
     * já estava lá. Não é para virar rotina — a rodada de 3 dias absorve fim de
     * semana e feriado, e alargar todo dia só gastaria cota reprocessando o que
     * o `hash` único já vai descartar.
     */
    diasDeHistorico?: number,
  ): Promise<ResumoVarreduraDjen> {
    const iniciadaEm = Date.now();
    const resumo: ResumoVarreduraDjen = {
      advogadosConsultados: 0,
      processosConsultados: 0,
      recebidas: 0,
      ingeridas: 0,
      descartadas: 0,
      sugeridas: 0,
      advogadosSemOab: 0,
      falhas: 0,
      consultasNoTeto: [],
      maiorRecebidaPorConsulta: 0,
      historicosLidos: 0,
      processosParadosPorTempo: 0,
      etapasComFalha: [],
    };
    let quebrou: string | null = null;
    try {
      await this.executarVarredura(resumo, aguardar, diasDeHistorico);
    } catch (err) {
      quebrou = (err as Error).message;
      throw err;
    } finally {
      await this.registrarResumo(resumo, origem, iniciadaEm, quebrou);
    }
    return resumo;
  }

  private async executarVarredura(
    resumo: ResumoVarreduraDjen,
    aguardar: () => Promise<void>,
    diasDeHistorico?: number,
  ): Promise<void> {
    // O relógio do orçamento de tempo (15/09/2026): começa com a rodada.
    const iniciadaEm = Date.now();
    /*
      O DIA DE HOJE É O DE TERESINA, calculado uma vez para a rodada inteira.

      A janela saía de `new Date() - dias` convertida com `toISOString`, que é o
      dia de Greenwich. Às 05:00 dá o mesmo dia; a varredura pedida à mão às
      22h pedia "a partir de amanhã" e perdia um dia. Todas as janelas e todos
      os carimbos desta rodada partem deste texto.
    */
    const hoje = diaBR(new Date());
    /*
      O TETO DE 180 DIAS não é timidez: a busca por OAB devolve a carteira
      INTEIRA do advogado, e medimos ~113 publicações por dia somando os oito.
      Meio ano seriam ~20 mil itens, ~200 páginas, uns 15 minutos de cota — e o
      que passa disso quase nunca é ação "nova".
    */
    const dias = diasDeHistorico
      ? Math.min(180, Math.max(1, Math.floor(diasDeHistorico)))
      : this.djen.janelaDias;
    if (diasDeHistorico) {
      this.logger.log(`[DJEN-SYNC] Varredura de HISTÓRICO: ${dias} dias de publicações.`);
    }

    // ---- 1) Por OAB de cada advogado ativo ----
    const advogados = await this.advogadosConsultaveis();

    /*
      ADVOGADO SEM OAB É INVISÍVEL PARA O DIÁRIO — e a falha era silenciosa.

      A varredura consulta POR OAB: quem não tem o número no cadastro simplesmente
      não entra na lista acima. As publicações que intimam essa pessoa nunca
      chegam, o sino dela nunca acende, e nada na tela sugere que falta algo —
      ausência de alerta parece calma.

      Medido em 07/09/2026: a Dra. Lara Cortez é ADVOGADA ativa, tem 2 processos
      vinculados e está sem OAB. Dois processos cujo prazo não é anunciado. A
      regra de quem conta e a de OAB vazia estão em `advogadosSemOab`.
    */
    const semOab = await this.advogadosSemOab();
    if (semOab.length) {
      resumo.advogadosSemOab = semOab.length;
      this.logger.warn(
        `[DJEN] ${semOab.length} advogado(s) SEM OAB no cadastro — o Diário não é ` +
          `consultado para: ${semOab.map((a) => a.nome).join(', ')}. ` +
          'Preencha OAB e UF na ficha para que as intimações deles cheguem.',
      );
    }

    for (const adv of advogados) {
      /*
        A JANELA SE RECUPERA SOZINHA (14/09/2026).

        Lê desde o dia anterior à última leitura boa desta OAB, com teto de 60
        dias. O carimbo só avança quando a leitura foi inteira — sem falha no
        meio e sem bater no teto de páginas —, e aí a noite seguinte volta aos
        3 dias de sempre. Com falha ou teto, a data fica e a próxima noite relê
        o período; o `hash` único descarta o que já tinha entrado.
      */
      const janela = janelaDaOab(hoje, diaDaColunaDate(adv.djenLidoAte), {
        sobreposicao: dias,
        teto: DJEN_TETO_RECUPERACAO_DIAS,
      });
      if (janela.recuperando) {
        this.logger.log(
          `[DJEN-SYNC] OAB ${adv.oabUf} ${adv.oab}: recuperando leitura atrasada, ` +
            `${janela.dias} dia(s) desde ${janela.de}` +
            `${janela.cortadaNoTeto ? ` (atraso maior que ${DJEN_TETO_RECUPERACAO_DIAS} dias; os anteriores ficaram de fora)` : ''}.`,
        );
      }
      try {
        const leitura = await this.djen.lerPorOab(adv.oab!, adv.oabUf!, janela.de, janela.ate);
        const r = await this.ingerir(leitura.itens, OrigemSincronizacao.CRON);
        this.somarLeitura(resumo, leitura, r);
        if (podeCarimbar(leitura)) {
          await this.prisma.user.update({
            where: { id: adv.id },
            data: { djenLidoAte: colunaDateDoDia(janela.ate) },
          });
        }
        if (leitura.interrompidaPor) {
          resumo.falhas++;
          this.logger.warn(
            `[DJEN-SYNC] OAB ${adv.oabUf} ${adv.oab} lida pela metade: ${leitura.interrompidaPor}`,
          );
        } else {
          resumo.advogadosConsultados++;
        }
      } catch (err) {
        resumo.falhas++;
        this.anotarFalha(resumo, err);
        // Isola a falha: um advogado com OAB inválida não pode derrubar a
        // varredura dos demais.
        this.logger.warn(
          `[DJEN-SYNC] Falha na OAB ${adv.oab}/${adv.oabUf}: ${(err as Error).message}`,
        );
      }
      await aguardar();
    }

    // ---- 2) Histórico pelo número, uma vez por processo ----
    /*
      O que o histórico traz passa pela MESMA ingestão e pela MESMA correlação:
      o ato com mais de 30 dias vira FORA_DA_JANELA em `rotularForaDaJanela` e
      nunca é candidato a tarefa nem a proposta, porque `aplicarAposDjen` só lê
      os últimos 30 dias. O teste com valores está em
      `djen-leitura-do-diario.spec.ts`.
    */
    const historicoLidoAgora: string[] = [];
    /*
      O ORÇAMENTO DE TEMPO (15/09/2026). Conferido antes de cada consulta das
      passadas 2 e 3: estourou, o resto da lista fica para a noite seguinte, sem
      carimbo, e entra na conta de `processosParadosPorTempo`. Um conjunto, e não
      uma soma, porque quem não leu o histórico por tempo também está na lista
      da janela.
    */
    const paradosPorTempo = new Set<string>();
    const semHistorico = await this.processosSemHistorico();
    for (let i = 0; i < semHistorico.length; i++) {
      const proc = semHistorico[i];
      if (passouDoOrcamento(iniciadaEm, Date.now())) {
        semHistorico.slice(i).forEach((p) => paradosPorTempo.add(p.id));
        break;
      }
      /*
        SÓ SAI DO PASSO 3 QUEM FOI LIDO DE FATO (14/09/2026).

        O id entrava na lista ANTES da consulta. Com timeout ou 503 na primeira
        página do histórico, o processo ficava sem histórico E sem a janela
        naquela noite. E se a consulta sem data falhasse sempre, ele nunca era
        lido pela janela, que é o furo que a consulta noturna veio fechar.
      */
      if (await this.consultarNumeroNaRodada(resumo, proc, hoje, true)) {
        historicoLidoAgora.push(proc.id);
      }
      await aguardar();
    }

    // ---- 3) O número de todo processo vivo, desde a última consulta ----
    const porNumero = await this.processosParaConsultarPorNumero(historicoLidoAgora);
    for (let i = 0; i < porNumero.length; i++) {
      if (passouDoOrcamento(iniciadaEm, Date.now())) {
        porNumero.slice(i).forEach((p) => paradosPorTempo.add(p.id));
        break;
      }
      await this.consultarNumeroNaRodada(resumo, porNumero[i], hoje, false);
      await aguardar();
    }
    resumo.processosParadosPorTempo = paradosPorTempo.size;
    if (paradosPorTempo.size) {
      this.logger.warn(
        `[DJEN-SYNC] Rodada parada por tempo (${DJEN_ORCAMENTO_DA_RODADA_MIN} minutos): ` +
          `${paradosPorTempo.size} processo(s) ficaram para a próxima noite.`,
      );
    }

    // ---- 3) Etapas finais: cada uma falha sozinha ----
    await this.etapa(resumo, 'correlação', async () => {
      await this.correlacionarPendentes();
    });
    /*
      A REDE DA CAIXA DE ENTRADA — logo depois da correlação, e não no fim.

      O modo de falhar da caixa é "ninguém abriu". Para proposta sem prazo isso
      é inofensivo: ela espera. Para uma COM prazo é perder prazo, e nenhuma
      melhoria de ruído vale isso. Depois de três dias a tarefa nasce sozinha,
      identificada como escalada.

      Rodava em penúltimo, atrás de ligar advogados, repor partes e conferir a
      fila — nenhuma delas é pré-requisito dela, e qualquer uma que quebrasse
      levava a rede junto. É a etapa que protege prazo; vai primeiro. Depende só
      da correlação, que é quem cria as propostas.

      Custa uma consulta quando não há nada a escalar, que é o caso normal.
    */
    await this.etapa(resumo, 'propostas esperando decisao', async () => {
      await this.caixa.cobrarEsquecidas();
    });
    await this.etapa(resumo, 'advogados do ato', async () => {
      await this.ligarAdvogadosDoAto();
    });
    await this.etapa(resumo, 'partes do ato', async () => {
      await this.reporPartesDoAto();
    });
    await this.etapa(resumo, 'conferência da fila no CNJ', async () => {
      await this.conferirFilaSemVerificacao();
    });
    // DEPOIS da conferência, de propósito: uma ação já baixada saiu da fila
    // acima e não vira tarefa para ninguém.
    await this.etapa(resumo, 'tarefa de cadastro', async () => {
      await this.agendarCadastroDasRecentes();
    });

    this.logger.log(
      `[DJEN-SYNC] ${resumo.advogadosConsultados} advogado(s) + ${resumo.processosConsultados} processo(s) — ` +
        `${resumo.recebidas} recebida(s), ${resumo.ingeridas} gravada(s), ` +
        `${resumo.descartadas} descartada(s) (processo não cadastrado, ` +
        `${resumo.sugeridas} sugerida(s) para cadastro), ${resumo.falhas} falha(s).`,
    );
  }

  /**
   * UMA ETAPA FINAL, ISOLADA DAS OUTRAS.
   *
   * Cada etapa já protege os próprios itens; o que faltava era a falha de TOPO
   * (o `findMany` inicial com o banco instável) não levar as seguintes junto. O
   * erro não é engolido: vai para `resumo.etapasComFalha`, que a linha de resumo
   * grava em `mensagemErro` e marca como insucesso.
   */
  private async etapa(
    resumo: ResumoVarreduraDjen,
    nome: string,
    fazer: () => Promise<void>,
  ): Promise<void> {
    try {
      await fazer();
    } catch (err) {
      const motivo = (err as Error)?.message ?? String(err);
      resumo.etapasComFalha.push(`${nome} (${motivo.slice(0, 120)})`);
      this.logger.error(
        `[DJEN-SYNC] A etapa "${nome}" falhou; as seguintes continuam: ${motivo}`,
      );
    }
  }

  /**
   * Varredura de UM processo — usada pelo botão da ficha.
   *
   * SEM O HISTÓRICO LIDO, O BOTÃO LÊ O HISTÓRICO (14/09/2026). Com ele, lê a
   * janela desde a última consulta, e em qualquer caso carimba como a rodada
   * da noite carimba: antes o botão consultava e não gravava que tinha
   * consultado, e a noite seguinte relia o mesmo processo à toa.
   *
   * Os campos novos da resposta (`historico`, `bateuNoTeto`, `interrompida`)
   * são só acréscimo: o web antigo lê `ingeridas` e `recebidas`, que continuam.
   */
  async sincronizarProcesso(processoId: string): Promise<{
    ingeridas: number;
    recebidas: number;
    historico: boolean;
    bateuNoTeto: boolean;
    interrompida: boolean;
  }> {
    const proc = await this.prisma.processo.findUnique({
      where: { id: processoId },
      select: { id: true, numeroCNJ: true, ultimaConsultaDjen: true, djenHistoricoLidoEm: true },
    });
    if (!proc?.numeroCNJ) {
      return { ingeridas: 0, recebidas: 0, historico: false, bateuNoTeto: false, interrompida: false };
    }

    const historico = !proc.djenHistoricoLidoEm;
    // `esperarCota: false` = não esperar a cota virar. Quem clicou está olhando
    // a tela; prender o botão por até um minuto é pior que dizer "tente em 40s".
    const { leitura, ingestao } = await this.lerPeloNumero(
      { id: proc.id, numeroCNJ: proc.numeroCNJ, ultimaConsultaDjen: proc.ultimaConsultaDjen },
      diaBR(new Date()),
      { historico, esperarCota: false, origem: OrigemSincronizacao.MANUAL },
    );
    // Quem clicou no botão espera ver a atividade criada agora, não amanhã.
    await this.correlacao.aplicarAposDjen(processoId);
    // O histórico que acabou de chegar ganha rótulo agora, e não na madrugada:
    // senão a aba mostraria centenas de atos sem dizer do que tratam.
    await this.rotularForaDaJanela(processoId);
    // E espera ver a equipe do caso completa: o ato que acabou de chegar diz
    // quem atua, e essa leitura custa duas consultas.
    await this.vinculoDeAdvogado.aplicarNoProcesso(processoId);
    return {
      ingeridas: ingestao.ingeridas,
      recebidas: leitura.itens.length,
      historico,
      bateuNoTeto: leitura.bateuNoTeto,
      interrompida: !!leitura.interrompidaPor,
    };
  }

  /**
   * UMA CONSULTA PELO NÚMERO, COM O CARIMBO CERTO — a mesma para a noite e o botão.
   *
   * HISTÓRICO (sem filtro de data, até `DJEN_HISTORICO_MAX_PAGINAS`):
   *  - `djenHistoricoLidoEm` só quando a leitura foi inteira (sem falha e sem
   *    teto). Com teto, a noite seguinte tenta de novo, e o teto aparece na
   *    frente da linha de resumo toda noite até alguém subir o limite.
   *  - `ultimaConsultaDjen` sempre que não houve falha, MESMO no teto: medido
   *    pela ponte em 13/09/2026, o CNJ devolve do mais novo para o mais antigo,
   *    então o que o teto corta é o passado distante, e os dias recentes foram
   *    lidos.
   *
   * JANELA (desde `ultimaConsultaDjen − 3 dias`, até 3 páginas): carimba só a
   * leitura inteira. Carimba mesmo quando não veio nada: o rodízio mede QUANDO
   * olhamos, não se achamos. Sem isto, um processo silencioso seria reconsultado
   * primeiro toda noite e empurraria os outros para fora da rodada.
   *
   * Falha na primeira página sobe como erro, sem carimbo nenhum.
   */
  private async lerPeloNumero(
    proc: { id: string; numeroCNJ: string; ultimaConsultaDjen: Date | null },
    hoje: string,
    opcoes: { historico: boolean; esperarCota: boolean; origem: OrigemSincronizacao },
  ): Promise<{
    leitura: LeituraDjen;
    ingestao: { ingeridas: number; descartadas: number; sugeridas: number };
    historicoCarimbado: boolean;
  }> {
    const janela = opcoes.historico
      ? null
      : janelaDoNumero(hoje, proc.ultimaConsultaDjen, {
          sobreposicao: this.djen.janelaDias,
          teto: DJEN_TETO_RECUPERACAO_DIAS,
        });
    const leitura = await this.djen.lerPorProcesso(proc.numeroCNJ, {
      esperarCota: opcoes.esperarCota,
      maxPaginas: opcoes.historico ? this.historicoMaxPaginas : PAGINAS_DO_NUMERO_NA_JANELA,
      ...(janela ? { de: janela.de, ate: janela.ate } : {}),
    });
    const ingestao = await this.ingerir(leitura.itens, opcoes.origem);

    const inteira = podeCarimbar(leitura);
    const historicoCarimbado = opcoes.historico && inteira;
    const consultaCarimbada = opcoes.historico ? !leitura.interrompidaPor : inteira;
    if (consultaCarimbada) {
      const agora = new Date();
      await this.prisma.processo.update({
        where: { id: proc.id },
        data: {
          ultimaConsultaDjen: agora,
          ...(historicoCarimbado ? { djenHistoricoLidoEm: agora } : {}),
        },
      });
    }
    return { leitura, ingestao, historicoCarimbado };
  }

  /**
   * A consulta pelo número dentro da rodada: isola a falha e conta no resumo.
   *
   * Devolve se a leitura voltou (mesmo pela metade: o CNJ entrega do mais novo
   * para o mais antigo, então os dias recentes foram lidos). Falha na primeira
   * página devolve `false`.
   */
  private async consultarNumeroNaRodada(
    resumo: ResumoVarreduraDjen,
    proc: { id: string; numeroCNJ: string | null; ultimaConsultaDjen: Date | null },
    hoje: string,
    historico: boolean,
  ): Promise<boolean> {
    if (!proc.numeroCNJ) return false;
    try {
      const { leitura, ingestao, historicoCarimbado } = await this.lerPeloNumero(
        { id: proc.id, numeroCNJ: proc.numeroCNJ, ultimaConsultaDjen: proc.ultimaConsultaDjen },
        hoje,
        { historico, esperarCota: true, origem: OrigemSincronizacao.CRON },
      );
      this.somarLeitura(resumo, leitura, ingestao);
      if (leitura.interrompidaPor) {
        resumo.falhas++;
        this.logger.warn(
          `[DJEN-SYNC] NPU ${proc.numeroCNJ} lido pela metade: ${leitura.interrompidaPor}`,
        );
      } else {
        resumo.processosConsultados++;
      }
      if (historicoCarimbado) resumo.historicosLidos++;
      return true;
    } catch (err) {
      this.anotarFalha(resumo, err);
      resumo.falhas++;
      this.logger.warn(`[DJEN-SYNC] Falha no NPU ${proc.numeroCNJ}: ${(err as Error).message}`);
      return false;
    }
  }

  /** Soma uma leitura ao resumo, e anota o teto pelo rótulo legível. */
  private somarLeitura(
    resumo: ResumoVarreduraDjen,
    leitura: LeituraDjen,
    r: { ingeridas: number; descartadas: number; sugeridas: number },
  ): void {
    resumo.recebidas += leitura.itens.length;
    resumo.maiorRecebidaPorConsulta = Math.max(resumo.maiorRecebidaPorConsulta, leitura.itens.length);
    resumo.ingeridas += r.ingeridas;
    resumo.descartadas += r.descartadas;
    resumo.sugeridas += r.sugeridas;
    if (leitura.bateuNoTeto) {
      const npu = /^NPU (\d{20})$/.exec(leitura.rotulo)?.[1];
      resumo.consultasNoTeto.push(npu ? `processo ${NpuUtils.formatar(npu) || npu}` : leitura.rotulo);
    }
  }

  /**
   * QUEM A BUSCA POR OAB ALCANÇA — ativo e com OAB consultável.
   *
   * O banco filtra o nulo; a aplicação filtra o vazio e a UF sem duas letras,
   * que o Prisma não sabe aparar. É a mesma lista para a varredura e para o
   * número que o `GET /djen/status` mostra.
   */
  async advogadosConsultaveis(): Promise<
    { id: string; oab: string | null; oabUf: string | null; djenLidoAte: Date | null }[]
  > {
    const candidatos = await this.prisma.user.findMany({
      where: { ativo: true, oab: { not: null }, oabUf: { not: null } },
      select: { id: true, oab: true, oabUf: true, djenLidoAte: true },
    });
    return candidatos.filter((a) => oabConsultavel(a.oab, a.oabUf));
  }

  /**
   * QUEM DEVIA SER CONSULTADO E NÃO É (14/09/2026).
   *
   * Duas mudanças contra a regra de 07/09, e as duas fecham um silêncio:
   *  - OAB VAZIA CONTA COMO SEM OAB. O filtro era `oab: null`, e o texto vazio
   *    passava: a pessoa não aparecia aqui, entrava na consulta, o CNJ recusava
   *    e a noite registrava uma falha, toda noite.
   *  - NÃO É SÓ O PERFIL ADVOGADO. Entra também quem é o PRINCIPAL de processo
   *    vivo, de qualquer perfil: é de quem o Diário devia trazer a intimação,
   *    tenha o cadastro o rótulo que tiver.
   *
   * Os dois `OR` não podem morar no mesmo objeto — o segundo sobrescreveria o
   * primeiro em silêncio (memória "not em coluna nula"). Por isso o vazio é
   * filtrado na aplicação, pela mesma `oabConsultavel` da varredura.
   */
  /*
    `falta` (15/09/2026): 'UF' quando o número está lá e só a UF falta ou não
    serve. A tela de Usuários dizia "Sem OAB no cadastro" também nesse caso.
  */
  async advogadosSemOab(): Promise<{ id: string; nome: string; falta: 'OAB' | 'UF' }[]> {
    const candidatos = await this.prisma.user.findMany({
      where: {
        ativo: true,
        OR: [
          { role: 'ADVOGADO' },
          {
            processosEquipe: {
              some: {
                principal: true,
                /*
                  "VIVO" É O MESMO DAS SELEÇÕES DA VARREDURA (14/09/2026): encerrado
                  com instância não baixada também anda (cumprimento de sentença no
                  1º grau) e é consultado toda noite. Sem este ramo, a principal
                  só de um processo assim ficava fora da lista de sem OAB. Este
                  `OR` mora dentro de `processo`, e não sobrescreve o de fora.
                */
                processo: {
                  OR: [
                    { statusInterno: { in: STATUS_VIVOS } },
                    { statusInterno: StatusProcesso.ENCERRADO, instancias: { some: { baixada: false } } },
                  ],
                },
              },
            },
          },
        ],
      },
      select: { id: true, nome: true, nomeExibicao: true, oab: true, oabUf: true },
      orderBy: { nome: 'asc' },
    });
    return candidatos
      .filter((u) => !oabConsultavel(u.oab, u.oabUf))
      .map((u) => ({ id: u.id, nome: u.nomeExibicao || u.nome, falta: faltaNaOab(u.oab, u.oabUf) ?? 'OAB' }));
  }

  /** A linha de cobertura da aba Publicações — ver `coberturaDoDiario`. */
  async coberturaDoProcesso(processoId: string): Promise<CoberturaDoDiario | null> {
    const p = await this.prisma.processo.findUnique({
      where: { id: processoId },
      select: {
        numeroCNJ: true,
        statusInterno: true,
        ultimaConsultaDjen: true,
        djenHistoricoLidoEm: true,
        instancias: { where: { baixada: false }, select: { id: true }, take: 1 },
        advogados: {
          select: {
            principal: true,
            advogado: {
              select: { id: true, nome: true, nomeExibicao: true, ativo: true, oab: true, oabUf: true },
            },
          },
        },
      },
    });
    if (!p) return null;
    return coberturaDoDiario({
      numeroCNJ: p.numeroCNJ,
      statusInterno: p.statusInterno,
      temInstanciaViva: p.instancias.length > 0,
      equipe: p.advogados.map((v) => ({ ...v.advogado, principal: v.principal })),
      ultimaConsultaDjen: p.ultimaConsultaDjen,
      djenHistoricoLidoEm: p.djenHistoricoLidoEm,
      agora: new Date(),
    });
  }

  /**
   * OS ADVOGADOS QUE O DIÁRIO NOMEIA VIRAM VÍNCULO NO PROCESSO.
   *
   * Roda sobre TODO processo que tem publicação, e não só sobre os da rodada:
   * o acervo inteiro já tinha 1.474 publicações com advogados quando isto
   * passou a existir, e nenhuma delas viraria vínculo se a varredura só olhasse
   * o que chegou hoje. São duas consultas por processo, 108 processos hoje — o
   * custo de uma passada é irrisório perto de descobrir na mão quem atua em
   * cada caso.
   *
   * É idempotente por construção: só acrescenta o que falta, e a lápide impede
   * que o que uma pessoa tirou volte.
   */
  private async ligarAdvogadosDoAto(): Promise<void> {
    const comPublicacao = await this.prisma.processo.findMany({
      where: { comunicacoes: { some: {} } },
      select: { id: true },
    });
    await this.vinculoDeAdvogado.aplicarNosProcessos(comPublicacao.map((p) => p.id));
  }

  /**
   * AS PARTES QUE O ATO NOMEIA E A FICHA NÃO TINHA.
   *
   * Irmã de `ligarAdvogadosDoAto`, e pelo mesmo motivo: o dado está na
   * publicação desde sempre e nunca saía dali. Medido em 12/09/2026: das 108
   * fichas com publicação, 43 tinham parte que o tribunal nomeia e que ninguém
   * cadastrou — 51 partes. Não é descuido de quem digita; é que o DataJud não
   * devolve partes e copiar 30 nomes de um litisconsórcio à mão ninguém faz.
   *
   * Repõe só o que não tem dúvida de lado. O resto vira lista na ficha, para
   * uma pessoa resolver num toque — a mesma ideia da caixa de propostas.
   */
  private async reporPartesDoAto(): Promise<void> {
    await this.partesDoDiario.reconciliarTodos();
  }

  /**
   * Correlaciona toda publicação ainda sem classificação.
   *
   * POR QUE UMA PASSADA PRÓPRIA, E NÃO UMA CHAMADA POR LOTE INGERIDO
   * O `hash` é único: uma publicação entra no banco UMA vez. Se a correlação
   * dela falhasse no mesmo instante (banco instável, nenhum usuário ativo para
   * receber a tarefa), ela nunca mais faria parte de um lote novo — e ficaria
   * gravada, invisível, sem nunca virar atividade. Varrer o pendente torna a
   * falha temporária, e não permanente.
   *
   * Também cobre o caso em que dois advogados são intimados no mesmo processo:
   * a correlação roda uma vez, no fim, em vez de uma por advogado.
   */
  private async correlacionarPendentes(): Promise<void> {
    const desde = new Date(Date.now() - this.DIAS_DA_JANELA_DE_TAREFA * 24 * 3_600_000);
    const processos = await this.prisma.processo.findMany({
      where: {
        comunicacoes: {
          some: { providencia: null, dataDisponibilizacao: { gte: desde } },
        },
      },
      select: { id: true },
    });

    let criadas = 0;
    let enriquecidas = 0;
    for (const p of processos) {
      const r = await this.correlacao.aplicarAposDjen(p.id);
      criadas += r.criadas;
      enriquecidas += r.enriquecidas;
    }

    if (criadas || enriquecidas) {
      this.logger.log(
        `[DJEN-SYNC] Correlação: ${criadas} atividade(s) criada(s), ` +
          `${enriquecidas} enriquecida(s) com o teor da publicação.`,
      );
    }

    await this.rotularForaDaJanela();
  }

  /**
   * O HISTÓRICO TAMBÉM PRECISA DE RÓTULO — e ele nunca passava pelo robô.
   *
   * A consulta por NPU traz o processo INTEIRO: a varredura de 04/09/2026 subiu
   * o acervo de 136 para 1.399 publicações, e 1.209 delas são de antes da
   * janela de 30 dias. Como `aplicarAposDjen` só olha os últimos 30 dias, essas
   * ficavam com `providencia` NULA para sempre — 86% da tela de Publicações sem
   * dizer do que trata cada ato, e o filtro por providência devolvendo quase
   * nada.
   *
   * ISTO NÃO CRIA TAREFA, e a garantia é estrutural, não uma promessa:
   *
   *  - `aplicarAposDjen` filtra `providencia: null`; ao rotular, a publicação
   *    deixa de ser candidata a virar atividade. Por isso só se rotula o que
   *    está FORA da janela — dentro dela, tirar o nulo seria roubar do robô uma
   *    publicação que ele ainda ia processar.
   *  - `parearAtrasadas` só grava `movimentacaoId`, e também só dentro da
   *    janela.
   *
   * É classificação para LEITURA, portanto. A que gera trabalho continua sendo
   * uma só, na passada normal.
   */
  /*
    `processoId` é o botão da ficha (14/09/2026): o histórico que ele acabou de
    ler ganha rótulo na hora, só daquele processo. Sem ele, a rodada da noite
    rotula o acervo inteiro, como sempre.
  */
  private async rotularForaDaJanela(processoId?: string): Promise<void> {
    const desde = new Date(Date.now() - this.DIAS_DA_JANELA_DE_TAREFA * 24 * 3_600_000);
    const antigas = await this.prisma.comunicacaoDjen.findMany({
      where: { providencia: null, dataDisponibilizacao: { lt: desde }, ...(processoId ? { processoId } : {}) },
      select: { id: true, texto: true, tipoComunicacao: true },
      // Teto por passada: a primeira carga de um acervo grande não pode virar
      // uma transação de horas. O que sobrar entra amanhã.
      take: 2_000,
    });
    if (!antigas.length) return;

    let rotuladas = 0;
    for (const c of antigas) {
      const { providencia } = classificarProvidencia(c.texto, c.tipoComunicacao);
      await this.prisma.comunicacaoDjen.update({
        where: { id: c.id },
        data: {
          providencia,
          /*
            A DECISÃO FICA GRAVADA AQUI TAMBÉM — e faltava.

            Rotular fora da janela É uma decisão: "classifica para leitura,
            nunca vira tarefa". Sem carimbo, a linha resultante fica idêntica à
            de uma falha do robô (com providência, sem tarefa, sem dispensa) e
            o alarme a conta como pendência.

            Foi exatamente o bug dos 1.243 falsos positivos, num SEGUNDO caminho
            que eu não vi ao consertar o primeiro: no dia seguinte apareceram 7
            publicações nessa situação — atos de março a junho de dois processos
            recém-cadastrados. Ninguém viu porque os dois estão sem advogado; com
            advogado, seriam barra vermelha na cara dele.

            Regra que fica: TODO caminho que decide não criar tarefa carimba o
            porquê. Ausência nunca é sinal.
          */
          tarefaDispensadaEm: new Date(),
          tarefaDispensadaMotivo: 'FORA_DA_JANELA',
        },
      });
      rotuladas++;
    }
    this.logger.log(
      `[DJEN-SYNC] ${rotuladas} publicação(ões) do histórico classificada(s) para leitura ` +
        '(fora da janela de tarefa).',
    );
  }

  // -------------------------------------------------------------------------

  /**
   * Grava as publicações que pertencem a processos cadastrados; descarta o resto.
   *
   * A gravação usa `createMany` com `skipDuplicates` sobre o índice único de
   * `hash`. Isso torna a operação idempotente NO BANCO: reprocessar a mesma
   * janela — o que a varredura faz de propósito todo dia, para absorver fim de
   * semana e feriado — não duplica nada e não exige leitura prévia.
   */
  /**
   * A SIGLA DO SINDICATO, LIDA DO CADASTRO E NÃO DE UMA CONSTANTE.
   *
   * São dois clientes no mesmo código. A parte marcada `institucional` guarda
   * `nomeFantasia = tenant.sigla`, e é ela que o resto do módulo já usa para
   * responder "somos nós?". Cacheada por rodada: a varredura chama a ingestão
   * uma vez por advogado, e a sigla não muda no meio.
   */
  private siglaCache: { valor: string | null; em: number } | null = null;

  private async siglaDoSindicato(): Promise<string | null> {
    const UMA_HORA = 3_600_000;
    if (this.siglaCache && Date.now() - this.siglaCache.em < UMA_HORA) {
      return this.siglaCache.valor;
    }
    const institucional = await this.prisma.parteExterna.findFirst({
      where: { institucional: true },
      select: { nomeFantasia: true },
    });
    this.siglaCache = { valor: institucional?.nomeFantasia ?? null, em: Date.now() };
    return this.siglaCache.valor;
  }

  /**
   * AS PUBLICAÇÕES QUE SÃO NOSSAS MAS NÃO ESTÃO CADASTRADAS.
   *
   * Recebe o que seria descartado e guarda apenas o que nomeia o sindicato
   * entre os destinatários. O texto do ato NÃO é guardado: para decidir se vale
   * cadastrar bastam o número, o tribunal, a classe e quem está de cada lado.
   * Guardar o teor de um processo que ainda não é nosso seria persistir mais do
   * que a decisão exige.
   *
   * `upsert` por NPU: a mesma ação aparece em várias publicações e em várias
   * rodadas, e não pode virar dez linhas na fila.
   */
  private async sugerirAcoesNossas(foraDoAcervo: ComunicacaoDjenDto[]): Promise<number> {
    if (!foraDoAcervo.length) return 0;
    const sigla = await this.siglaDoSindicato();

    /*
      A SIGLA VEM DE UM CAMPO EDITÁVEL, e isso é um risco silencioso.

      Ela sai do `nomeFantasia` da parte institucional — o mesmo registro que
      aparece na tela de Organizações e que alguém pode renomear. Apagado ou
      encurtado, a detecção simplesmente para de achar, e AUSÊNCIA DE ALERTA
      PARECE CALMA: a fila fica vazia e ninguém desconfia de nada.

      A regra desta casa é que zero não pode ser ambíguo. Então, quando a chave
      não serve, o log DIZ — em `warn`, com o motivo e o conserto.
    */
    if (!sigla || sigla.trim().length < 4) {
      this.logger.warn(
        '[DJEN] Detecção de ação nova DESLIGADA: a parte institucional está sem sigla ' +
          `utilizável (nome fantasia atual: ${sigla ? `"${sigla}"` : 'vazio'}). ` +
          'Preencha o nome fantasia da organização do sindicato — é por ele que o ' +
          'sistema reconhece o próprio nome nos autos.',
      );
      return 0;
    }

    /*
      Agrupa por NPU ANTES de escrever: um lote traz várias publicações do mesmo
      processo, e dez `upsert` na mesma linha só gastam banco.
    */
    const porNpu = new Map<
      string,
      { c: ComunicacaoDjenDto; polo: PoloDetectado; n: number; de: Date; ate: Date }
    >();

    for (const c of foraDoAcervo) {
      const polo = nossoPoloNoAto(c.destinatarios, sigla);
      if (!polo) continue;
      const quando = new Date(`${c.dataDisponibilizacao}T00:00:00Z`);
      const atual = porNpu.get(c.numeroProcesso);
      if (atual) {
        atual.n++;
        if (quando < atual.de) atual.de = quando;
        if (quando > atual.ate) atual.ate = quando;
      } else {
        porNpu.set(c.numeroProcesso, { c, polo, n: 1, de: quando, ate: quando });
      }
    }
    if (!porNpu.size) return 0;

    let novas = 0;
    for (const [numeroCNJ, item] of porNpu) {
      /*
        A DECISÃO DE QUEM JÁ OLHOU NÃO SE DESFAZ SOZINHA. Se alguém ignorou esta
        ação, uma publicação nova amanhã não pode devolvê-la à fila — seria o
        sistema discutindo com a pessoa. O contador sobe; o status, não.
      */
      const criada = await this.prisma.sugestaoProcesso.upsert({
        where: { numeroCNJ },
        create: {
          numeroCNJ,
          siglaTribunal: item.c.siglaTribunal ?? null,
          nomeOrgao: item.c.nomeOrgao ?? null,
          nomeClasse: item.c.nomeClasse ?? null,
          nossoPolo: item.polo,
          partes: (item.c.destinatarios ?? null) as unknown as Prisma.InputJsonValue,
          advogados: (item.c.advogados ?? null) as unknown as Prisma.InputJsonValue,
          primeiraEm: item.de,
          ultimaEm: item.ate,
          publicacoes: item.n,
        },
        update: {
          publicacoes: { increment: item.n },
          ultimaEm: item.ate,
          /*
            O POLO SÓ MELHORA, nunca piora. A primeira publicação de um recurso
            pode listar só um lado e a seguinte listar os dois; o contrário
            também acontece. Sobrescrever com `INDEFINIDO` apagaria informação
            que já tínhamos.
          */
          ...(item.polo !== 'INDEFINIDO' ? { nossoPolo: item.polo } : {}),
        },
        select: { createdAt: true, updatedAt: true },
      });
      if (criada.createdAt.getTime() === criada.updatedAt.getTime()) {
        novas++;
        // Só as NOVAS: reconferir toda noite as que já estão na fila gastaria
        // cota para responder o que não mudou.
        await this.marcarSeJaEncerrado(numeroCNJ, item.c.siglaTribunal);
      }
    }

    if (novas > 0) {
      this.logger.log(
        `[DJEN] ${novas} ação(ões) do ${sigla} encontrada(s) no Diário sem cadastro no acervo.`,
      );
    }
    return novas;
  }

  /**
   * A AÇÃO NOVA E RECENTE VIRA TAREFA DO ADVOGADO CITADO NO ATO.
   *
   * A fila do Diário morava em dois lugares: o sino e uma lista na tela de
   * Processos. Nenhum dos dois é onde o jurídico trabalha — a agenda é. Uma
   * ação nova contra o sindicato dependia de alguém lembrar de abrir uma lista,
   * e "lembrar de olhar" é exatamente o que a automação existe para dispensar.
   *
   * TRÊS TRAVAS, e cada uma responde a um jeito conhecido de isto virar ruído:
   *
   *  1. SÓ AS RECENTES. Trinta dias, a mesma régua do robô de prazos e da
   *     correlação. Medido em 07/09/2026: das 30 pendentes, 7 são recentes.
   *     Sem o corte seriam 30 tarefas de uma vez, várias de ações de 2014 —
   *     a agenda vira lixeira e ninguém confia nela de novo.
   *  2. SÓ COM DESTINATÁRIO. Sem advogado nosso citado no ato não há a quem
   *     atribuir, e tarefa que cai no colo do primeiro administrativo é tarefa
   *     de ninguém. Sem ele a ação continua na fila da tela, que é coletiva.
   *  3. UMA SÓ, PARA SEMPRE. `sugestao.compromissoId` é único: a varredura de
   *     amanhã encontra a mesma sugestão e não cria a segunda tarefa. Sem isso
   *     seriam trinta tarefas em trinta dias para a mesma ação.
   *
   * NUNCA URGENTE. É cadastro, não prazo: o prazo, se houver, corre no processo
   * de verdade e só passa a ser vigiado depois que ele existir aqui. Marcar
   * urgente competiria com prazo real — e o próprio módulo já aprendeu que sete
   * urgências simultâneas são zero urgências.
   */
  private async agendarCadastroDasRecentes(): Promise<void> {
    const corte = new Date(Date.now() - DIAS_PARA_AGENDAR_CADASTRO * 24 * 3_600_000);
    const recentes = await this.prisma.sugestaoProcesso.findMany({
      where: { status: 'PENDENTE', compromissoId: null, primeiraEm: { gte: corte } },
      orderBy: { primeiraEm: 'asc' },
      select: {
        id: true, numeroCNJ: true, nossoPolo: true, nomeOrgao: true,
        nomeClasse: true, advogados: true, primeiraEm: true, publicacoes: true,
      },
    });
    if (!recentes.length) return;

    const porOab = await this.advogadosPorOab();
    let criadas = 0;
    let semDono = 0;
    /*
      CADA TAREFA GANHA O SEU MINUTO — e isto veio de simular a rodada.

      Rodando a seleção contra a produção antes de subir: 7 ações qualificadas,
      e QUATRO delas caindo na mesma pessoa (Morgana), todas com `inicio` no
      mesmo instante — 09:00 de amanhã. Quatro linhas idênticas no mesmo minuto
      da agenda não se leem como quatro trabalhos; leem-se como um defeito, e a
      pessoa passa por cima das quatro.

      Quinze minutos entre uma e outra, e o relógio para de andar depois de duas
      horas: numa colheita grande vale mais empilhar às 11:00 do que agendar
      tarefa para depois do almoço de um dia que nem começou.
    */
    const PASSO_MS = 15 * 60_000;
    const MAX_PASSOS = 8;
    const base = proximoHorarioUtilBR(noveDaManhaBR(new Date()));
    let slot = 0;

    for (const s of recentes) {
      const responsavelId = this.primeiroAdvogadoNosso(s.advogados, porOab);
      if (!responsavelId) {
        semDono++;
        continue;
      }
      try {
        // Nove da manhã de Teresina, no próximo dia útil, e nunca no passado —
        // a mesma função que os outros robôs usam. Tarefa que nasce vencida
        // envenena o contador de atrasos no mesmo instante.
        const inicio = new Date(base.getTime() + Math.min(slot, MAX_PASSOS) * PASSO_MS);
        const npu = NpuUtils.formatar(s.numeroCNJ) || s.numeroCNJ;
        const compromisso = await this.prisma.compromisso.create({
          data: {
            titulo: `Cadastrar ação do Diário — ${npu}`,
            // DILIGÊNCIA, e não PRAZO: é trabalho administrativo nosso. PRAZO
            // entraria na contagem de vencimentos processuais e mentiria sobre
            // haver um prazo do tribunal correndo.
            tipo: 'DILIGENCIA',
            status: 'PENDENTE',
            inicio,
            fim: new Date(inicio.getTime() + 3_600_000),
            descricao:
              `${POLO_NA_TAREFA[s.nossoPolo] ?? 'Ação do sindicato'} · ${npu}` +
              `${s.nomeClasse ? `\n${s.nomeClasse}` : ''}` +
              `${s.nomeOrgao ? ` — ${s.nomeOrgao}` : ''}` +
              `\n\nApareceu no Diário e ainda não está no acervo` +
              `${s.publicacoes > 1 ? ` (${s.publicacoes} publicações até agora)` : ''}.` +
              `\nCadastre pela tela de Processos — o formulário já abre preenchido` +
              ` com as partes e os advogados que vieram do ato.`,
            responsavelId,
            // Sem processo: ele é justamente o que ainda não existe. A coluna é
            // nula e a agenda já lida com tarefa sem processo.
            processoId: null,
            origemAutomatica: true,
            criadoPor: null,
          },
          select: { id: true },
        });
        await this.prisma.sugestaoProcesso.update({
          where: { id: s.id },
          data: { compromissoId: compromisso.id },
        });
        /*
          A RESERVA AQUI NÃO VEM DA EQUIPE DO PROCESSO — o processo é justamente
          o que ainda não existe. Vem do ATO: os outros advogados nossos que o
          Diário nomeou na mesma publicação. É a única tarefa de robô sem
          processo, e por isso a única que o gatilho não alcança.
        */
        await anotarReserva(
          this.prisma,
          compromisso.id,
          separarAdvogadosDoAto(s.advogados, porOab).nossos.filter((id) => id !== responsavelId),
        );
        criadas++;
        slot++;
      } catch (err) {
        // Falhar aqui não pode derrubar a varredura: a sugestão fica sem tarefa
        // e a próxima rodada tenta de novo, que é o lado seguro.
        this.logger.warn(
          `[DJEN] Não deu para agendar o cadastro de ${s.numeroCNJ}: ${(err as Error).message}`,
        );
      }
    }

    if (criadas || semDono) {
      this.logger.log(
        `[DJEN] Cadastro agendado para ${criadas} ação(ões) recente(s)` +
          `${semDono ? `; ${semDono} sem advogado nosso citado ficaram só na fila` : ''}.`,
      );
    }
  }

  /** Nossos advogados ativos, indexados por "UF-numero" da OAB. */
  private async advogadosPorOab(): Promise<Map<string, string>> {
    const nossos = await this.prisma.user.findMany({
      where: { ativo: true, oab: { not: null }, oabUf: { not: null } },
      select: { id: true, oab: true, oabUf: true },
    });
    return new Map(nossos.map((a) => [chaveOab(a.oab, a.oabUf), a.id]));
  }

  /**
   * O PRIMEIRO NOSSO CITADO NO ATO.
   *
   * Pela OAB, nunca pelo nome: o DJEN manda "ICARO SOL ALMONDES SANTOS" e o
   * cadastro tem "Ícaro Sol Almondes Santos". Número + UF é exato.
   *
   * O primeiro, e não todos: a tarefa tem UM responsável, e quem receber pode
   * repassar. Distribuir a mesma tarefa para três pessoas é como não distribuir
   * para nenhuma.
   */
  private primeiroAdvogadoNosso(
    advogados: unknown,
    porOab: Map<string, string>,
  ): string | null {
    const lista = Array.isArray(advogados)
      ? (advogados as { numeroOab?: unknown; ufOab?: unknown }[])
      : [];
    for (const a of lista) {
      const id = porOab.get(chaveOab(a?.numeroOab, a?.ufOab));
      if (id) return id;
    }
    return null;
  }

  /**
   * A FILA QUE JÁ EXISTIA NÃO PASSOU POR ESTA CONFERÊNCIA.
   *
   * A checagem de "ainda corre?" entrou depois da primeira colheita — as 32
   * ações que ela trouxe estão na fila sem carimbo. Sem isto, elas ficariam
   * para sempre sem saber se o processo acabou, e a fila continuaria pedindo
   * cadastro de coisa morta.
   *
   * Roda no fim da varredura, com teto: é uma consulta ao CNJ por ação, e a cota
   * é a mesma que a varredura acabou de usar. Vinte por rodada esvaziam qualquer
   * acúmulo real em poucos dias e não competem com o trabalho principal.
   *
   * Depois que todas têm carimbo, esta passada custa uma consulta ao banco e
   * mais nada — e volta a custar só quando algo novo entra sem conferência.
   */
  private async conferirFilaSemVerificacao(): Promise<void> {
    /*
      QUARENTA, e não vinte.

      Vinte foi um chute. Medido: a primeira colheita de histórico deixou 30
      ações pendentes e NENHUMA conferida — com teto de 20 a fila só ficaria
      limpa na segunda noite, e é justamente na primeira que alguém vai olhar.
      O acúmulo típico não é o fluxo diário (1–3 ações), é a colheita manual.

      O teto continua existindo porque a cota é compartilhada: 40 conferências
      são ~40–80 chamadas ao DataJud, uns 3 a 6 minutos a 14/min. Desde a
      leitura pelo número toda noite (14/09/2026) as consultas da rodada levam
      uns 12 a 14 minutos, então o pior caso real termina por volta das 05:20 —
      três horas depois da varredura do DataJud, que se encerra às 02:07. Numa
      noite que bata no orçamento de tempo, as consultas param aos 150 minutos
      e esta etapa ainda cabe antes de a trava de 180 se soltar.
    */
    const TETO = 40;
    const semCarimbo = await this.prisma.sugestaoProcesso.findMany({
      where: { status: 'PENDENTE', verificadoNoCnjEm: null, siglaTribunal: { not: null } },
      orderBy: { createdAt: 'asc' },
      take: TETO,
      select: { numeroCNJ: true, siglaTribunal: true },
    });
    if (!semCarimbo.length) return;

    this.logger.log(
      `[DJEN] Conferindo no CNJ se ${semCarimbo.length} ação(ões) da fila ainda correm…`,
    );
    for (const s of semCarimbo) {
      await this.marcarSeJaEncerrado(s.numeroCNJ, s.siglaTribunal!);
    }
  }

  /**
   * O PROCESSO AINDA CORRE? — e se não corre, sai da fila antes de entrar nela.
   *
   * A primeira colheita trouxe 32 ações e boa parte era de processo encerrado.
   * Faz sentido: o ATO DE ENCERRAMENTO é justamente a última coisa que um
   * processo morto publica no Diário, e é por ele que a varredura o encontra.
   * Fila cheia de trabalho que não existe é o jeito mais rápido de a equipe
   * parar de olhar a fila.
   *
   * O critério é ESTADO, e não idade: uma ação de 2014 que ainda corre importa;
   * uma de 2026 já baixada, não. Usa `instanciaBaixada`, a mesma regra de
   * códigos TPU que o resto do módulo aplica — ela entende desarquivamento e
   * movimento posterior à baixa.
   *
   * UMA CONSULTA POR AÇÃO NOVA, e só na primeira vez. No fluxo diário isso é
   * quase nada; na colheita de histórico foram 32 chamadas, uns dois minutos e
   * meio de cota.
   *
   * NA DÚVIDA, MOSTRA. Se o CNJ não conhece o número ou a consulta falha,
   * `verificadoNoCnjEm` fica nulo e a ação permanece na fila: esconder processo
   * vivo custa prazo; mostrar um morto custa um clique.
   */
  private async marcarSeJaEncerrado(numeroCNJ: string, siglaTribunal: string): Promise<void> {
    if (!siglaTribunal || siglaTribunal === 'ND') return;
    try {
      const instancias = await this.datajud.buscarInstanciasPorNPU(numeroCNJ, siglaTribunal);
      // Sem instância nenhuma o CNJ não sabe do processo — não é o mesmo que
      // dizer que ele acabou, e tratar como encerrado esconderia um caso vivo.
      if (!instancias.length) return;

      const encerrado = instancias.every((i) => instanciaBaixada(i.movimentacoes));
      const alvo = await this.prisma.sugestaoProcesso.findUnique({
        where: { numeroCNJ },
        select: { id: true },
      });
      await this.prisma.sugestaoProcesso.updateMany({
        where: { numeroCNJ, status: 'PENDENTE' },
        data: {
          verificadoNoCnjEm: new Date(),
          ...(encerrado ? { status: 'ENCERRADO' as const, decididoEm: new Date() } : {}),
        },
      });
      // QUARTO caminho de saída da fila — e o único fora deste arquivo de
      // sugestões. Sem isto, a ação já baixada sumia da fila e a tarefa de
      // cadastrá-la continuava viva na agenda de alguém.
      if (encerrado && alvo) await fecharTarefaDeCadastro(this.prisma, alvo.id, 'DESCARTADO');
      if (encerrado) {
        this.logger.log(`[DJEN] ${numeroCNJ} já baixado no CNJ — fora da fila de cadastro.`);
      }
    } catch (err) {
      // A conferência é um bônus: falhar aqui não pode derrubar a ingestão nem
      // perder a sugestão. Ela fica na fila sem carimbo, que é o lado seguro.
      this.logger.warn(
        `[DJEN] Não deu para conferir no CNJ se ${numeroCNJ} ainda corre: ${(err as Error).message}`,
      );
    }
  }

  private async ingerir(
    comunicacoes: ComunicacaoDjenDto[],
    origem: OrigemSincronizacao,
  ): Promise<{ ingeridas: number; descartadas: number; sugeridas: number }> {
    if (!comunicacoes.length) return { ingeridas: 0, descartadas: 0, sugeridas: 0 };

    // Uma consulta só resolve o casamento de todos os NPUs do lote.
    const npus = [...new Set(comunicacoes.map((c) => c.numeroProcesso))];
    const processos = await this.prisma.processo.findMany({
      where: { numeroCNJ: { in: npus } },
      select: {
        id: true,
        numeroCNJ: true,
        instancias: { select: { id: true, orgaoJulgador: true } },
      },
    });
    const porNpu = new Map(processos.map((p) => [p.numeroCNJ!, p]));

    const doAcervo = comunicacoes.filter((c) => porNpu.has(c.numeroProcesso));
    const foraDoAcervo = comunicacoes.filter((c) => !porNpu.has(c.numeroProcesso));
    const descartadas = foraDoAcervo.length;

    /*
      ANTES DE DESCARTAR, PERGUNTA SE É NOSSO.

      O que não casa com um processo cadastrado é descartado — e isso continua
      certo: a consulta por OAB devolve a carteira INTEIRA do advogado, e a
      causa particular dele não é assunto do sindicato.

      Só que junto ia o caso NOVO do próprio sindicato: ação recém-distribuída em
      que um dos nossos já está no polo, ainda sem cadastro aqui. O Diário
      anunciava e nós jogávamos fora. Agora ela vira SUGESTÃO.

      O filtro segue estreito: só quando o sindicato figura entre os
      destinatários. Nada de terceiro é persistido — a decisão de privacidade
      continua de pé, e o que sobra é exatamente o que é nosso.
    */
    const sugeridas = await this.sugerirAcoesNossas(foraDoAcervo);

    if (!doAcervo.length) return { ingeridas: 0, descartadas, sugeridas };

    const linhas = doAcervo.map((c) => {
      const processo = porNpu.get(c.numeroProcesso)!;
      return {
        hash: c.hash,
        numeroProcesso: c.numeroProcesso,
        processoId: processo.id,
        instanciaId: this.casarInstancia(processo.instancias, c.nomeOrgao),
        siglaTribunal: c.siglaTribunal,
        tipoComunicacao: c.tipoComunicacao,
        tipoDocumento: c.tipoDocumento,
        nomeOrgao: c.nomeOrgao,
        nomeClasse: c.nomeClasse,
        meio: c.meio,
        link: c.link,
        texto: c.texto,
        dataDisponibilizacao: new Date(`${c.dataDisponibilizacao}T00:00:00Z`),
        destinatarios: c.destinatarios as unknown as Prisma.InputJsonValue,
        advogados: c.advogados as unknown as Prisma.InputJsonValue,
      };
    });

    const { count } = await this.prisma.comunicacaoDjen.createMany({
      data: linhas,
      skipDuplicates: true,
    });

    // Uma linha de log por processo que recebeu publicação NOVA — mesma
    // granularidade do lado DataJud, para o diagnóstico ser comparável.
    if (count > 0) {
      const porProcesso = new Map<
        string,
        { npu: string; tribunal: string; n: number; publicadaEm: Date }
      >();
      for (const c of doAcervo) {
        const p = porNpu.get(c.numeroProcesso)!;
        const atual = porProcesso.get(p.id) ?? {
          npu: c.numeroProcesso,
          tribunal: c.siglaTribunal,
          n: 0,
          publicadaEm: new Date(0),
        };
        atual.n++;
        const quando = new Date(`${c.dataDisponibilizacao}T00:00:00Z`);
        if (quando > atual.publicadaEm) atual.publicadaEm = quando;
        porProcesso.set(p.id, atual);
      }

      /*
        A PUBLICAÇÃO TAMBÉM MOVE A ORDENAÇÃO.

        `ultimo_movimento_em` é a coluna que ordena "Movimentação recente", e ela
        era mantida só pelo gatilho das notas internas e pelo lado DataJud. O
        Diário não a tocava — medido em 07/09/2026: **37 processos tinham
        publicação mais nova do que a própria coluna que os ordena**, e um
        processo publicado anteontem aparecia abaixo de outro parado desde
        julho, na tela cujo nome é "movimentação recente".

        `updateMany` com `lt` no lugar de um `update` seco: a coluna SÓ AVANÇA.
        Uma publicação antiga que chegue atrasada na varredura não pode puxar o
        processo para trás.
      */
      for (const [processoId, info] of porProcesso) {
        await this.prisma.processo.updateMany({
          where: {
            id: processoId,
            OR: [{ ultimoMovimentoEm: null }, { ultimoMovimentoEm: { lt: info.publicadaEm } }],
          },
          data: { ultimoMovimentoEm: info.publicadaEm },
        });
      }

      for (const [processoId, info] of porProcesso) {
        await this.logSync.registrar({
          processoId,
          numeroCNJ: info.npu,
          tribunal: info.tribunal,
          fonte: FONTE_DJEN,
          origem,
          sucesso: true,
          novasMovimentacoes: info.n,
        });
      }
    }

    return { ingeridas: count, descartadas, sugeridas };
  }

  /**
   * A RODADA GRAVA QUE ELA ACONTECEU — mesmo sem trazer nada, mesmo quebrando.
   *
   * Este log só ganhava linha quando havia publicação NOVA para gravar (uma por
   * processo contemplado). Numa varredura de fim de semana, quando o Diário não
   * circula, a rodada corria inteira, consultava as oito OABs, não achava nada —
   * e não deixava rastro nenhum.
   *
   * A tela lia "nenhuma consulta bem-sucedida em 48h" e anunciava a integração
   * como PARADA, em vermelho. Foi o que o usuário viu num domingo à noite: as
   * 1.408 publicações do acervo não têm UMA de sábado ou domingo, e mesmo assim
   * o painel acusava defeito.
   *
   * O DataJud sempre registrou toda tentativa, frutífera ou não. Isto devolve a
   * simetria: uma linha por rodada, sem NPU — ela fala da rodada, não de um
   * processo.
   */
  private async registrarResumo(
    resumo: ResumoVarreduraDjen,
    origem: OrigemSincronizacao,
    iniciadaEm: number,
    quebrou: string | null,
  ): Promise<void> {
    /*
      TENTATIVAS, e não consultas BEM-SUCEDIDAS.

      Eu somava `advogadosConsultados + processosConsultados`, e os dois só são
      incrementados quando a chamada VOLTA. Rodando de verdade contra uma rede
      onde o CNJ recusa tudo, o resultado foi uma linha dizendo "varredura sem
      alvo" depois de 14 minutos consultando — a mensagem exata que se escreve
      para "não havia o que consultar". Só apareceu porque eu rodei.
    */
    // Na FRENTE da mensagem: o log corta em 500 caracteres, e a etapa que
    // quebrou é o que alguém investigando precisa ler primeiro.
    const etapas = resumo.etapasComFalha ?? [];
    /*
      A LISTA DE ETAPAS TEM ORÇAMENTO (14/09/2026). Cada item leva até 120
      caracteres do erro; com o banco instável derrubando quatro etapas, a lista
      sozinha passava dos 500 e empurrava para fora do corte tudo o que vinha
      depois. Cabem os itens até 250 caracteres, e o resto vira "e mais N".
    */
    let listaDeEtapas = '';
    let etapasListadas = 0;
    for (const e of etapas) {
      const junto = listaDeEtapas ? `${listaDeEtapas}; ${e}` : e;
      if (listaDeEtapas && junto.length > ORCAMENTO_DAS_ETAPAS) break;
      listaDeEtapas = junto;
      etapasListadas++;
    }
    const etapasDeFora = etapas.length - etapasListadas;
    const falhaDeEtapa = etapas.length
      ? `Etapa(s) final(is) com falha, as outras rodaram: ${listaDeEtapas}` +
        `${etapasDeFora ? ` e mais ${etapasDeFora}` : ''}. `
      : '';
    /*
      TETO E OAB AUSENTE TAMBÉM VÃO NA FRENTE (14/09/2026).

      O teto de páginas só existia no stdout. E a frase ATENÇÃO dos advogados
      sem OAB morava no FIM da mensagem de sucesso: bastava UMA falha na rodada
      para ela sumir, justamente na noite em que alguém ia ler a linha. As duas
      falam de algo que não foi lido, e ficam independentes do resto.
    */
    const noTeto = resumo.consultasNoTeto ?? [];
    const avisoDeTeto = noTeto.length
      ? `Teto de páginas atingido em ${noTeto.slice(0, 5).join(', ')}` +
        `${noTeto.length > 5 ? ` e mais ${noTeto.length - 5}` : ''}: pode haver publicação não lida, ` +
        `e a data de leitura ${noTeto.length === 1 ? 'desta consulta' : 'dessas consultas'} não avançou. `
      : '';
    const avisoSemOab =
      resumo.advogadosSemOab > 0
        ? `ATENÇÃO: ${resumo.advogadosSemOab} advogado(s) sem OAB não foram consultados. `
        : '';
    /*
      A FRASE CURTA E FIXA VEM PRIMEIRO (14/09/2026). O ATENÇÃO vinha por último
      e era o primeiro a cair no corte de 500 caracteres do log, justamente na
      noite com falha, em que alguém vai ler a linha. Tem uns 60 caracteres;
      depois dela o teto (no máximo 5 itens) e as etapas (com orçamento).
    */
    /*
      A RODADA PARADA POR TEMPO TAMBÉM VAI NA FRENTE (15/09/2026): fala de
      processos que não foram lidos, como o teto. Curta e fixa, logo depois do
      ATENÇÃO, para sobreviver ao corte de 500.
    */
    const paradosPorTempo = resumo.processosParadosPorTempo ?? 0;
    const avisoDeTempo = paradosPorTempo > 0
      ? `Rodada parada por tempo: ${paradosPorTempo} ${paradosPorTempo === 1 ? 'processo ficou' : 'processos ficaram'} para a próxima noite. `
      : '';
    /*
      A MAIOR LEITURA ENTRA NA FRASE (15/09/2026). O número era calculado a cada
      consulta e ninguém o lia. Perto de 100 × páginas é sinal de teto chegando;
      só aparece quando alguma consulta trouxe itens.
    */
    const maiorLeitura = (resumo.maiorRecebidaPorConsulta ?? 0) > 0
      ? `, maior leitura: ${resumo.maiorRecebidaPorConsulta} ${resumo.maiorRecebidaPorConsulta === 1 ? 'item' : 'itens'}`
      : '';
    const naFrente = avisoSemOab + avisoDeTempo + avisoDeTeto + falhaDeEtapa;
    const tentativas =
      resumo.advogadosConsultados + resumo.processosConsultados + resumo.falhas;
    /*
      A MAIORIA EM FALHA JÁ REPROVA A RODADA (21/09/2026) — ver
      `FRACAO_DE_FALHA_QUE_REPROVA`. Era `falhas === tentativas`, e foi assim
      que "159 de 165 consulta(s) em falha" entrou no log como SUCESSO.
    */
    const tudoFalhou = tentativas > 0 && resumo.falhas === tentativas;
    const aMaioriaFalhou =
      tentativas > 0 && resumo.falhas / tentativas >= FRACAO_DE_FALHA_QUE_REPROVA;
    /*
      E A LINHA DIZ POR QUÊ. O motivo mais frequente vai junto do número: sem
      ele, "as 165 consultas falharam" manda quem lê procurar no stdout do
      Railway, que tem retenção própria e some.
    */
    const dominante = Object.entries(resumo.motivosDeFalha ?? {})
      .sort((x, y) => y[1] - x[1])[0];
    const porQue = dominante ? ` Motivo mais frequente: ${dominante[0]}` : '';
    await this.logSync.registrar({
      fonte: FONTE_DJEN,
      origem,
      // Uma rodada em que a MAIORIA falhou não é bem-sucedida. Uma que
      // consultou e não achou nada é — e é o caso normal de fim de semana.
      // Etapa final que quebrou também não é: a tarefa que ela criaria não
      // nasceu.
      sucesso: !quebrou && tentativas > 0 && !aMaioriaFalhou && etapas.length === 0,
      novasMovimentacoes: resumo.ingeridas,
      duracaoMs: Date.now() - iniciadaEm,
      mensagemErro: naFrente + (quebrou
        ? `Varredura interrompida: ${quebrou}`
        : tentativas === 0
          ? 'Varredura sem alvo: nenhum advogado com OAB e nenhum processo elegível.'
          : tudoFalhou
            ? `Varredura sem resposta: as ${tentativas} consulta(s) falharam.${porQue}`
            : resumo.falhas > 0
              ? `Varredura concluída com ${resumo.falhas} de ${tentativas} consulta(s) em falha${maiorLeitura}.${porQue}`
              : `Varredura concluída: ${tentativas} consulta(s), ${resumo.ingeridas} publicação(ões) nova(s)` +
                maiorLeitura +
                // Quantos processos tiveram o histórico lido inteiro esta noite: é
                // o único lugar onde a colheita aparece sem abrir o stdout.
                ((resumo.historicosLidos ?? 0) > 0
                  ? `, ${resumo.historicosLidos} histórico(s) lido(s) pelo número`
                  : '') +
                // A ação nossa ainda sem cadastro só é mensurável aqui: a publicação
                // de terceiro não é persistida, então sem esta frase ninguém saberia
                // se a detecção achou algo. Só aparece quando achou.
                (resumo.sugeridas > 0
                  ? `, ${resumo.sugeridas} ação(ões) nossa(s) sem cadastro.`
                  : '.')),
    });
  }

  /**
   * Casa a publicação com a instância pelo nome do órgão julgador.
   *
   * Comparação normalizada (sem acento, maiúsculas): o DJEN escreve "Vara Única
   * da Comarca de Simões" e o DataJud, "VARA ÚNICA DE SIMÕES" — nunca batem por
   * igualdade literal. Sem casamento devolve null, e a publicação fica
   * pendurada no processo: é degradação aceitável, o vínculo com a instância é
   * conveniência de exibição, não requisito.
   */
  private casarInstancia(
    instancias: { id: string; orgaoJulgador: string | null }[],
    nomeOrgao: string | null,
  ): string | null {
    if (!nomeOrgao || instancias.length === 0) return null;
    if (instancias.length === 1) return instancias[0].id;

    const alvo = normalizar(nomeOrgao);
    if (!alvo) return null;

    const exata = instancias.find((i) => normalizar(i.orgaoJulgador) === alvo);
    if (exata) return exata.id;

    // Contido: "VARA UNICA DE SIMOES" ⊂ "VARA UNICA DA COMARCA DE SIMOES".
    const parcial = instancias.find((i) => {
      const nome = normalizar(i.orgaoJulgador);
      return !!nome && (nome.includes(alvo) || alvo.includes(nome));
    });
    return parcial?.id ?? null;
  }

  /**
   * QUEM É CONSULTADO PELO NÚMERO ESTA NOITE — todo processo vivo, e os dormentes a cada 7 dias.
   *
   * Encerrados com instância viva entram também — mesma regra da varredura do
   * DataJud: a baixa é de um grau, não do processo.
   *
   * A TRAVA DE 30 DIAS SAIU (14/09/2026). Até aqui só entrava quem estava 30
   * dias sem NENHUMA publicação gravada, por qualquer via. Num processo em que a
   * OAB nossa não aparece no ato (advogado de fora, substabelecido, ato dirigido
   * à parte), a primeira publicação achada tirava o processo da consulta por 30
   * dias, e o ato seguinte chegava tarde ou virava FORA_DA_JANELA. Agora cada
   * consulta lê só a janela desde a última (`janelaDoNumero`), uma requisição
   * por processo: ~150 vivos, uns 11 minutos a 14 por minuto.
   *
   * `jaLidos` são os que tiveram o histórico lido nesta mesma rodada: o
   * histórico já cobre a janela, e ler de novo só gastaria cota.
   *
   * RODÍZIO: ordena por `ultimaConsultaDjen` com os NUNCA consultados primeiro,
   * e corta no teto da rodada. É o que mantém a duração previsível num acervo
   * que cresce — e o que garante que a fatia deixada para trás hoje seja a
   * primeira de amanhã, em vez de ficar no escuro para sempre.
   */
  private processosParaConsultarPorNumero(jaLidos: string[] = []) {
    return this.prisma.processo.findMany({
      where: {
        numeroCNJ: { not: null },
        ...(jaLidos.length ? { id: { notIn: jaLidos } } : {}),
        /*
          AS MESMAS DUAS FAIXAS DO LADO DATAJUD — e pela mesma razão.

          A regra aqui era uma lista de quem ENTRA (`ATIVO`, `PENDENTE`, e
          `ENCERRADO` com instância viva), escrita à mão. Toda vez que o enum
          ganha um estado, ele nasce de FORA sem ninguém perceber: foi o caso de
          GANHO_EXECUCAO ("procedente, em fase de execução") e de SUSPENSO.
          Processo em execução tem prazo, penhora e audiência — e era exatamente
          ele que o Diário deixava de consultar, em silêncio.

          `varredura.util` já resolvia isso do outro lado, com a lista viva e a
          dormente separadas. O DJEN não pode reusar `filtroDeVarredura` inteiro
          porque o carimbo dele é outro (`ultimaConsultaDjen`, e não
          `ultimaSincronizacao`), mas pode — e deve — reusar as DEFINIÇÕES. Era
          a duplicação dos nomes que produzia a divergência.

          Faixa rápida: o que está vivo, toda noite. Faixa lenta: o dormente, a
          cada `DIAS_RECHECAGEM_DORMENTE` dias, porque a cota do CNJ não
          comporta reconsultar o acervo inteiro por um evento raro — e "raro"
          não é "nunca": a execução recomeça, o arquivado é desarquivado.
        */
        OR: [
          { statusInterno: { in: STATUS_VIVOS } },
          // A baixa é de um GRAU, não do processo: encerrado com instância viva
          // ainda anda (é o cumprimento de sentença correndo no 1º grau).
          { statusInterno: StatusProcesso.ENCERRADO, instancias: { some: { baixada: false } } },
          {
            statusInterno: { in: DORMENTES },
            // Sem carimbo não há como afirmar que já foi olhado; silêncio não
            // vale por "está em dia".
            OR: [
              { ultimaConsultaDjen: null },
              { ultimaConsultaDjen: { lt: new Date(Date.now() - DIAS_RECHECAGEM_DORMENTE * 24 * 3_600_000) } },
            ],
          },
        ],
      },
      select: { id: true, numeroCNJ: true, ultimaConsultaDjen: true },
      orderBy: { ultimaConsultaDjen: { sort: 'asc', nulls: 'first' } },
      take: this.maxProcessosPorRodada,
    });
  }

  /**
   * QUEM AINDA NÃO TEVE O HISTÓRICO LIDO PELO NÚMERO — os mais recentes no sistema primeiro.
   *
   * Medido em 14/09/2026: os 37 processos cadastrados depois da carga de 04/09
   * têm ato do DJEN em só 38,4% dos dias em que o DataJud registrou publicação
   * (84,5% nos anteriores). Quem entrou por último é quem mais falta, e é quem
   * alguém está olhando agora.
   *
   * Só a faixa rápida (vivo, ou encerrado com instância viva). O dormente não
   * gera trabalho com o histórico: tudo o que ele traria tem mais de 30 dias e
   * vira só rótulo. Se ele voltar a andar, entra aqui na noite em que mudar de
   * status. Teto por noite em `DJEN_HISTORICO_POR_RODADA` (padrão 200).
   */
  private processosSemHistorico() {
    return this.prisma.processo.findMany({
      where: {
        numeroCNJ: { not: null },
        djenHistoricoLidoEm: null,
        OR: [
          { statusInterno: { in: STATUS_VIVOS } },
          { statusInterno: StatusProcesso.ENCERRADO, instancias: { some: { baixada: false } } },
        ],
      },
      select: { id: true, numeroCNJ: true, ultimaConsultaDjen: true },
      orderBy: { createdAt: 'desc' },
      take: this.historicoPorRodada,
    });
  }
}

/**
 * Quantos caracteres a lista de etapas com falha pode ocupar na linha de resumo.
 *
 * O log corta a mensagem em 500. Com o ATENÇÃO (~60) e o teto (até ~290) na
 * frente, 250 deixam ao menos a primeira etapa inteira dentro do corte.
 */
const ORCAMENTO_DAS_ETAPAS = 250;

/** MAIÚSCULAS sem acento, espaços colapsados — para comparar nome de órgão. */
function normalizar(texto: string | null | undefined): string {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[^\x00-\x7F]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}
