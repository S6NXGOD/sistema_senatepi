import { Injectable, Logger } from '@nestjs/common';
import { StatusCompromisso, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NpuUtils } from './utils/npu.util';
import { AgendaService } from '../agenda/agenda.service';
import { classificarMovimentacao, type GatilhoMovimentacao } from './utils/audiencia.util';
import { montarUrgencia } from '../agenda/equipe.util';
import {
  diaBR,
  diaDeCalendarioBR,
  formatarDataBR,
  formatarDataHoraBR,
  noveDaManhaBR,
  proximoHorarioUtilBR,
  somarDiasUteisEmCalendario,
} from './utils/data-br.util';
import { DIAS_ATO_RECENTE } from './utils/janela-do-robo.util';

/**
 * A RÉGUA MORA EM `utils/janela-do-robo.util.ts` DESDE 17/09/2026.
 *
 * O valor e o porquê inteiro estão lá, ao lado dos outros três números que
 * mandam na automação (janela de captura, prazo de conferência, janela do
 * casamento). Aqui fica só a PORTA: `correlacao.service.ts` importa
 * `DIAS_ATO_RECENTE` deste arquivo desde que a correlação existe, e trocar o
 * caminho de importação em quem não é desta frente seria mexer onde não devo.
 *
 * Reexportar não é duplicar: há um valor só, com um dono só.
 */
export { DIAS_ATO_RECENTE };

/**
 * Slugs de `tipos_evento` que o robô usa.
 *
 * O tipo PRAZO saiu desta lista em 17/09/2026: o único lugar que o escrevia era
 * o criador cego, e ele parou de criar. O slug continua existindo no seed e na
 * Agenda — quem marca prazo é gente, e o caminho do Diário, que sabe qual é o
 * prazo, escolhe o tipo por providência (`providencia.util.ts`).
 */
const TIPO_AUDIENCIA = 'AUDIENCIA';
const TIPO_PERICIA = 'PERICIA';
/** Aviso ao filiado: tipo próprio, com desfechos que perguntam se ele soube. */
const TIPO_CONTATO = 'CONTATO';

/**
 * O preparo entra como DILIGÊNCIA — um tipo que já existe e já tem cor e nome.
 *
 * Criar um tipo novo para uma tarefa do robô sairia caro em toda a casa (seed
 * nos dois sindicatos, filtro, legenda, cor) para dizer o que o título já diz.
 * "Preparar audiência — Fulano" é uma diligência, e é assim que se lê na tela.
 */
const TIPO_PREPARO = 'DILIGENCIA';

/**
 * DIAS ÚTEIS DE PREPARO ANTES DA PAUTA.
 *
 * Dois, e não um: com um só, a audiência de segunda avisa na sexta à tarde —
 * que na prática é avisar no dia. Com dois há uma manhã inteira para pedir
 * documento ao filiado, falar com testemunha e ler o processo.
 */
const DIAS_UTEIS_DE_PREPARO = 2;
const TIPO_ACOMPANHAMENTO = 'ACOMPANHAMENTO';
/**
 * TÍTULO GENÉRICO DA TAREFA DE PRAZO — e uma SENTINELA, não só um rótulo.
 *
 * Sem o teor do ato, o robô não tem como dizer mais do que "confira isto": o
 * DataJud entrega o rótulo ("Publicação", "Expedição de documento") e deixa
 * `conteudo` nulo. Quem sabe se é contestação, manifestação ou embargos é o
 * DJEN, que traz o texto — e é por isso que `correlacao.service.ts` COMPARA com
 * esta string exata: título genérico pode ser promovido a um específico quando
 * a publicação chega; título que uma pessoa editou, não.
 *
 * Era um literal repetido nos dois arquivos. Renomear num só desligaria a
 * promoção em silêncio — nada quebraria, o título simplesmente pararia de
 * melhorar, e ninguém descobriria. Agora é uma constante só, importada lá.
 *
 * DESDE 17/09/2026 NINGUÉM CRIA TAREFA COM ESTE TÍTULO — e ele continua aqui de
 * propósito. As 5 que sobraram PENDENTES na produção ainda estão na agenda de
 * alguém, e a promoção pelo DJEN é justamente o que pode transformá-las em algo
 * que se entenda. Apagar a constante desligaria a melhora dessas cinco.
 */
export const TITULO_PRAZO_GENERICO = 'Verificação de Intimação / Prazo';

/**
 * POR QUE O ROBÔ NÃO ABRIU TAREFA — o vocabulário do carimbo (17/09/2026).
 *
 * Vai para `MovimentacaoProcessual.avaliadoMotivo`, colunas PRÓPRIAS do robô.
 * Nunca para `dispensadoEm/Por/Motivo`: aquelas são a dispensa de uma PESSOA no
 * radar de audiências, e `atoAcionavel` apaga o selo âmbar quando as vê. Usá-las
 * aqui, como eu fiz na primeira versão desta mudança, troca tarefa inútil por
 * silêncio: o ato sairia da agenda E da tela no mesmo movimento.
 *
 * Toda decisão fica gravada com motivo, sempre. Sem carimbo, "andamento sem
 * tarefa" é indistinguível de "o robô falhou", e foi exatamente essa dúvida que
 * o dono relatou: "muitas vezes não confiamos se é nossa parte que tem que
 * atuar".
 */
export const MOTIVOS_DO_ROBO = {
  /**
   * O ÍNDICE DO CNJ NÃO MANDA O TEXTO — o motivo do caminho cego, sempre.
   *
   * O DataJud entrega o RÓTULO do ato ("Publicação", "Expedição de documento")
   * e deixa `conteudo` nulo. Com isso o robô não sabe o que foi pedido, de quem
   * é o prazo, nem se há prazo. A tarefa que ele conseguia escrever dizia
   * "confira o teor no sistema do tribunal" — e o número mostra o que isso
   * virou: das 48 "Verificação de Intimação / Prazo", 32 foram CANCELADAS
   * (67%), 11 concluídas (9 delas com desfecho PRAZO_SEM_PECA, ou seja, "não
   * havia peça a fazer") e 47 nasceram atrasadas.
   *
   * O ato não some: ele fica com o selo âmbar na tela, que é aviso (ESTADO) e
   * não tarefa com dono e data.
   */
  SEM_TEOR_NO_DATAJUD: 'SEM_TEOR_NO_DATAJUD',

  /**
   * FORA DA JANELA — o ato é mais velho que qualquer prazo ordinário.
   *
   * Passados os 15 dias de `DIAS_ATO_RECENTE`, o prazo processual, se havia, já
   * correu. Continua sem tarefa pelo mesmo motivo que o anterior, mas a
   * distinção importa para a tela: "não sei o que é" e "já passou" pedem frases
   * diferentes de quem for ler.
   *
   * Substitui `ANDAMENTO_ANTIGO_SEM_TEOR`, que foi o vocabulário de algumas
   * horas em 17/09/2026 — a migração e a varredura movem o que houver com ele.
   */
  ANDAMENTO_ANTIGO: 'ANDAMENTO_ANTIGO',

  /**
   * O TEOR JÁ ESTÁ NO BANCO, VINDO DO DIÁRIO — quem decide é o outro caminho.
   *
   * ESTA FRENTE NÃO ESCREVE ESTE MOTIVO. A constante fica exportada e
   * documentada porque quem vai carimbá-la é a frente do casamento
   * DataJud × DJEN, e um vocabulário só tem de ter um dono só.
   *
   * O que ela significa: das 294 movimentações de publicação/intimação dos 60
   * dias anteriores a 17/09/2026, 153 têm publicação do Diário até 5 dias ANTES
   * do ato — e 106 dessas viraram tarefa cega mesmo com o teor já no banco. O
   * DJEN chega em D+0 e o DataJud tem mediana de 62 dias de atraso: na prática o
   * teor chega PRIMEIRO, e a janela de casamento só aceitava publicação DEPOIS
   * do ato. Os dois lados agora têm tamanhos próprios
   * (`DIAS_CASAMENTO_PUBLICACAO_ANTES` / `..._DEPOIS`, em `janela-do-robo.util`).
   */
  TEOR_NO_DIARIO: 'TEOR_NO_DIARIO',
} as const;

export type MotivoDoRobo = (typeof MOTIVOS_DO_ROBO)[keyof typeof MOTIVOS_DO_ROBO];

/**
 * O VOCABULÁRIO DE ALGUMAS HORAS — e por que ele não pode ser esquecido.
 *
 * `ANDAMENTO_ANTIGO_SEM_TEOR` é o que a primeira versão deste caminho gravava
 * em `dispensado_motivo` — as colunas da DISPENSA HUMANA. Ele existe
 * em dois lugares que precisam concordar: o UPDATE da migração
 * `20260917100000_carimbo_do_robo` e o reparo que roda em toda varredura
 * (`repararCarimboNasColunasDeGente`), porque o contêiner antigo pode escrevê-lo
 * de novo durante a janela de troca do deploy.
 *
 * Um teste compara este literal com o do SQL: dois lados, uma palavra só.
 */
export const MOTIVO_ANDAMENTO_ANTIGO_LEGADO = 'ANDAMENTO_ANTIGO_SEM_TEOR';

/** Título fixo — é por ele que a tarefa de confirmação é reconhecida e não duplica. */
const TITULO_CONFIRMAR_AUDIENCIA = 'Confirmar data da audiência designada';

/**
 * Soma dias ÚTEIS — agora com contrato explícito, em `data-br.util`.
 *
 * A versão que morava aqui pulava o fim de semana com `d.getDay()`, que
 * responde no fuso do PROCESSO. No contêiner (UTC) isso acertava por acidente
 * para uma coluna `date` e errava para instante de verdade: medido com
 * `TZ=UTC`, **113 de 2.000 movimentações** (5,7%) davam um prazo diferente do
 * correto, e o exemplo medido erra por DOIS dias.
 *
 * A ambiguidade era a doença — a mesma função recebia os dois tipos de valor.
 * `somarDiasUteisEmCalendario` exige um DIA DE CALENDÁRIO (meia-noite UTC), e
 * quem tem um instante converte com `diaDeCalendarioBR` antes de chamar.
 *
 * O nome antigo fica como ponte para não quebrar quem importa daqui.
 */
export const somarDiasUteis = somarDiasUteisEmCalendario;

interface MovimentacaoParaAutomacao {
  id: string;
  descricao: string;
  detalhe?: string | null;
  conteudo?: string | null;
  codigoMovimento?: number | null;
  dataMovimento: Date;
  ehAudiencia?: boolean;
  audienciaData?: Date | null;
  compromissoId?: string | null;
  /** Complementos tabelados — carregam `situacao_da_audiencia`. */
  complementos?: unknown;
}

type ProcessoAlvo = {
  id: string;
  numeroCNJ: string | null;
  advogadoId: string | null;
  filiadoId: string | null;
  filiado: { nomeCompleto: string } | null;
};

/**
 * ROBÔ DE PRAZOS — transforma movimentações do DataJud em tarefas na Agenda.
 *
 * É chamado logo depois que movimentações NOVAS são gravadas (importação,
 * sincronização manual e varredura noturna). Nunca reprocessa: cada movimentação
 * carrega o `compromissoId` do evento que gerou, então rodar duas vezes não
 * duplica nada.
 *
 * Usa o MESMO classificador do radar de audiências (utils/audiencia.util.ts).
 * Antes eram duas regras concorrentes, e a diferença entre elas engolia
 * movimentações: o que o robô tratava como audiência sem data, o radar recusava
 * por não ser designação — e a intimação (com prazo correndo) não virava nada.
 *
 * Divisão de trabalho com o radar, agora explícita:
 *  - pauta COM data legível → o robô agenda e marca a movimentação, o que faz o
 *    alerta do radar sair da fila sozinho;
 *  - pauta SEM data → o robô NÃO adivinha; deixa para o radar, onde uma pessoa
 *    confirma a data antes de comprometer a agenda do advogado;
 *  - pauta que CAIU → cancela o compromisso que a designação anterior criou.
 */
@Injectable()
export class AutomacaoPrazosService {
  private readonly logger = new Logger(AutomacaoPrazosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly agenda: AgendaService,
  ) {}

  /** Classifica a movimentação pelo texto completo (nome + detalhe + teor). */
  detectar(m: {
    descricao: string;
    detalhe?: string | null;
    conteudo?: string | null;
    codigoMovimento?: number | null;
    dataMovimento?: Date | null;
    /** Complementos tabelados do CNJ — carregam `situacao_da_audiencia`. */
    complementos?: unknown;
  }): GatilhoMovimentacao {
    const texto = [m.descricao, m.detalhe, m.conteudo].filter(Boolean).join(' — ');
    return classificarMovimentacao(
      texto,
      m.codigoMovimento,
      m.dataMovimento,
      m.complementos as { descricao?: string | null; nome?: string | null }[] | null,
    );
  }

  /**
   * Processa as movimentações recém-gravadas de um processo.
   * Falhas são engolidas com log: a automação NUNCA pode derrubar a importação
   * ou a sincronização — perder um lembrete é aceitável, perder o processo não.
   */
  async processar(processoId: string, movimentacoes: MovimentacaoParaAutomacao[]): Promise<{
    audiencias: number;
    tarefasSecretaria: number;
    canceladas: number;
    /**
     * Atos de prazo que o robô AVALIOU e não virou tarefa — hoje, todos eles.
     *
     * O contador `prazos` saiu do resumo em 17/09/2026: ele contava tarefas
     * criadas por `criarPrazo`, e `criarPrazo` não cria mais nenhuma. Deixá-lo
     * marcando zero para sempre seria um número que só serve para enganar quem
     * lê o log.
     */
    avaliadosSemTarefa: number;
  }> {
    const resumo = { audiencias: 0, tarefasSecretaria: 0, canceladas: 0, avaliadosSemTarefa: 0 };
    if (!movimentacoes.length) return resumo;

    await this.repararCarimboNasColunasDeGente(processoId);

    try {
      const processo = await this.prisma.processo.findUnique({
        where: { id: processoId },
        select: {
          id: true, numeroCNJ: true, advogadoId: true, filiadoId: true,
          filiado: { select: { nomeCompleto: true } },
        },
      });
      if (!processo) return resumo;

      const responsavelId = await this.responsavelDoProcesso(processo.advogadoId);
      if (!responsavelId) {
        this.logger.warn('[AUTOMACAO] Nenhum usuário ativo para atribuir tarefas — nada criado.');
        return resumo;
      }
      const secretariaId = await this.usuarioSecretaria();

      // Da mais antiga para a mais nova: a redesignação de hoje precisa cancelar
      // a pauta de ontem, e não o contrário.
      const ordenadas = [...movimentacoes].sort(
        (a, b) => a.dataMovimento.getTime() - b.dataMovimento.getTime(),
      );

      for (const mov of ordenadas) {
        // Já gerou evento antes? Não repete.
        if (mov.compromissoId) continue;
        const gatilho = this.detectar(mov);

        if (gatilho.tipo === 'NENHUM') continue;

        if (gatilho.tipo === 'PAUTA_CAIU') {
          const n = await this.cancelarPauta(processo, mov, 'A pauta foi cancelada pelo juízo/órgão.');
          resumo.canceladas += n;
          continue;
        }

        if (gatilho.tipo === 'PRAZO') {
          /*
            CONTA DECISÃO, NÃO PASSADA. O ato de prazo não sai mais da fila da
            varredura — o carimbo mora em `avaliado*`, e o pré-filtro olha
            `compromissoId`/`dispensadoEm`. Somar aqui a cada volta faria o log
            noturno repetir os mesmos N para sempre, e quem lesse contaria
            reavaliação como decisão nova. É exatamente a aritmética que já
            produziu 1.243 falsos positivos nesta base.
          */
          resumo.avaliadosSemTarefa += (await this.avaliarPrazo(mov)).gravou;
          continue;
        }

        /**
         * AUDIÊNCIA SEM DATA — o caso NORMAL na Justiça do Trabalho.
         *
         * O movimento do CNJ diz que a audiência foi designada (complemento
         * `situacao_da_audiencia`) e NÃO diz quando: não há data no nome nem nos
         * complementos. Verificado nos movimentos do TRT22.
         *
         * Antes o robô simplesmente pulava, e a pauta só existia no radar — um
         * painel dentro da tela de Processos. Quem vive na Agenda não via nada.
         *
         * Agora entra uma TAREFA de confirmar a data. Repare que NÃO é a
         * audiência marcada num dia inventado: seria pior que o silêncio, porque
         * o calendário passaria a mostrar uma audiência que não existe naquele
         * dia. É uma tarefa real ("descobrir a data no PJe"), com data real
         * (próximo dia útil), que aponta para o processo.
         */
        if (!gatilho.data) {
          if (gatilho.tipo === 'AUDIENCIA' && (await this.criarConfirmacaoDeData(processo, mov, responsavelId))) {
            resumo.audiencias++;
          }
          continue;
        }
        // Remarcação: a data nova substitui a anterior. Sem isto a agenda ficava
        // com a audiência fantasma na data velha ao lado da nova.
        if (gatilho.substituiPauta) {
          resumo.canceladas += await this.cancelarPauta(
            processo,
            mov,
            'A audiência foi redesignada — veja a atividade com a data nova.',
          );
        }
        const criou = await this.criarPauta(processo, mov, gatilho, responsavelId, secretariaId);
        if (criou.compromisso) resumo.audiencias++;
        if (criou.tarefa) resumo.tarefasSecretaria++;
      }

      if (resumo.audiencias || resumo.canceladas || resumo.avaliadosSemTarefa) {
        this.logger.log(
          `[AUTOMACAO] ${processo.numeroCNJ}: ` +
            `${resumo.audiencias} pauta(s), ${resumo.tarefasSecretaria} tarefa(s) de secretaria, ` +
            `${resumo.canceladas} cancelamento(s), ` +
            `${resumo.avaliadosSemTarefa} ato(s) de prazo avaliado(s) sem tarefa.`,
        );
      }
    } catch (err) {
      this.logger.error(`[AUTOMACAO] Falha ao processar o processo ${processoId}: ${(err as Error).message}`);
    }
    return resumo;
  }

  // -------------------------------------------------------------------------

  /**
   * O ATO DE PRAZO É AVALIADO E CARIMBADO — E NÃO VIRA MAIS TAREFA (17/09/2026).
   *
   * O QUE ESTE MÉTODO ERA. Ele criava "Verificação de Intimação / Prazo": uma
   * tarefa com dono e data cujo texto dizia, em resumo, "abra o PJe e descubra o
   * que estão pedindo". Era o melhor que dava para escrever, porque AQUI O ROBÔ
   * NÃO TEM O TEOR — o DataJud entrega o rótulo do ato ("Publicação",
   * "Expedição de documento") e deixa `conteudo` nulo. Sem o texto, ele não sabe
   * o que foi pedido, de quem é o prazo, nem se há prazo.
   *
   * O QUE A PRODUÇÃO DISSE SOBRE ISSO. Das 48 criadas:
   *
   *   · 32 CANCELADAS (67%);
   *   · 11 concluídas — e 9 dessas com desfecho PRAZO_SEM_PECA, que é a equipe
   *     dizendo por escrito "não havia peça a fazer";
   *   ·  5 pendentes;
   *   · 47 nasceram atrasadas.
   *
   * No acervo inteiro do robô (89 atividades) são 45 canceladas, metade. E ao
   * lado, o contraexemplo: "Cadastrar ação do Diário" fez 12 de 12 concluídas em
   * zero dia, nenhuma cancelada — porque ela diz exatamente o que fazer.
   *
   * O pedido do dono foi esse: "não quero tarefas já com prazo matando o
   * advogado; se for algo urgente, mande um alerta, mas não encha de tarefas
   * desnecessárias".
   *
   * O QUE ENTRA NO LUGAR. Um AVISO, que é estado e não tarefa: o selo âmbar de
   * `atoAcionavel` continua aceso no ato (as colunas do robô não o calam, ver
   * `tpu.util.ts`), e o carimbo explica na tela por que não há tarefa. Com o
   * criador cego parado sobram 27 atos com selo, em 26 processos, espalhados por
   * cinco advogados e dominados por DECISÕES — que é o que o dono quer ver.
   *
   * O QUE **NÃO** MUDOU, e de propósito: a pauta (audiência/perícia), o preparo,
   * o aviso ao filiado e a confirmação de data continuam sendo criados. São
   * trabalho com dono e data conhecidos, e têm aproveitamento de 100%.
   */
  /**
   * TIRA O CARIMBO DO ROBÔ DE CIMA DAS COLUNAS DE GENTE — toda varredura.
   *
   * O NÚMERO, PARA NÃO SE CONTAR HISTÓRIA: a produção tem ZERO linhas com esse
   * carimbo (conferido em 17/09/2026). O código errado chegou a subir, mas a
   * varredura das 02h não rodou sob ele — o defeito foi pego antes de produzir
   * dado. As 65 dispensas que existem hoje têm AUTOR e outro motivo: são o
   * efeito de cancelar 29 tarefas inúteis pela porta da Agenda, que é a decisão
   * de gente funcionando como deve. Isto aqui é precaução, não faxina.
   *
   * POR QUE ISTO NÃO PODE SER SÓ A MIGRAÇÃO. Em 17/09/2026 a primeira versão
   * deste caminho gravou a decisão do robô em
   * `dispensadoEm/dispensadoPor/dispensadoMotivo`, que são a DISPENSA HUMANA do
   * radar de audiências. `atoAcionavel` apaga o selo âmbar quando vê
   * `dispensadoEm`: o andamento ficaria mudo — seria trocar tarefa inútil por
   * silêncio, que é pior. A migração `20260917100000_carimbo_do_robo` move
   * essas linhas para as colunas próprias.
   *
   * Só que a migração é de tiro único e o deploy desta casa tem JANELA DE TROCA:
   * o contêiner ANTIGO atende contra o banco já migrado enquanto o novo sobe.
   * Basta uma sincronização nessa janela — ou o cron das 02h pegá-la — para o
   * código velho carimbar de novo, nas mesmas colunas. Essas linhas nasceriam
   * mudas e nada mais as alcançaria: a migração já rodou, o código novo não lê
   * `dispensado_*` do robô, e sem selo não há cartão com o botão "Desfazer"
   * para uma pessoa consertar.
   *
   * AS DUAS TRAVAS SÃO AS DA MIGRAÇÃO, e elas são o que torna isto seguro:
   * o motivo literal só foi escrito pelo robô velho, e dispensa de gente SEMPRE
   * grava autor. Na segunda execução não casa nada — o próprio UPDATE se
   * desarma.
   *
   * Se voltar a encontrar linhas, isso é notícia: significa que o contêiner
   * antigo escreveu depois da migração. Por isso o log é `warn`.
   */
  private async repararCarimboNasColunasDeGente(processoId: string): Promise<void> {
    try {
      const n = await this.prisma.$executeRaw`
        UPDATE "movimentacoes_processuais"
           SET "avaliado_em" = COALESCE("avaliado_em", "dispensado_em"),
               "avaliado_por" = NULL,
               "avaliado_motivo" = ${MOTIVOS_DO_ROBO.ANDAMENTO_ANTIGO},
               "dispensado_em" = NULL,
               "dispensado_por" = NULL,
               "dispensado_motivo" = NULL
         WHERE "processo_id" = ${processoId}
           AND "dispensado_motivo" = ${MOTIVO_ANDAMENTO_ANTIGO_LEGADO}
           AND "dispensado_por" IS NULL`;
      if (n > 0) {
        this.logger.warn(
          `[AUTOMACAO] Processo ${processoId}: ${n} andamento(s) tinham o carimbo do robô nas ` +
            'colunas de dispensa humana e voltaram a mostrar o selo.',
        );
      }
    } catch (err) {
      // Nunca derruba a varredura: o reparo tenta de novo na próxima.
      this.logger.warn(`[AUTOMACAO] Falha ao reparar carimbo antigo: ${(err as Error).message}`);
    }
  }

  private async avaliarPrazo(
    mov: MovimentacaoParaAutomacao,
  ): Promise<{ motivo: MotivoDoRobo; gravou: number }> {
    const idadeDoAtoDias = Math.floor(
      (Date.now() - mov.dataMovimento.getTime()) / 86_400_000,
    );

    /*
      DOIS MOTIVOS PARA A MESMA AUSÊNCIA DE TAREFA, e a distinção é para quem
      lê a tela: "o índice do CNJ não mandou o texto" e "isto já passou" pedem
      frases diferentes. A régua é a de sempre (`DIAS_ATO_RECENTE`) — duas
      réguas para a mesma pergunta seria a receita de "urgente sem tarefa".
    */
    const motivo: MotivoDoRobo =
      idadeDoAtoDias > DIAS_ATO_RECENTE
        ? MOTIVOS_DO_ROBO.ANDAMENTO_ANTIGO
        : MOTIVOS_DO_ROBO.SEM_TEOR_NO_DATAJUD;

    /*
      `gravou` é 0 quando o andamento JÁ estava com este mesmo motivo — a
      varredura o reencontra toda noite, e reavaliação não é decisão nova.
    */
    const gravou = await this.carimbarAvaliacao(mov.id, motivo);
    return { motivo, gravou };
  }

  /**
   * GRAVA A DECISÃO DO ROBÔ na movimentação — uma vez, e sem apagar a de gente.
   *
   * COLUNAS PRÓPRIAS. `avaliadoEm/avaliadoPor/avaliadoMotivo` existem porque a
   * primeira versão disto, algumas horas antes no mesmo 17/09/2026, escrevia em
   * `dispensadoEm/dispensadoPor/dispensadoMotivo` — que é a dispensa HUMANA do
   * radar de audiências. `atoAcionavel` apaga o selo âmbar quando vê
   * `dispensadoEm`, então o resultado foi trocar tarefa inútil por silêncio, em
   * o andamento inteiro. O robô nunca escreve nas colunas da pessoa.
   *
   * `avaliadoPor` fica NULO: é decisão do robô, não de gente. A coluna existe
   * para o dia em que uma pessoa disser "não é nada" por este caminho — e aí o
   * id dela entra, sem que ninguém precise adivinhar pela ausência.
   *
   * POR QUE `updateMany` COM CONDIÇÃO, E NÃO `update`. O ato carimbado continua
   * elegível no pré-filtro de `dispararAutomacao` (que só exclui a dispensa de
   * gente), então a varredura o reencontra TODA NOITE. Com `update` simples, a
   * data da decisão viraria a data da última varredura e o "quando o robô
   * decidiu" se perderia — e é o carimbo, não a ausência, que a casa lê.
   *
   * Reescreve só quando o motivo MUDA (o ato envelhece e passa de
   * `SEM_TEOR_NO_DATAJUD` para `ANDAMENTO_ANTIGO`; ou o teor do Diário chega e
   * a outra frente carimba `TEOR_NO_DIARIO`).
   *
   * O `OR` tem três braços de propósito: `{ not: X }` NÃO casa linha nula no
   * Prisma, então sem `{ avaliadoMotivo: null }` explícito a linha carimbada por
   * engano com motivo vazio nunca seria corrigida. Esta base já perdeu uma
   * varredura inteira (0 de 3.150) por esse mesmo detalhe.
   */
  private async carimbarAvaliacao(movimentacaoId: string, motivo: MotivoDoRobo): Promise<number> {
    const r = await this.prisma.movimentacaoProcessual.updateMany({
      where: {
        id: movimentacaoId,
        /*
          DOIS FILTROS, E EM `AND` DE PROPÓSITO. Dois `OR` no mesmo objeto se
          sobrescrevem no Prisma — o segundo apaga o primeiro e ninguém avisa.
        */
        AND: [
          // 1. Não reescreve o mesmo motivo (senão a data da decisão do robô
          //    vira a data da última varredura).
          {
            OR: [
              { avaliadoEm: null },
              { avaliadoMotivo: null },
              { avaliadoMotivo: { not: motivo } },
            ],
          },
          /*
            2. E NUNCA APAGA A LEITURA DO TEOR COM UMA DEDUÇÃO DE AUSÊNCIA.

            Quando o Diário chega, a frente da correlação carimba o andamento
            com `TEOR_NO_DIARIO` e NÃO grava `compromissoId` nos ramos em que a
            publicação foi dispensada (ordem da outra parte, cópia do mesmo ato,
            sem providência). O andamento portanto continua caindo no pré-filtro
            da varredura, toda noite — e o caminho cego reescreveria o carimbo
            com `SEM_TEOR_NO_DATAJUD`, cuja frase na tela é "o tribunal avisou
            que houve um ato, mas não disse o que ele pede".

            Seria o sistema apagando o que SABE (leu o teor, soube de quem era a
            ordem) para afirmar o que NÃO sabe. A regra da casa é a mesma desde
            o alarme que contradizia o robô: grave a decisão, não deduza da
            ausência — e uma decisão tomada com o texto na mão vale mais que uma
            tomada sem ele.
          */
          ...(motivo === MOTIVOS_DO_ROBO.TEOR_NO_DIARIO
            ? []
            : [{
              OR: [
                { avaliadoMotivo: null },
                { avaliadoMotivo: { not: MOTIVOS_DO_ROBO.TEOR_NO_DIARIO } },
              ],
            }]),
        ],
      },
      data: {
        avaliadoEm: new Date(),
        avaliadoPor: null, // é decisão do robô, não de gente
        avaliadoMotivo: motivo,
      },
    });
    return r.count;
  }

  /**
   * A AUDIÊNCIA FOI AGENDADA — FECHE O LEMBRETE QUE MANDAVA AGENDÁ-LA.
   *
   * O DEFEITO QUE ISTO CONSERTA. "Confirmar data da audiência designada" e o
   * radar de audiências mostram O MESMO TRABALHO em duas telas — de propósito,
   * porque quem vive na Agenda não abre a tela de Processos. Só que resolver
   * pelo radar (`AudienciasService.agendar`) criava o compromisso da audiência,
   * carimbava a movimentação... e deixava a tarefa aberta para sempre. A pessoa
   * fazia o trabalho e o lembrete continuava lá, cobrando.
   *
   * Com a escalada por tempo cego, isso ficaria pior: a tarefa de um trabalho
   * JÁ FEITO passaria a urgente depois de quinze dias.
   *
   * O método mora AQUI, e não no serviço de audiências, porque a identidade
   * desta tarefa (tipo, título, origem automática) é conhecimento deste arquivo.
   * Espalhá-la seria criar um segundo lugar para manter em dia — e nesta base já
   * houve defeito demais nascido exatamente assim.
   */
  async fecharConfirmacaoDeData(processoId: string, motivo: string): Promise<number> {
    const { count } = await this.prisma.compromisso.updateMany({
      where: {
        processoId,
        tipo: TIPO_ACOMPANHAMENTO,
        origemAutomatica: true,
        titulo: TITULO_CONFIRMAR_AUDIENCIA,
        status: { in: [StatusCompromisso.PENDENTE, StatusCompromisso.EM_ANDAMENTO] },
      },
      data: {
        status: StatusCompromisso.CONCLUIDO,
        concluidoEm: new Date(),
        /**
         * A urgência SAI junto. Se a tarefa tinha escalado, deixar a marca numa
         * atividade concluída sujaria qualquer relatório de urgências —
         * `montarUrgencia(false, …)` limpa os quatro campos de uma vez.
         */
        ...montarUrgencia(false, null, { origem: 'AUTOMACAO' }),
        desfechoObs: motivo,
      },
    });
    if (count) {
      this.logger.log(
        `[AUTOMACAO] ${processoId}: ${count} lembrete(s) de confirmar data encerrado(s) — ${motivo}`,
      );
    }
    return count;
  }

  /**
   * Tarefa "descobrir quando é a audiência".
   *
   * NÃO CARIMBA a movimentação. O carimbo (`compromissoId`) significa "este ato
   * já virou compromisso" e é o que tira o item do radar — e o radar é onde
   * mora o fluxo de agendar a audiência de verdade, com data. Se carimbasse, a
   * tarefa tiraria do radar justamente a coisa que ela manda fazer.
   *
   * A proteção contra duplicar é outra: uma tarefa aberta por processo. A
   * varredura noturna reencontra a mesma movimentação todo dia (ela segue sem
   * carimbo) e não cria uma segunda. Para o lembrete parar de vez, o caminho é
   * dispensar no radar — `dispararAutomacao` já não traz o que foi dispensado.
   */
  private async criarConfirmacaoDeData(
    processo: ProcessoAlvo,
    mov: MovimentacaoParaAutomacao,
    responsavelId: string,
  ): Promise<boolean> {
    const existente = await this.prisma.compromisso.findFirst({
      where: {
        processoId: processo.id,
        tipo: TIPO_ACOMPANHAMENTO,
        origemAutomatica: true,
        titulo: TITULO_CONFIRMAR_AUDIENCIA,
        status: { in: [StatusCompromisso.PENDENTE, StatusCompromisso.EM_ANDAMENTO] },
      },
      select: { id: true, urgente: true },
    });

    const diasCegos = Math.floor(
      (Date.now() - mov.dataMovimento.getTime()) / 86_400_000,
    );

    if (existente) {
      /**
       * A TAREFA ESCALA COM O TEMPO, em vez de nascer gritando.
       *
       * A varredura reencontra esta movimentação toda noite (ela nunca é
       * carimbada, de propósito — ver o comentário do método). Isso dá de graça
       * o único jeito honesto de priorizar uma pauta cuja data ninguém conhece:
       * pelo tempo que estamos cegos.
       *
       * Recém-designada, a sessão costuma estar a semanas de distância e não há
       * o que correr. Passados quinze dias sem alguém abrir o PJe, a audiência
       * pode ser na semana que vem — e aí sim é urgente, porque perder sessão é
       * revelia.
       */
      if (!existente.urgente && diasCegos > DIAS_ATO_RECENTE) {
        await this.prisma.compromisso.update({
          where: { id: existente.id },
          data: montarUrgencia(
            true,
            `Audiência designada há ${diasCegos} dias e a data continua desconhecida — ` +
              'a sessão pode estar próxima.',
            { origem: 'AUTOMACAO' },
          ),
        });
      }
      return false;
    }

    const inicio = proximoHorarioUtilBR(new Date());
    const detalhe = [mov.descricao, mov.detalhe].filter(Boolean).join(' — ');

    await this.prisma.compromisso.create({
      data: {
        titulo: TITULO_CONFIRMAR_AUDIENCIA,
        tipo: TIPO_ACOMPANHAMENTO,
        status: StatusCompromisso.PENDENTE,
        inicio,
        fim: new Date(inicio.getTime() + 3_600_000),
        descricao:
          `Processo ${NpuUtils.formatar(processo.numeroCNJ) || '(rascunho)'} — o tribunal registrou audiência DESIGNADA em ` +
          `${formatarDataBR(mov.dataMovimento)}, mas a base pública do CNJ não publica a data ` +
          `da sessão.

` +
          `O que fazer: abrir o processo no sistema do tribunal, ver a data e a hora, e agendar a ` +
          `audiência (na ficha do processo, em "Audiências a agendar").

` +
          `Andamento: ${detalhe}`,
        responsavelId,
        processoId: processo.id,
        filiadoId: processo.filiadoId,
        /**
         * NASCE NORMAL, e não urgente.
         *
         * O comentário antigo dizia "audiência sem data é risco de perder
         * sessão — nasce urgente", e o raciocínio está certo isolado. O que ele
         * não considerava é a FREQUÊNCIA: audiência sem data publicada é o caso
         * NORMAL na Justiça do Trabalho (está escrito algumas linhas acima, no
         * próprio arquivo), e 22 dos 41 processos da produção correm no TRT22 ou
         * no TST. Ou seja: quase toda pauta do acervo geraria uma tarefa
         * urgente, e vinte urgências simultâneas não são vinte prioridades — são
         * zero.
         *
         * A urgência agora vem do TEMPO CEGO, no bloco de escalada acima. A
         * tarefa já nasce vencendo no próximo dia útil, que é sinal de
         * prioridade suficiente para algo que ainda tem semanas de folga.
         */
        ...montarUrgencia(false, null, { origem: 'AUTOMACAO' }),
        origemAutomatica: true,
        criadoPor: null,
      },
    });
    return true;
  }

  /**
   * Pauta com data conhecida: agenda o responsável e avisa a secretaria.
   * O TIPO segue o classificador — perícia entra como PERICIA, e não como
   * audiência oferecendo "houve acordo" na hora de concluir.
   *
   * NÃO DUPLICA. A mesma audiência costuma chegar em duas movimentações — uma
   * reconhecida pelo código TPU 11025 e outra pelo texto "audiência … designada"
   * — e cada uma criava um evento. Dois compromissos idênticos na mesma data,
   * um deles fadado a ser cancelado à mão. A checagem espelha a que `criarPrazo`
   * já fazia: mesma pauta, mesmo dia (em Teresina), reaproveita.
   */
  private async criarPauta(
    processo: ProcessoAlvo,
    mov: MovimentacaoParaAutomacao,
    gatilho: Extract<GatilhoMovimentacao, { tipo: 'AUDIENCIA' | 'PERICIA' }>,
    responsavelId: string,
    secretariaId: string | null,
  ): Promise<{ compromisso: boolean; tarefa: boolean }> {
    const inicio = new Date(gatilho.data!);
    const ehPericia = gatilho.tipo === 'PERICIA';
    const rotulo = ehPericia ? 'Perícia' : 'Audiência';
    const nomeFiliado = processo.filiado?.nomeCompleto ?? 'filiado';
    const tipo = ehPericia ? TIPO_PERICIA : TIPO_AUDIENCIA;

    const jaAgendada = await this.pautaDoDia(processo.id, tipo, inicio);
    if (jaAgendada) {
      // Carimba a movimentação na pauta que já existe: sem isso ela voltaria a
      // ser candidata em toda varredura e continuaria pendente para o radar.
      await this.prisma.movimentacaoProcessual.update({
        where: { id: mov.id },
        data: { compromissoId: jaAgendada },
      });
      return { compromisso: false, tarefa: false };
    }

    const compromisso = await this.prisma.compromisso.create({
      data: {
        titulo: `${rotulo} — ${nomeFiliado}`,
        tipo,
        status: StatusCompromisso.PENDENTE,
        inicio,
        fim: new Date(inicio.getTime() + 3_600_000),
        descricao:
          `${rotulo} designada conforme andamento do DataJud: ${mov.descricao}.\n` +
          `Processo ${NpuUtils.formatar(processo.numeroCNJ) || '(rascunho)'}.`,
        responsavelId,
        processoId: processo.id,
        filiadoId: processo.filiadoId,
        origemAutomatica: true,
      },
      select: { id: true },
    });

    // Vincula à movimentação: além de evitar duplicata, isso RESOLVE o alerta do
    // radar de audiências (a fila dele é "ehAudiencia e sem compromisso").
    await this.prisma.movimentacaoProcessual.update({
      where: { id: mov.id },
      data: { compromissoId: compromisso.id },
    });

    // Tarefa para a secretaria avisar o filiado — só faz sentido se há a quem
    // atribuir e se o processo tem filiado vinculado.
    let tarefa = false;
    if (secretariaId && processo.filiadoId) {
      // Avisar com 2 dias úteis de antecedência (nunca depois da pauta).
      const aviso = new Date(inicio.getTime() - 2 * 24 * 3_600_000);
      // O aviso é ANTES da pauta; se a antecedência já passou, vale agora — e
      // não o próximo dia útil, que poderia cair depois da própria audiência.
      const inicioAviso = aviso > new Date() ? noveDaManhaBR(aviso) : new Date();

      /*
        UM AVISO POR PAUTA -- mas a checagem era larga demais.

        `pautaDoDia(processo, TIPO_CONTATO, dia)` pergunta "existe QUALQUER
        contato automatico deste processo neste dia?". Qualquer outro contato do
        robo no mesmo dia -- e o desfecho "Ligar para o filiado" cria um --
        suprimia o unico aviso de que existe audiencia. Sumia sem log, sem
        contagem (`tarefa` fica false) e sem marca nenhuma no compromisso.

        E o mesmo defeito que o preparo da pauta ja documenta: quando a tarefa
        divide o TIPO com outras, a chave de duplicidade tem de ser o TITULO.
      */
      const tituloAviso = `Avisar filiado — ${rotulo.toLowerCase()} de ${nomeFiliado}`;
      const avisoExistente = await this.prisma.compromisso.findFirst({
        where: {
          processoId: processo.id,
          titulo: tituloAviso,
          origemAutomatica: true,
          status: { in: [StatusCompromisso.PENDENTE, StatusCompromisso.EM_ANDAMENTO] },
        },
        select: { id: true },
      });
      if (!avisoExistente) {
        await this.prisma.compromisso.create({
          data: {
            titulo: tituloAviso,
            tipo: TIPO_CONTATO,
            status: StatusCompromisso.PENDENTE,
            inicio: inicioAviso,
            fim: new Date(inicioAviso.getTime() + 1800_000),
            descricao:
              `Confirmar presença do filiado na ${rotulo.toLowerCase()} de ${formatarDataHoraBR(inicio)}.\n` +
              `Processo ${NpuUtils.formatar(processo.numeroCNJ) || '(rascunho)'}.`,
            responsavelId: secretariaId,
            processoId: processo.id,
            filiadoId: processo.filiadoId,
            origemAutomatica: true,
          },
        });
        tarefa = true;
      }
    }

    await this.criarPreparoDaPauta(processo, rotulo, nomeFiliado, inicio, responsavelId);
    return { compromisso: true, tarefa };
  }

  /**
   * PREPARAR ANTES — a antecedência que não existia para quem vai à audiência.
   *
   * O que havia era o "Avisar filiado", e ele é outra coisa: é a secretaria
   * telefonando, e só nasce quando há `secretariaId` E `filiadoId`. Filiado
   * vinculado é raro no acervo (4 processos em 127 quando isto foi medido), e
   * ação institucional não tem filiado nenhum por definição. Resultado prático:
   * a esmagadora maioria das pautas não gerava aviso NENHUM, e a primeira coisa
   * que a equipe via era a audiência no dia dela.
   *
   * Esta tarefa é para quem vai atuar, não para o filiado, e por isso não
   * depende de haver filiado. Ela NÃO substitui a pauta e NÃO mexe na data
   * dela: a audiência continua marcada quando o juiz marcou — mover isso seria
   * o sistema mentindo sobre a data do ato.
   *
   * Se a designação chegar em cima da hora (o tribunal intima na véspera, e
   * acontece), o preparo não é criado: uma tarefa que nasce vencida é ruído, e
   * a pauta do dia já está na agenda de quem responde.
   */
  private async criarPreparoDaPauta(
    processo: ProcessoAlvo,
    rotulo: string,
    nomeFiliado: string,
    inicioDaPauta: Date,
    responsavelId: string,
  ): Promise<boolean> {
    const quando = noveDaManhaBR(
      somarDiasUteisEmCalendario(diaDeCalendarioBR(inicioDaPauta), -DIAS_UTEIS_DE_PREPARO),
    );
    // Nunca no passado e nunca depois da própria pauta.
    if (quando <= new Date() || quando >= inicioDaPauta) return false;

    /*
      Uma por pauta — e a checagem é pelo TÍTULO, não pelo tipo do dia.

      A mesma audiência chega em duas movimentações (código TPU e texto), e as
      duas passariam por aqui. `pautaDoDia` não serve: o preparo divide o tipo
      DILIGENCIA com outras tarefas, e uma diligência qualquer no mesmo dia
      faria o preparo ser pulado em silêncio.
    */
    const titulo = `Preparar ${rotulo.toLowerCase()} — ${nomeFiliado}`;
    const jaExiste = await this.prisma.compromisso.findFirst({
      where: {
        processoId: processo.id,
        titulo,
        origemAutomatica: true,
        status: { in: [StatusCompromisso.PENDENTE, StatusCompromisso.EM_ANDAMENTO] },
      },
      select: { id: true },
    });
    if (jaExiste) return false;

    await this.prisma.compromisso.create({
      data: {
        titulo,
        tipo: TIPO_PREPARO,
        status: StatusCompromisso.PENDENTE,
        inicio: quando,
        fim: new Date(quando.getTime() + 1800_000),
        descricao:
          `${rotulo} marcada para ${formatarDataHoraBR(inicioDaPauta)}.
` +
          `Processo ${NpuUtils.formatar(processo.numeroCNJ) || '(rascunho)'}.
` +
          'Conferir peças, contatar quem vai depor e confirmar a presença.',
        responsavelId,
        processoId: processo.id,
        filiadoId: processo.filiadoId,
        origemAutomatica: true,
      },
    });
    return true;
  }

  /**
   * Atividade automática em aberto do mesmo processo, mesmo tipo, no mesmo DIA
   * (fuso de Teresina) — o id, ou null.
   *
   * O dia é a granularidade certa: o tribunal remarca o horário sem remarcar a
   * audiência, e comparar o instante exato trataria "14h" e "14h30" como duas
   * pautas. Só considera PENDENTE/EM_ANDAMENTO — uma pauta já concluída ou
   * cancelada não deve absorver a designação nova.
   */
  private async pautaDoDia(processoId: string, tipo: string, quando: Date): Promise<string | null> {
    const dia = diaBR(quando);
    const inicioDia = new Date(`${dia}T00:00:00.000-03:00`);
    const existente = await this.prisma.compromisso.findFirst({
      where: {
        processoId,
        tipo,
        origemAutomatica: true,
        status: { in: [StatusCompromisso.PENDENTE, StatusCompromisso.EM_ANDAMENTO] },
        inicio: { gte: inicioDia, lt: new Date(inicioDia.getTime() + 24 * 3_600_000) },
      },
      select: { id: true },
    });
    return existente?.id ?? null;
  }

  /**
   * Derruba a pauta em aberto do processo (cancelamento ou redesignação).
   *
   * Alcança os dois caminhos pelos quais um compromisso de pauta pode ter
   * nascido: o robô (que carimba `compromissoId` na movimentação de origem) e o
   * radar/agendamento manual. Por isso busca por processo + tipo + futuro, e não
   * só pelo vínculo com a movimentação.
   */
  private async cancelarPauta(
    processo: ProcessoAlvo,
    mov: MovimentacaoParaAutomacao,
    motivo: string,
  ): Promise<number> {
    const abertos = await this.prisma.compromisso.findMany({
      where: {
        processoId: processo.id,
        tipo: { in: [TIPO_AUDIENCIA, TIPO_PERICIA] },
        status: { in: [StatusCompromisso.PENDENTE, StatusCompromisso.EM_ANDAMENTO] },
        // Só o que ainda não aconteceu: uma audiência passada que ninguém fechou
        // é pendência de registro, não pauta a derrubar.
        inicio: { gte: mov.dataMovimento },
      },
      select: { id: true },
    });

    let n = 0;
    for (const c of abertos) {
      const cancelado = await this.agenda.cancelarPorSistema(
        c.id,
        `${motivo} (DataJud: ${mov.descricao})`,
      );
      if (cancelado) n++;
    }

    // Carimba a movimentação para não reavaliar o cancelamento a cada varredura.
    // Aponta para a pauta derrubada quando havia uma; sem isso a movimentação
    // ficaria eternamente "pendente" aos olhos do robô.
    //
    // Uma movimentação carimba UM compromisso (a FK é singular), e quando o
    // cancelamento derruba várias pautas as demais ficariam sem rastro de quem
    // as derrubou. O motivo já vai no cancelamento de cada uma
    // (`cancelarPorSistema` grava a descrição do andamento), então o histórico
    // não se perde; aqui registramos no log quando houve mais de uma, porque
    // duas pautas abertas para o mesmo processo é sinal de problema anterior.
    if (abertos.length) {
      await this.prisma.movimentacaoProcessual.update({
        where: { id: mov.id },
        data: { compromissoId: abertos[0].id },
      });
      if (abertos.length > 1) {
        this.logger.warn(
          `[AUTOMACAO] Processo ${processo.numeroCNJ}: ${abertos.length} pautas abertas ` +
            'derrubadas pela mesma movimentação — verifique duplicidade na agenda.',
        );
      }
    }
    return n;
  }

  /** Advogado do processo; sem ele, o primeiro Administrador ativo. */
  private async responsavelDoProcesso(advogadoId: string | null): Promise<string | null> {
    if (advogadoId) {
      const adv = await this.prisma.user.findFirst({
        where: { id: advogadoId, ativo: true },
        select: { id: true },
      });
      if (adv) return adv.id;
    }
    const admin = await this.prisma.user.findFirst({
      where: { role: UserRole.ADMINISTRADOR, ativo: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return admin?.id ?? null;
  }

  /** Alguém da triagem/secretaria para as tarefas de contato com o filiado. */
  private async usuarioSecretaria(): Promise<string | null> {
    const secretaria = await this.prisma.user.findFirst({
      where: { role: UserRole.TRIAGEM, ativo: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (secretaria) return secretaria.id;
    return this.responsavelDoProcesso(null); // cai no admin
  }
}
