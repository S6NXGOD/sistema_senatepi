import { Injectable, Logger } from '@nestjs/common';
import { StatusCompromisso, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AgendaService } from '../agenda/agenda.service';
import { classificarMovimentacao, type GatilhoMovimentacao } from './utils/audiencia.util';
import { diaBR } from './utils/data-br.util';

/** Dias úteis padrão para conferir uma intimação/citação. */
const PRAZO_PADRAO_DIAS_UTEIS = 5;

/** Slugs de `tipos_evento` que o robô usa. */
const TIPO_PRAZO = 'PRAZO';
const TIPO_AUDIENCIA = 'AUDIENCIA';
const TIPO_PERICIA = 'PERICIA';
/** Aviso ao filiado: tipo próprio, com desfechos que perguntam se ele soube. */
const TIPO_CONTATO = 'CONTATO';
const TIPO_ACOMPANHAMENTO = 'ACOMPANHAMENTO';
/** Título fixo — é por ele que a tarefa de confirmação é reconhecida e não duplica. */
const TITULO_CONFIRMAR_AUDIENCIA = 'Confirmar data da audiência designada';

/**
 * Soma dias ÚTEIS a uma data (pula sábado e domingo).
 *
 * Feriados não entram: a lista varia por comarca e o prazo aqui é um LEMBRETE
 * de conferência, não a contagem oficial do processo — errar para menos seria
 * pior do que lembrar um dia antes.
 */
export function somarDiasUteis(base: Date, dias: number): Date {
  const d = new Date(base);
  let restantes = dias;
  while (restantes > 0) {
    d.setDate(d.getDate() + 1);
    const diaSemana = d.getDay();
    if (diaSemana !== 0 && diaSemana !== 6) restantes--;
  }
  return d;
}

/** Próximo dia útil a partir de `base` (inclusive). */
function proximoDiaUtil(base: Date): Date {
  const d = new Date(base);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d;
}

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
    prazos: number;
    audiencias: number;
    tarefasSecretaria: number;
    canceladas: number;
  }> {
    const resumo = { prazos: 0, audiencias: 0, tarefasSecretaria: 0, canceladas: 0 };
    if (!movimentacoes.length) return resumo;

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
          if (await this.criarPrazo(processo, mov, responsavelId)) resumo.prazos++;
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

      if (resumo.prazos || resumo.audiencias || resumo.canceladas) {
        this.logger.log(
          `[AUTOMACAO] ${processo.numeroCNJ}: ${resumo.prazos} prazo(s), ` +
            `${resumo.audiencias} pauta(s), ${resumo.tarefasSecretaria} tarefa(s) de secretaria, ` +
            `${resumo.canceladas} cancelamento(s).`,
        );
      }
    } catch (err) {
      this.logger.error(`[AUTOMACAO] Falha ao processar o processo ${processoId}: ${(err as Error).message}`);
    }
    return resumo;
  }

  // -------------------------------------------------------------------------

  /**
   * Tarefa de conferência de prazo, vencendo em +5 dias úteis do andamento.
   *
   * REAPROVEITA a tarefa aberta que vença no mesmo dia em vez de criar outra.
   * Num processo movimentado, "publicação", "intimação" e "despacho" chegam em
   * lote e geravam uma pilha de tarefas idênticas — agenda entulhada é agenda
   * que a equipe para de ler, e aí o prazo se perde de verdade. Agrupar mantém
   * um lembrete por dia, com todos os andamentos listados dentro.
   */
  private async criarPrazo(
    processo: ProcessoAlvo,
    mov: MovimentacaoParaAutomacao,
    responsavelId: string,
  ): Promise<boolean> {
    const detalhe = [mov.descricao, mov.detalhe].filter(Boolean).join(' — ');
    const linha = `• ${mov.dataMovimento.toLocaleDateString('pt-BR')}: ${detalhe}`;

    // Andamento antigo geraria tarefa já vencida (a janela de captura é de 30
    // dias). Puxa para o próximo dia útil e avisa que chegou atrasado.
    const calculado = somarDiasUteis(mov.dataMovimento, PRAZO_PADRAO_DIAS_UTEIS);
    const hoje = new Date();
    const atrasado = calculado < hoje;
    const inicio = proximoDiaUtil(atrasado ? hoje : calculado);
    inicio.setHours(9, 0, 0, 0);

    const existente = await this.prisma.compromisso.findFirst({
      where: {
        processoId: processo.id,
        tipo: TIPO_PRAZO,
        origemAutomatica: true,
        status: { in: [StatusCompromisso.PENDENTE, StatusCompromisso.EM_ANDAMENTO] },
        inicio: { gte: inicio, lt: new Date(inicio.getTime() + 24 * 3_600_000) },
      },
      select: { id: true, descricao: true },
    });

    if (existente) {
      await this.prisma.compromisso.update({
        where: { id: existente.id },
        data: { descricao: `${existente.descricao ?? ''}\n${linha}`.trim() },
      });
      await this.prisma.movimentacaoProcessual.update({
        where: { id: mov.id },
        data: { compromissoId: existente.id },
      });
      return false; // agrupada, não é tarefa nova
    }

    const compromisso = await this.prisma.compromisso.create({
      data: {
        titulo: 'Verificação de Intimação / Prazo',
        tipo: TIPO_PRAZO,
        status: StatusCompromisso.PENDENTE,
        inicio,
        fim: new Date(inicio.getTime() + 3_600_000),
        descricao:
          `Processo ${processo.numeroCNJ ?? '(rascunho)'}. Conferir o teor no sistema do tribunal e o prazo aplicável.\n` +
          (atrasado
            ? `⚠ Andamento recebido com atraso — o prazo de conferência já venceria em ${calculado.toLocaleDateString('pt-BR')}.\n`
            : '') +
          `Andamentos:\n${linha}`,
        responsavelId,
        processoId: processo.id,
        filiadoId: processo.filiadoId,
        urgente: atrasado,
        origemAutomatica: true,
        criadoPor: null, // sem autor humano — é o robô
      },
      select: { id: true },
    });

    // Marca a movimentação como já processada (trava de idempotência).
    await this.prisma.movimentacaoProcessual.update({
      where: { id: mov.id },
      data: { compromissoId: compromisso.id },
    });
    return true;
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
      select: { id: true },
    });
    if (existente) return false;

    const inicio = proximoDiaUtil(new Date());
    inicio.setHours(9, 0, 0, 0);
    const detalhe = [mov.descricao, mov.detalhe].filter(Boolean).join(' — ');

    await this.prisma.compromisso.create({
      data: {
        titulo: TITULO_CONFIRMAR_AUDIENCIA,
        tipo: TIPO_ACOMPANHAMENTO,
        status: StatusCompromisso.PENDENTE,
        inicio,
        fim: new Date(inicio.getTime() + 3_600_000),
        descricao:
          `Processo ${processo.numeroCNJ ?? '(rascunho)'} — o tribunal registrou audiência DESIGNADA em ` +
          `${mov.dataMovimento.toLocaleDateString('pt-BR')}, mas a base pública do CNJ não publica a data ` +
          `da sessão.

` +
          `O que fazer: abrir o processo no sistema do tribunal, ver a data e a hora, e agendar a ` +
          `audiência (na ficha do processo, em "Audiências a agendar").

` +
          `Andamento: ${detalhe}`,
        responsavelId,
        processoId: processo.id,
        filiadoId: processo.filiadoId,
        // Audiência sem data confirmada é risco de perder sessão — nasce urgente.
        urgente: true,
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
          `Processo ${processo.numeroCNJ ?? '(rascunho)'}.`,
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
      const aviso = new Date(inicio);
      aviso.setDate(aviso.getDate() - 2);
      aviso.setHours(9, 0, 0, 0);
      const inicioAviso = aviso > new Date() ? aviso : new Date();

      // Mesma regra da pauta: um aviso por pauta. Sem esta checagem, uma pauta
      // duplicada gerava dois "Avisar filiado", e a secretaria ligava duas vezes.
      const avisoExistente = await this.pautaDoDia(processo.id, TIPO_CONTATO, inicioAviso);
      if (!avisoExistente) {
        await this.prisma.compromisso.create({
          data: {
            titulo: `Avisar filiado — ${rotulo.toLowerCase()} de ${nomeFiliado}`,
            tipo: TIPO_CONTATO,
            status: StatusCompromisso.PENDENTE,
            inicio: inicioAviso,
            fim: new Date(inicioAviso.getTime() + 1800_000),
            descricao:
              `Confirmar presença do filiado na ${rotulo.toLowerCase()} de ${inicio.toLocaleString('pt-BR')}.\n` +
              `Processo ${processo.numeroCNJ ?? '(rascunho)'}.`,
            responsavelId: secretariaId,
            processoId: processo.id,
            filiadoId: processo.filiadoId,
            origemAutomatica: true,
          },
        });
        tarefa = true;
      }
    }
    return { compromisso: true, tarefa };
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
