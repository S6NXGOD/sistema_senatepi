import { Injectable, Logger } from '@nestjs/common';
import { StatusCompromisso, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NpuUtils } from './utils/npu.util';
import { montarUrgencia } from '../agenda/equipe.util';
import { somarDiasUteis, TITULO_PRAZO_GENERICO, DIAS_ATO_RECENTE } from './automacao-prazos.service';
import { diaBR, proximoHorarioUtilBR } from './utils/data-br.util';
import { correlacionar, type MovimentacaoCorrelacionavel } from './utils/correlacao.util';
import {
  classificarProvidencia,
  diasParaLembrete,
  PROVIDENCIAS,
  type Providencia,
} from './utils/providencia.util';

/**
 * Amarra as publicações do DJEN às movimentações do DataJud, e garante que um
 * mesmo fato produza NO MÁXIMO UMA atividade.
 *
 * OS QUATRO CENÁRIOS
 *
 *  A. A movimentação já gerou atividade → a publicação ENRIQUECE aquela
 *     atividade: o título vira a providência específica ("Elaborar
 *     manifestação" no lugar de "Verificação de Intimação / Prazo") e o teor
 *     entra na descrição. Nenhuma atividade nova.
 *
 *  B. A movimentação existe e NÃO gerou nada (classificou como irrelevante, ou
 *     foi agrupada noutra tarefa) → o DJEN cria a atividade, porque ele tem o
 *     texto e o DataJud só tinha o rótulo. Carimba `movimentacao.compromissoId`
 *     para o robô nunca mais reavaliá-la.
 *
 *  C. Nenhuma movimentação casa — o DJEN chegou primeiro. É comum: a publicação
 *     sai no diário antes de o tribunal alimentar o índice do CNJ. O DJEN cria
 *     a atividade sozinho.
 *
 *  D. O DataJud chega DEPOIS, para um fato já publicado. Antes de o robô de
 *     prazos rodar, a correlação roda no sentido inverso e carimba a
 *     movimentação nova com a atividade que a publicação já criou. O robô então
 *     a pula pela trava que sempre existiu (`if (mov.compromissoId) continue`).
 *
 * O cenário D é o que fecha o circuito: com ele, a ordem de chegada deixa de
 * importar. Sem ele, toda publicação que se antecipasse ao CNJ viraria duas
 * atividades no dia seguinte.
 */
@Injectable()
export class CorrelacaoService {
  private readonly logger = new Logger(CorrelacaoService.name);

  /**
   * Janela de movimentações consideradas. Igual à do robô de prazos: um
   * andamento de meses atrás geraria tarefa já vencida, que é ruído numa agenda
   * que precisa ser levada a sério.
   */
  private readonly JANELA_DIAS = 30;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lado DJEN — cenários A, B e C.
   *
   * Chamado depois de ingerir publicações de um processo.
   */
  async aplicarAposDjen(processoId: string): Promise<{ criadas: number; enriquecidas: number }> {
    const resumo = { criadas: 0, enriquecidas: 0, antigas: 0 };
    try {
      const desde = new Date(Date.now() - this.JANELA_DIAS * 24 * 3_600_000);

      // `providencia: null` = ainda não classificada. É o que faz cada
      // publicação ser processada UMA vez: sem esse filtro, a janela inteira de
      // 30 dias seria reclassificada toda noite, e as que não pedem providência
      // nenhuma (edital, lista de distribuição) voltariam para sempre.
      const comunicacoes = await this.prisma.comunicacaoDjen.findMany({
        where: {
          processoId,
          providencia: null,
          compromissoId: null,
          dataDisponibilizacao: { gte: desde },
        },
        orderBy: { dataDisponibilizacao: 'asc' },
        select: {
          id: true, texto: true, tipoComunicacao: true, dataDisponibilizacao: true,
          movimentacaoId: true, link: true, nomeOrgao: true,
        },
      });
      if (!comunicacoes.length) return resumo;

      const processo = await this.carregarProcesso(processoId);
      if (!processo) return resumo;

      /**
       * DESDE QUANDO ESTAMOS OLHANDO ESTE PROCESSO.
       *
       * É a data em que a PRIMEIRA publicação dele entrou no banco — não a do
       * ato, a do download. Publicação disponibilizada antes disso é um ato que
       * o sistema não teve como anunciar: ou o escritório soube pelo PJe e já
       * cuidou, ou perdeu, e nos dois casos uma tarefa criada hoje não muda
       * nada. Ver `ehNoticiaVelha`.
       */
      const primeiraVista = await this.prisma.comunicacaoDjen.aggregate({
        where: { processoId },
        _min: { createdAt: true },
      });
      const vigiadoDesde = primeiraVista._min.createdAt ?? new Date();

      // Classifica antes de parear: o pareamento precisa saber quais publicações
      // designam pauta (caso especial da regra).
      const classificadas = comunicacoes.map((c) => ({
        ...c,
        ...classificarProvidencia(c.texto, c.tipoComunicacao),
      }));

      const movimentacoes = await this.prisma.movimentacaoProcessual.findMany({
        where: { processoId, dataMovimento: { gte: desde } },
        select: {
          id: true, dataMovimento: true, descricao: true, detalhe: true,
          conteudo: true, codigoMovimento: true, compromissoId: true,
          /**
           * O STATUS da atividade, e não só a existência dela.
           *
           * O cenário (A) enriquecia qualquer atividade vinculada, inclusive
           * CANCELADA. Medido na produção: 3 das 14 publicações apontavam para
           * atividade fechada — e o link "Abrir a atividade na Agenda", tanto
           * no painel quanto na aba, levava a uma tarefa que ninguém executaria.
           * Enriquecer o que foi descartado é escrever num papel jogado fora.
           */
          compromisso: { select: { status: true } },
        },
      });

      const pares = correlacionar(
        classificadas.map((c) => ({
          id: c.id,
          dataDisponibilizacao: c.dataDisponibilizacao,
          movimentacaoId: c.movimentacaoId,
          ehPauta: c.providencia === 'PREPARAR_AUDIENCIA',
        })),
        movimentacoes,
      );
      const movPorComunicacao = new Map(pares.map((p) => [p.comunicacaoId, p.movimentacaoId]));
      const movPorId = new Map(movimentacoes.map((m) => [m.id, m]));

      for (const c of classificadas) {
        if (c.providencia === 'NENHUMA') {
          // Grava a classificação mesmo sem atividade: é o que tira a
          // publicação da fila de trabalho. Sem isto ela seria reavaliada em
          // toda execução, para dar sempre o mesmo "nada a fazer".
          await this.prisma.comunicacaoDjen.update({
            where: { id: c.id },
            data: { providencia: 'NENHUMA' },
          });
          continue;
        }

        const movimentacaoId = movPorComunicacao.get(c.id) ?? null;
        const movimentacao = movimentacaoId ? movPorId.get(movimentacaoId) : undefined;

        /**
         * (A) A movimentação já virou atividade ABERTA — enriquece em vez de
         * criar. Fechada não conta: a atividade cancelada foi descartada de
         * propósito, e a concluída já teve o seu desfecho registrado. Nos dois
         * casos a publicação nova é trabalho novo.
         */
        const atividadeAberta =
          movimentacao?.compromisso?.status === 'PENDENTE' ||
          movimentacao?.compromisso?.status === 'EM_ANDAMENTO';
        if (movimentacao?.compromissoId && atividadeAberta) {
          await this.enriquecer(movimentacao.compromissoId, c);
          await this.prisma.comunicacaoDjen.update({
            where: { id: c.id },
            data: {
              movimentacaoId,
              compromissoId: movimentacao.compromissoId,
              providencia: c.providencia,
              prazoMencionadoDias: c.prazoMencionadoDias,
            },
          });
          resumo.enriquecidas++;
          continue;
        }

        /**
         * (A2) JÁ EXISTE TAREFA ABERTA PARA ESTE TRABALHO NESTE PROCESSO.
         *
         * A ATIVIDADE É UMA UNIDADE DE TRABALHO, NÃO UMA UNIDADE DE PUBLICAÇÃO
         * — e essa distinção é a diferença entre uma agenda que se usa e uma
         * que se ignora.
         *
         * Dois fatos empurram na mesma direção. Primeiro, o DJEN publica UMA
         * comunicação POR DESTINATÁRIO: a mesma intimação, num processo com
         * sete advogados intimados (medido: até doze), chega sete vezes, com
         * textos que só diferem em quem é nomeado. Segundo, atos DIFERENTES do
         * mesmo processo pedem, muitas vezes, o mesmo trabalho: dois acórdãos
         * em quinze dias, os dois pedindo "avaliar recurso".
         *
         * A primeira versão desta trava usava (processo, providência, DIA), e
         * só resolvia o primeiro caso. O resultado, na tela do jurídico em
         * 03/09/2026: dois cartões "Avaliar recurso" do mesmo processo, mesmo
         * horário, indistinguíveis — porque as publicações eram de 12/08 e
         * 27/08. Tecnicamente dois atos; na prática, uma decisão só a tomar.
         *
         * A chave passou a ser (processo, providência) com atividade ABERTA. A
         * segunda publicação anexa o seu teor à tarefa que já existe, e quem
         * abrir lê as duas antes de decidir. Providências diferentes continuam
         * separadas — "juntar documentos" e "avaliar recurso" são trabalhos
         * distintos e merecem cartões distintos.
         */
        const irma = await this.prisma.comunicacaoDjen.findFirst({
          where: {
            processoId,
            id: { not: c.id },
            providencia: c.providencia,
            compromissoId: { not: null },
            // Pelo mesmo motivo do cenário (A): irmã ligada a atividade
            // cancelada não serve de destino para esta.
            compromisso: { status: { in: ['PENDENTE', 'EM_ANDAMENTO'] } },
          },
          orderBy: { dataDisponibilizacao: 'desc' },
          select: { compromissoId: true },
        });
        if (irma?.compromissoId) {
          await this.enriquecer(irma.compromissoId, c);
          await this.prisma.comunicacaoDjen.update({
            where: { id: c.id },
            data: {
              movimentacaoId,
              compromissoId: irma.compromissoId,
              providencia: c.providencia,
              prazoMencionadoDias: c.prazoMencionadoDias,
            },
          });
          resumo.enriquecidas++;
          continue;
        }

        /**
         * (A3) NOTÍCIA VELHA NÃO VIRA TAREFA.
         *
         * ESTA É A TRAVA QUE FALTAVA, e ela nasceu de olhar a agenda no fim do
         * dia 03/09/2026. Das cinco atividades que o DJEN criou, QUATRO vieram
         * de publicações de 12/08, 19/08, 24/08 e 28/08 — em processos que
         * foram cadastrados no sistema em 25/08 e 31/08. Duas delas são
         * ANTERIORES ao próprio cadastro do processo.
         *
         * Nenhuma dessas o sistema teve como anunciar: a integração só passou a
         * funcionar em 03/09. O escritório soube pelo PJe e cuidou, ou não
         * cuidou — e nos dois casos uma tarefa criada semanas depois não é
         * trabalho, é eco. Pior: nasce urgente e vencida, e empurra para baixo
         * o prazo de verdade que vence amanhã.
         *
         * A janela de 30 dias da consulta não protegia disso, e a trava de
         * sessenta dias que eu tinha escrito era código morto — ela nunca podia
         * disparar, porque nada mais velho que trinta dias chega até aqui.
         *
         * A régua certa não é uma idade fixa: é se JÁ ESTÁVAMOS OLHANDO. A
         * tolerância de três dias é a janela da varredura diária
         * (`DJEN_JANELA_DIAS`): na primeira ingestão de um processo, um ato de
         * anteontem ainda é algo que teríamos anunciado se estivéssemos ligados
         * um dia antes.
         *
         * A publicação NÃO é descartada: continua gravada, classificada e
         * visível na aba Publicações, com o selo da providência. Quem abrir o
         * processo vê o histórico; o que ela não faz é fingir ser pendência.
         */
        if (ehNoticiaVelha(c.dataDisponibilizacao, vigiadoDesde)) {
          await this.prisma.comunicacaoDjen.update({
            where: { id: c.id },
            data: {
              movimentacaoId,
              providencia: c.providencia,
              prazoMencionadoDias: c.prazoMencionadoDias,
            },
          });
          resumo.antigas++;
          continue;
        }

        // (B) e (C) — o DJEN cria a atividade. Em (B) ainda carimba a
        // movimentação, para o robô de prazos não gerar uma segunda depois.
        const compromissoId = await this.criarAtividade(processo, c);
        await this.prisma.comunicacaoDjen.update({
          where: { id: c.id },
          data: {
            movimentacaoId,
            compromissoId,
            providencia: c.providencia,
            prazoMencionadoDias: c.prazoMencionadoDias,
          },
        });
        if (movimentacaoId) {
          await this.prisma.movimentacaoProcessual.update({
            where: { id: movimentacaoId },
            data: { compromissoId },
          });
        }
        resumo.criadas++;
      }

      // O pareamento tardio — ver `parearAtrasadas`.
      await this.parearAtrasadas(processoId, desde, movimentacoes);

      if (resumo.criadas || resumo.enriquecidas || resumo.antigas) {
        this.logger.log(
          `[CORRELACAO] ${processo.numeroCNJ}: ${resumo.criadas} atividade(s) criada(s), ` +
            `${resumo.enriquecidas} enriquecida(s) com o teor da publicação` +
            `${resumo.antigas ? `, ${resumo.antigas} anterior(es) ao acompanhamento — só classificada(s)` : ''}.`,
        );
      }
    } catch (err) {
      // Como o robô de prazos: a automação nunca derruba a ingestão. Perder um
      // enriquecimento é aceitável; perder a publicação, não.
      this.logger.error(
        `[CORRELACAO] Falha ao correlacionar o processo ${processoId}: ${(err as Error).message}`,
      );
    }
    return resumo;
  }

  /**
   * O PAREAMENTO QUE CHEGA DEPOIS.
   *
   * A publicação é classificada UMA vez (`providencia: null` no filtro acima), e
   * isso está certo: sem essa trava, a janela de 30 dias seria reclassificada
   * toda noite e o edital voltaria para sempre. Só que a mesma trava fechava a
   * porta para o pareamento, e aí o desenho inteiro deixava de funcionar na
   * ordem em que os fatos chegam de verdade.
   *
   * O DJEN É MAIS RÁPIDO QUE O DATAJUD, e por muito. Medido neste acervo: o
   * atraso mediano do índice público do CNJ é de 41 dias. A publicação do dia
   * 03/09 chega no dia 03/09; a movimentação que descreve o mesmo ato aparece no
   * DataJud semanas depois. Na primeira passada não há com o que parear — e,
   * com a trava, nunca mais haveria uma segunda.
   *
   * Medido na produção em 03/09/2026, antes desta correção: 24 publicações
   * ingeridas num processo, ZERO pareadas, porque ele não tinha nenhuma
   * movimentação do DataJud desde agosto.
   *
   * Esta passada NÃO classifica e NÃO cria atividade — só amarra o vínculo que
   * ficou faltando. Reclassificar seria refazer julgamento já feito; criar
   * atividade aqui duplicaria a que a primeira passada já criou.
   */
  private async parearAtrasadas(
    processoId: string,
    desde: Date,
    movimentacoes: MovimentacaoCorrelacionavel[],
  ): Promise<number> {
    if (!movimentacoes.length) return 0;

    const orfas = await this.prisma.comunicacaoDjen.findMany({
      where: {
        processoId,
        movimentacaoId: null,
        // Já classificadas: as não classificadas são da primeira passada.
        providencia: { not: null },
        dataDisponibilizacao: { gte: desde },
      },
      orderBy: { dataDisponibilizacao: 'asc' },
      select: { id: true, dataDisponibilizacao: true, providencia: true, movimentacaoId: true },
    });
    if (!orfas.length) return 0;

    const pares = correlacionar(
      orfas.map((c) => ({
        id: c.id,
        dataDisponibilizacao: c.dataDisponibilizacao,
        movimentacaoId: c.movimentacaoId,
        ehPauta: c.providencia === 'PREPARAR_AUDIENCIA',
      })),
      movimentacoes,
    );
    if (!pares.length) return 0;

    for (const par of pares) {
      await this.prisma.comunicacaoDjen.update({
        where: { id: par.comunicacaoId },
        data: { movimentacaoId: par.movimentacaoId },
      });
    }
    this.logger.log(
      `[CORRELACAO] ${pares.length} publicação(ões) pareada(s) com movimentação que chegou depois.`,
    );
    return pares.length;
  }

  /**
   * Lado DataJud — cenário D.
   *
   * Roda ANTES do robô de prazos: movimentação nova que descreve um fato já
   * publicado (e já resolvido em atividade) recebe o carimbo daquela atividade.
   * O robô então a ignora, pela trava que ele já tinha.
   *
   * Devolve quantas foram vinculadas — é o número de atividades duplicadas que
   * deixaram de nascer.
   */
  async vincularMovimentacoesNovas(processoId: string): Promise<number> {
    try {
      const desde = new Date(Date.now() - this.JANELA_DIAS * 24 * 3_600_000);

      // Só publicações que JÁ têm atividade: são elas que podem absorver uma
      // movimentação nova. As demais serão tratadas na próxima passagem do DJEN.
      const comunicacoes = await this.prisma.comunicacaoDjen.findMany({
        where: {
          processoId,
          compromissoId: { not: null },
          movimentacaoId: null,
          dataDisponibilizacao: { gte: desde },
        },
        select: {
          id: true, dataDisponibilizacao: true, compromissoId: true, providencia: true,
        },
      });
      if (!comunicacoes.length) return 0;

      const movimentacoes = await this.prisma.movimentacaoProcessual.findMany({
        where: { processoId, compromissoId: null, dataMovimento: { gte: desde } },
        select: {
          id: true, dataMovimento: true, descricao: true, detalhe: true,
          conteudo: true, codigoMovimento: true, compromissoId: true,
        },
      });
      if (!movimentacoes.length) return 0;

      const pares = correlacionar(
        comunicacoes.map((c) => ({
          id: c.id,
          dataDisponibilizacao: c.dataDisponibilizacao,
          movimentacaoId: null,
          ehPauta: c.providencia === 'PREPARAR_AUDIENCIA',
        })),
        movimentacoes,
      );

      const porComunicacao = new Map(comunicacoes.map((c) => [c.id, c]));
      for (const par of pares) {
        const c = porComunicacao.get(par.comunicacaoId)!;
        await this.prisma.movimentacaoProcessual.update({
          where: { id: par.movimentacaoId },
          data: { compromissoId: c.compromissoId },
        });
        await this.prisma.comunicacaoDjen.update({
          where: { id: c.id },
          data: { movimentacaoId: par.movimentacaoId },
        });
      }

      if (pares.length) {
        this.logger.log(
          `[CORRELACAO] Processo ${processoId}: ${pares.length} movimentação(ões) ligada(s) ` +
            'a publicação já resolvida — atividade duplicada evitada.',
        );
      }
      return pares.length;
    } catch (err) {
      this.logger.error(
        `[CORRELACAO] Falha ao vincular movimentações do processo ${processoId}: ${(err as Error).message}`,
      );
      return 0;
    }
  }

  // -------------------------------------------------------------------------

  /**
   * Acrescenta o teor da publicação a uma atividade que o DataJud já criou.
   *
   * O título só é promovido quando a atividade ainda tem o rótulo genérico do
   * robô: se uma pessoa renomeou a tarefa, essa escolha vale mais que a nossa
   * classificação. A descrição é ACRESCIDA, nunca substituída — o que o robô
   * escreveu (lista de andamentos, aviso de atraso) continua sendo verdade.
   */
  private async enriquecer(
    compromissoId: string,
    c: {
      texto: string;
      link: string | null;
      providencia: Providencia;
      prazoMencionadoDias: number | null;
      dataDisponibilizacao?: Date;
    },
  ): Promise<void> {
    if (c.providencia === 'NENHUMA') return;
    const spec = PROVIDENCIAS[c.providencia];

    const atual = await this.prisma.compromisso.findUnique({
      where: { id: compromissoId },
      select: {
        titulo: true, descricao: true, origemAutomatica: true, urgente: true, inicio: true,
      },
    });
    if (!atual) return;

    const promoverTitulo =
      atual.origemAutomatica && atual.titulo === TITULO_PRAZO_GENERICO;

    /**
     * O PRAZO MAIS CURTO MANDA.
     *
     * Uma tarefa que já existe pode receber publicação nova com prazo mais
     * apertado que o da primeira. Manter a data antiga faria a agenda dizer
     * "quinta" enquanto o prazo real virou terça. Antecipar não perde nada;
     * adiar, sim — por isso só encurta, nunca estica.
     */
    let antecipar: Date | null = null;
    if (c.dataDisponibilizacao) {
      const novo = proximoHorarioUtilBR(
        somarDiasUteis(c.dataDisponibilizacao, diasParaLembrete(spec, c.prazoMencionadoDias)),
      );
      if (novo < atual.inicio) antecipar = novo;
    }

    await this.prisma.compromisso.update({
      where: { id: compromissoId },
      data: {
        ...(promoverTitulo ? { titulo: spec.titulo } : {}),
        ...(antecipar
          ? { inicio: antecipar, fim: new Date(antecipar.getTime() + 3_600_000) }
          : {}),
        /**
         * Prazo curto marca como urgente; NUNCA desmarca — por isso o `||` com
         * o valor atual, e por isso `montarUrgencia` só é chamada quando a
         * marca vai de fato subir. Chamá-la com `false` limparia a urgência que
         * uma pessoa tivesse posto à mão.
         *
         * Passa por `montarUrgencia` como todo o resto: a Agenda exige motivo
         * de quem marca, e o robô escrevia os campos direto no banco. Era o
         * TERCEIRO lugar com o mesmo desvio — os outros dois estão em
         * `automacao-prazos`, corrigidos antes deste.
         */
        ...(!atual.urgente && (c.prazoMencionadoDias ?? 99) <= 5
          ? montarUrgencia(
              true,
              `A publicação menciona prazo de ${c.prazoMencionadoDias} dia(s).`,
              { origem: 'AUTOMACAO' },
            )
          : {}),
      },
    });
  }

  /** Cria a atividade a partir da publicação (cenários B e C). */
  private async criarAtividade(
    processo: ProcessoAlvo,
    c: {
      texto: string;
      link: string | null;
      nomeOrgao: string | null;
      dataDisponibilizacao: Date;
      providencia: Providencia;
      prazoMencionadoDias: number | null;
    },
  ): Promise<string> {
    const spec = PROVIDENCIAS[c.providencia as Exclude<Providencia, 'NENHUMA'>];
    const dias = diasParaLembrete(spec, c.prazoMencionadoDias);

    // Publicação antiga geraria tarefa já vencida. Puxa para hoje e avisa.
    const calculado = somarDiasUteis(c.dataDisponibilizacao, dias);
    const hoje = new Date();
    const atrasado = calculado < hoje;
    /**
     * `proximoHorarioUtilBR` faz duas coisas que o `setHours(9)` não fazia:
     * fixa as nove da manhã de TERESINA (e não do fuso do contêiner) e garante
     * que o horário seja futuro. Ver o comentário da função.
     */
    const inicio = proximoHorarioUtilBR(atrasado ? hoje : calculado);

    /**
     * URGÊNCIA EXIGE QUE A PUBLICAÇÃO SEJA RECENTE — e esta trava veio de uma
     * medição, não de teoria.
     *
     * Na primeira ingestão de um processo o DJEN entrega o histórico inteiro
     * dele, não só o dia. Em 03/09/2026, quatro processos trouxeram 136
     * publicações de uma vez; catorze estavam na janela de classificação e
     * SETE viraram atividade urgente, todas com o mesmo motivo ("o prazo pode
     * já estar correndo") e todas vencendo no mesmo dia. Sete urgências
     * simultâneas não são sete prioridades — são zero, e a próxima urgência de
     * verdade chega numa tela onde ninguém mais olha a tarja vermelha.
     *
     * Quinze dias é a mesma régua do robô de prazos (`DIAS_ATO_RECENTE`), e
     * pelo mesmo motivo: é o prazo recursal do art. 1.003 do CPC. Passado ele,
     * o que havia a perder já se perdeu — a tarefa continua existindo, para
     * alguém conferir o que ficou pendente, mas sem gritar.
     *
     * A mesma régua vale para o prazo curto: uma publicação de vinte dias
     * atrás que mencionava cinco dias não é urgente, é história.
     */
    const idadeDias = Math.floor(
      (hoje.getTime() - c.dataDisponibilizacao.getTime()) / 86_400_000,
    );
    const recente = idadeDias <= DIAS_ATO_RECENTE;
    const prazoCurto = (c.prazoMencionadoDias ?? 99) <= 5;
    const urgente = recente && (atrasado || prazoCurto);

    // Tarefa de contato é da secretaria; o resto é do advogado do processo.
    const responsavelId =
      spec.tipo === 'CONTATO'
        ? (await this.usuarioSecretaria()) ?? processo.responsavelId
        : processo.responsavelId;

    const compromisso = await this.prisma.compromisso.create({
      data: {
        titulo: spec.titulo,
        tipo: spec.tipo,
        status: StatusCompromisso.PENDENTE,
        inicio,
        fim: new Date(inicio.getTime() + 3_600_000),
        /**
         * A DESCRIÇÃO DIZ O QUE FAZER. O TEOR MORA NO BLOCO PRÓPRIO.
         *
         * Ela embutia o texto integral da publicação — era a única saída
         * quando a gaveta não tinha onde mostrá-lo. Agora que tem, embutir
         * duplica: o mesmo teor aparecia na descrição E no bloco, e com duas
         * publicações irmãs ligadas à mesma tarefa, três vezes. Foi o que o
         * jurídico viu na tela em 03/09/2026, e a descrição chegou a 1.898
         * caracteres de texto de tribunal antes de qualquer instrução.
         */
        descricao:
          `Processo ${NpuUtils.formatar(processo.numeroCNJ) || '(rascunho)'}` +
          `${c.nomeOrgao ? ` — ${c.nomeOrgao}` : ''}.` +
          (atrasado
            ? `\n⚠ Publicação de ${idadeDias} dia(s) atrás — o prazo calculado já venceu. ` +
              `${recente ? 'Confira com urgência.' : 'Confira sem alarme o que ficou pendente.'}`
            : ''),
        responsavelId,
        processoId: processo.id,
        filiadoId: processo.filiadoId,
        ...montarUrgencia(
          urgente,
          atrasado
            ? `Publicação de ${idadeDias} dia(s) atrás e o prazo já venceu — confira o que ficou pendente.`
            : `A publicação menciona prazo de ${c.prazoMencionadoDias} dia(s).`,
          { origem: 'AUTOMACAO' },
        ),
        origemAutomatica: true,
        criadoPor: null, // sem autor humano — é o robô
      },
      select: { id: true },
    });
    return compromisso.id;
  }

  /** Processo + a quem atribuir. Mesma regra do robô de prazos. */
  private async carregarProcesso(processoId: string): Promise<ProcessoAlvo | null> {
    const p = await this.prisma.processo.findUnique({
      where: { id: processoId },
      select: { id: true, numeroCNJ: true, advogadoId: true, filiadoId: true },
    });
    if (!p) return null;

    const responsavelId = await this.responsavel(p.advogadoId);
    if (!responsavelId) {
      this.logger.warn('[CORRELACAO] Nenhum usuário ativo para atribuir tarefas — nada criado.');
      return null;
    }
    return { ...p, responsavelId };
  }

  /** Advogado do processo; sem ele, o primeiro Administrador ativo. */
  private async responsavel(advogadoId: string | null): Promise<string | null> {
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

  /** Alguém da triagem para as tarefas de contato com o filiado. */
  private async usuarioSecretaria(): Promise<string | null> {
    const secretaria = await this.prisma.user.findFirst({
      where: { role: UserRole.TRIAGEM, ativo: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return secretaria?.id ?? null;
  }
}

interface ProcessoAlvo {
  id: string;
  numeroCNJ: string | null;
  advogadoId: string | null;
  filiadoId: string | null;
  responsavelId: string;
}

/**
 * Tolerância da regra da primeira vista, em dias.
 *
 * É a janela da varredura diária (`DJEN_JANELA_DIAS`, padrão 3). Numerar aqui
 * em vez de injetar o `DjenService` é deliberado: a tolerância é conservadora
 * por natureza — se a varredura passar a olhar mais dias para trás, esta régua
 * cria MENOS tarefas, nunca mais.
 */
const DIAS_DE_TOLERANCIA = 3;

/**
 * A publicação é anterior ao momento em que passamos a olhar este processo?
 *
 * Ver o comentário do cenário (A3). Em regime normal `vigiadoDesde` é antigo e
 * tudo que chega passa; na PRIMEIRA ingestão ele é agora, e o histórico inteiro
 * do processo — que a consulta por NPU traz de propósito — fica de fora.
 */
export function ehNoticiaVelha(dataDisponibilizacao: Date, vigiadoDesde: Date): boolean {
  const limite = new Date(vigiadoDesde.getTime() - DIAS_DE_TOLERANCIA * 24 * 3_600_000);
  /**
   * CALENDÁRIO CONTRA CALENDÁRIO, e não instante contra instante.
   *
   * `dataDisponibilizacao` é coluna DATE: chega como meia-noite UTC, sem hora.
   * `vigiadoDesde` é um instante real. Comparar os dois direto embute três
   * horas de diferença — a publicação do próprio dia-limite cairia do lado
   * errado e seria arquivada. Peguei isso na simulação contra a produção, não
   * no teste: com dado sintético os dois valores nascem no mesmo fuso.
   */
  return dataDisponibilizacao.toISOString().slice(0, 10) < diaBR(limite);
}

