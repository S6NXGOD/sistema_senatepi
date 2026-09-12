import { Injectable, Logger } from '@nestjs/common';
import { StatusCompromisso, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NpuUtils } from './utils/npu.util';
import { montarUrgencia } from '../agenda/equipe.util';
import { TITULO_PRAZO_GENERICO, DIAS_ATO_RECENTE } from './automacao-prazos.service';
import { diaBR, proximoHorarioUtilBR, somarDiasUteisEmCalendario } from './utils/data-br.util';
import { correlacionar, type MovimentacaoCorrelacionavel } from './utils/correlacao.util';
import { deQuemEAOrdem } from './utils/de-quem-e-a-ordem.util';
import { planejarAtividade, type PlanoDaAtividade } from './utils/plano-da-atividade.util';
import { tenant } from '../../tenant/tenant.config';
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
    const resumo = { criadas: 0, enriquecidas: 0, antigas: 0, deOutraParte: 0, propostas: 0 };
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
          // `origemAutomatica` decide se a atividade PODE ser cancelada quando o
          // teor revelar que a ordem é da outra parte: o robô desfaz o que o
          // robô fez, nunca o que uma pessoa marcou.
          compromisso: { select: { status: true, origemAutomatica: true } },
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
          /*
            O TEOR CHEGOU DEPOIS — E DESMENTE A TAREFA.

            O robô do DataJud cria atividade CEGA: o índice público entrega o
            rótulo do movimento ("Disponibilização no Diário", "Publicação") e
            nada mais, então ele não tem como saber de quem é a ordem. Quando o
            DJEN traz o teor do MESMO ato, aqui é o primeiro instante em que dá
            para responder — e enriquecer sem perguntar era carimbar de detalhe
            uma tarefa que não devia existir.

            SÓ DESFAZ O QUE O ROBÔ FEZ. `origemAutomatica` é a linha: tarefa que
            uma pessoa marcou permanece, mesmo que a ordem seja da outra parte —
            ela pode ter marcado sabendo de algo que o teor não diz.
          */
          if (
            deQuemEAOrdem(c.texto, processo.nossoPolo, tenant.sigla) === 'DA_OUTRA_PARTE' &&
            movimentacao.compromisso?.origemAutomatica
          ) {
            await this.prisma.compromisso.update({
              where: { id: movimentacao.compromissoId },
              data: {
                status: 'CANCELADO',
                canceladoEm: new Date(),
                canceladoCategoria: 'DUPLICIDADE',
                canceladoMotivo:
                  'O teor da publicação mostra que a ordem é da parte contrária — a atividade tinha sido criada a partir da movimentação, antes de o texto estar disponível.',
              },
            });
            await this.prisma.comunicacaoDjen.update({
              where: { id: c.id },
              data: {
                movimentacaoId,
                providencia: c.providencia,
                prazoMencionadoDias: c.prazoMencionadoDias,
                tarefaDispensadaEm: new Date(),
                tarefaDispensadaMotivo: 'ORDEM_DA_OUTRA_PARTE',
              },
            });
            resumo.deOutraParte++;
            continue;
          }

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
              /*
                A DECISÃO FICA GRAVADA — antes ela só existia neste `continue`.

                Vista de fora, a linha resultante era idêntica à de uma falha da
                automação: classificada, sem tarefa. O sino não tinha como
                distinguir e tratava as duas como pendência. Medido na produção
                em 07/09/2026: 1.243 publicações nessa situação, 1.243 delas
                notícia velha, e nove advogados com barra vermelha permanente
                anunciando "1003 publicações suas sem tarefa aberta".

                Com o carimbo, sem tarefa E sem dispensa passa a significar uma
                coisa só: o robô devia ter criado e não criou.
              */
              tarefaDispensadaEm: new Date(),
              tarefaDispensadaMotivo: 'NOTICIA_VELHA',
            },
          });
          resumo.antigas++;
          continue;
        }

        /*
          O PRAZO É NOSSO, OU DA PARTE CONTRÁRIA?

          O tribunal publica o MESMO ato para todos os intimados, e a ordem
          costuma ser de um lado só. O robô lia "no prazo de 15 dias" e criava
          tarefa para o advogado do sindicato sem perguntar de quem era a
          obrigação. Caso real (0000978-59.2022.5.22.0004):

            "INTIME-SE A RECLAMADA PARA RECOLHIMENTO NO PRAZO DE 15 DIAS"

          Não há uma linha para nós no ato inteiro, e mesmo assim nasceu
          "Elaborar manifestação" na agenda. Medido em 07/09/2026: das 14
          atividades que o robô criou, CINCO já tinham sido canceladas à mão —
          a equipe vinha limpando isso toda semana, sem reportar.

          A trava é deliberadamente tímida: só barra quando ACHA ordem e TODAS
          são atribuíveis à outra parte. Sem ordem legível, ou com uma ordem
          que não dê para atribuir, a tarefa nasce como sempre nasceu.
          Conferido nas 1.433 publicações do acervo: 4,1% seriam barradas,
          90,4% seguem indefinidas e intocadas — e as 2 tarefas erradas que
          existiam hoje estão entre as barradas.

          A ASSIMETRIA DECIDE O DESENHO: deixar de avisar um prazo custa o
          prazo; avisar um que não era nosso custa um clique.
        */
        if (deQuemEAOrdem(c.texto, processo.nossoPolo, tenant.sigla) === 'DA_OUTRA_PARTE') {
          await this.prisma.comunicacaoDjen.update({
            where: { id: c.id },
            data: {
              movimentacaoId,
              providencia: c.providencia,
              prazoMencionadoDias: c.prazoMencionadoDias,
              // A decisão fica GRAVADA, com o motivo: sem tarefa e sem dispensa
              // continua significando "o robô devia ter criado e não criou".
              tarefaDispensadaEm: new Date(),
              tarefaDispensadaMotivo: 'ORDEM_DA_OUTRA_PARTE',
            },
          });
          resumo.deOutraParte++;
          continue;
        }

        /*
          O ROBÔ PROPÕE QUANDO NÃO TEM CERTEZA — em vez de decidir por ninguém.

          Medido nas 1.433 publicações: ele PROVA que a ordem é nossa em 15,8%,
          prova que é da outra parte em 4,1%, e nos 80% restantes não sabe. Criar
          tarefa nesses 80% foi o que encheu a agenda de trabalho alheio, e
          NÃO criar perderia prazo. As duas saídas são ruins porque a pergunta
          está errada: quem tem de decidir isso é o advogado, não a heurística.

          VAI DIRETO PARA A AGENDA só o que passa nas duas provas: ordem nossa
          demonstrada E prazo escrito no ato. Aí não há o que perguntar — pedir
          aprovação para um prazo já provado é cerimônia, e cerimônia é o que faz
          gente parar de ler aviso. São 7 dos 49 atos de um mês.

          O RESTO VIRA PROPOSTA, endereçada a UMA pessoa: o RESPONSÁVEL pelo
          processo; sem ele, um advogado nosso que o ato cite pela OAB. Proposta
          de todos é proposta de ninguém. Medido: 40 por mês na equipe, 2,6 por
          semana no pior caso individual, e 2 sem dono em 1.433.

          A ordem entre os dois critérios NÃO é indiferente e já foi ao
          contrário: o ato intima a equipe inteira (4 advogados em 80 dos 131
          processos), então "o primeiro que o ato cita" é sorteio. Ver
          `donoDaProposta` para os números.

          A publicação continua visível em Publicações o tempo todo — a caixa
          não esconde nada, só decide o que entra na agenda.
        */
        const lado = deQuemEAOrdem(c.texto, processo.nossoPolo, tenant.sigla);
        const provadaNossaComPrazo = lado === 'NOSSA' && c.prazoMencionadoDias != null;

        if (!provadaNossaComPrazo) {
          const dono = await this.donoDaProposta(processo, c.id);
          await this.prisma.comunicacaoDjen.update({
            where: { id: c.id },
            data: {
              movimentacaoId,
              providencia: c.providencia,
              prazoMencionadoDias: c.prazoMencionadoDias,
              tarefaPropostaEm: new Date(),
              tarefaPropostaPara: dono,
            },
          });
          resumo.propostas++;
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

      if (resumo.criadas || resumo.enriquecidas || resumo.antigas || resumo.deOutraParte || resumo.propostas) {
        this.logger.log(
          `[CORRELACAO] ${processo.numeroCNJ}: ${resumo.criadas} atividade(s) criada(s), ` +
            `${resumo.enriquecidas} enriquecida(s) com o teor da publicação` +
            `${resumo.antigas ? `, ${resumo.antigas} anterior(es) ao acompanhamento — só classificada(s)` : ''}` +
            // Sai no log porque é a decisão MAIS nova do robô: se ela começar a
            // barrar demais, é aqui que se vê antes de alguém reclamar.
            `${resumo.deOutraParte ? `, ${resumo.deOutraParte} com ordem dirigida à parte contrária — sem tarefa` : ''}` +
            `${resumo.propostas ? `, ${resumo.propostas} proposta(s) na caixa do advogado` : ''}.`,
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
        somarDiasUteisEmCalendario(c.dataDisponibilizacao, diasParaLembrete(spec, c.prazoMencionadoDias)),
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
    /**
     * Quem ACEITOU a proposta, quando veio da caixa de entrada.
     *
     * Vence o responsável do processo de propósito: se o Murilo assume um item
     * endereçado à Morgana, a tarefa é dele — foi ele quem disse "isto é meu".
     */
    responsavelForcado?: string | null,
  ): Promise<string> {
    /*
      O CÁLCULO MORA EM `planejarAtividade`, e não mais aqui.

      A tela passou a mostrar uma PRÉVIA da tarefa antes de criá-la, e prévia
      que recalcula por conta própria é uma segunda implementação da regra —
      exatamente o defeito que esta base já pagou três vezes (o `polo` com três
      leitores, o `tipoAcao` derivado num caminho e não no irmão, a lista de
      status do Diário ao lado da canônica). Uma prévia que erra por pouco é
      pior que nenhuma: ela promete.

      Agora há um cálculo só. Aqui sobra o que depende do banco: quem responde,
      os vínculos e a escrita.
    */
    const plano = planejarAtividade(c, processo.numeroCNJ, new Date(), DIAS_ATO_RECENTE);
    const { atrasado, idadeDias, inicio } = plano;

    // Tarefa de contato é da secretaria; o resto é do advogado do processo.
    const responsavelId = responsavelForcado ?? (await this.donoDaTarefa(plano.tipo, processo));

    const compromisso = await this.prisma.compromisso.create({
      data: {
        titulo: plano.titulo,
        tipo: plano.tipo,
        status: StatusCompromisso.PENDENTE,
        inicio,
        fim: new Date(inicio.getTime() + 3_600_000),
        descricao: plano.descricao,
        responsavelId,
        processoId: processo.id,
        filiadoId: processo.filiadoId,
        ...montarUrgencia(plano.urgente, plano.urgenteMotivo, { origem: 'AUTOMACAO' }),
        origemAutomatica: true,
        criadoPor: null, // sem autor humano — é o robô
      },
      select: { id: true },
    });
    return compromisso.id;
  }

  /**
   * A QUEM A TAREFA VAI — contato é da secretaria, o resto é do dono do caso.
   *
   * Virou método porque a PRÉVIA precisa da mesma resposta: mostrar "vai para
   * a Morgana" e criar para outra pessoa seria pior que não mostrar nada.
   */
  private async donoDaTarefa(tipo: string, processo: ProcessoAlvo): Promise<string> {
    // `responsavelId` do processo não é nulo aqui (ver `ProcessoAlvo`): a
    // secretaria é uma PREFERÊNCIA para o contato, não uma condição.
    if (tipo === 'CONTATO') return (await this.usuarioSecretaria()) ?? processo.responsavelId;
    return processo.responsavelId;
  }

  /**
   * A PRÉVIA — o que a publicação VAI virar, sem virar.
   *
   * "Ao clicar em Criar tarefa vai direto para criar tarefa mas não tenho nem
   * um preview de como ela vai ficar." Tem razão: data, urgência e dono são
   * decididos pelo sistema, e criar às cegas é pedir confiança e depois
   * conferência.
   *
   * Devolve o MESMO objeto que a criação usa (`planejarAtividade`) mais o nome
   * de quem vai receber. `null` quando não há o que planejar — a tela então
   * explica em vez de oferecer um botão que falharia.
   */
  async previaDaAtividade(comunicacaoId: string): Promise<
    (PlanoDaAtividade & { responsavel: { id: string; nome: string; nomeExibicao: string | null } | null }) | null
  > {
    const c = await this.prisma.comunicacaoDjen.findUnique({
      where: { id: comunicacaoId },
      select: {
        processoId: true,
        nomeOrgao: true,
        dataDisponibilizacao: true,
        providencia: true,
        prazoMencionadoDias: true,
      },
    });
    if (!c?.processoId || !c.providencia || c.providencia === 'NENHUMA') return null;

    const processo = await this.carregarProcesso(c.processoId);
    if (!processo) return null;

    const plano = planejarAtividade(
      {
        nomeOrgao: c.nomeOrgao,
        dataDisponibilizacao: c.dataDisponibilizacao,
        providencia: c.providencia as Providencia,
        prazoMencionadoDias: c.prazoMencionadoDias,
      },
      processo.numeroCNJ,
      new Date(),
      DIAS_ATO_RECENTE,
    );

    const donoId = await this.donoDaTarefa(plano.tipo, processo);
    const responsavel = donoId
      ? await this.prisma.user.findUnique({
          where: { id: donoId },
          select: { id: true, nome: true, nomeExibicao: true },
        })
      : null;
    return { ...plano, responsavel };
  }

  /** Processo + a quem atribuir. Mesma regra do robô de prazos. */
  /**
   * A QUEM ENDEREÇAR A PROPOSTA.
   *
   * Ordem de preferência, e cada degrau existe por um motivo:
   *
   *  1. O ADVOGADO QUE O ATO NOMEIA. É o mais forte que existe: a publicação
   *     chegou até aqui porque a OAB dele estava nela. Medido nas 30 ações do
   *     Diário, 30 das 30 tinham advogado nosso identificável.
   *  2. O RESPONSÁVEL pelo processo. Quando o ato não nomeia ninguém nosso, quem
   *     conhece o caso é quem responde por ele.
   *  3. `null` — e aí a proposta fica órfã, visível para a coordenação. Medido:
   *     ZERO casos hoje, mas advogado desligado ou processo sem responsável
   *     produzem isto, e sumir com a publicação seria pior.
   *
   * NUNCA a equipe inteira: proposta endereçada a todos é proposta de ninguém, e
   * a fila coletiva do Diário já mostrou que ninguém assume o que é de todos.
   */
  /**
   * A PROPOSTA ACEITA VIRA TAREFA — o mesmo caminho de sempre, com um dono.
   *
   * Reusa `criarAtividade` inteiro em vez de duplicar a regra de horário,
   * urgência e título: a tarefa que nasce de um clique tem de ser
   * indistinguível da que o robô cria sozinho, senão passam a existir duas
   * qualidades de tarefa no mesmo quadro.
   *
   * `escalada` marca a que nasceu porque NINGUÉM respondeu em três dias. Ela é
   * legítima — prazo não espera triagem — mas a pessoa precisa saber que o
   * sistema decidiu por ela, ou vai procurar quem aceitou e não vai achar.
   */
  async criarAtividadeDaProposta(
    comunicacaoId: string,
    responsavelId: string | null,
    escalada = false,
  ): Promise<string | null> {
    const c = await this.prisma.comunicacaoDjen.findUnique({
      where: { id: comunicacaoId },
      select: {
        id: true,
        processoId: true,
        texto: true,
        link: true,
        nomeOrgao: true,
        dataDisponibilizacao: true,
        providencia: true,
        prazoMencionadoDias: true,
      },
    });
    // Sem processo não há onde pendurar a tarefa — a publicação de uma ação que
    // ainda não foi cadastrada pertence à outra fila, a do Diário.
    if (!c?.processoId || !c.providencia || c.providencia === 'NENHUMA') return null;

    const processo = await this.carregarProcesso(c.processoId);
    if (!processo) return null;

    const compromissoId = await this.criarAtividade(
      processo,
      {
        texto: c.texto,
        link: c.link,
        nomeOrgao: c.nomeOrgao,
        dataDisponibilizacao: c.dataDisponibilizacao,
        providencia: c.providencia as Providencia,
        prazoMencionadoDias: c.prazoMencionadoDias,
      },
      responsavelId,
    );

    if (escalada) {
      await this.prisma.compromisso.update({
        where: { id: compromissoId },
        data: {
          descricao: {
            set:
              'Criada automaticamente: a proposta mencionava prazo e ficou três dias sem resposta na caixa de entrada.',
          },
        },
      });
    }
    return compromissoId;
  }

  /**
   * DE QUEM É A PROPOSTA — o dono do CASO, não o primeiro nome da lista.
   *
   * A primeira versão perguntava ao ato: "que advogado nosso você cita?", e
   * pegava o primeiro que casasse por OAB. O raciocínio parecia bom (o ato é
   * mais específico que o cadastro) e estava errado, porque parte de uma
   * premissa falsa: a de que o ato nomeia UM advogado.
   *
   * MEDIDO NA PRODUÇÃO (1.424 publicações com processo e responsável ativo):
   *
   *   advogados que o ato cita .......... 3 a 5 na maioria (só 39 atos citam 1)
   *   tamanho da equipe do processo ..... 4 em 80 dos 131 processos
   *   primeiro citado = responsável ..... 694
   *   primeiro citado ≠ responsável ..... 614  ← e o responsável ESTÁ citado
   *   o escolhido nem é da equipe ....... 51
   *
   * O ato intima a equipe inteira; a ordem em que o DJEN devolve os nomes não
   * significa nada. Escolher o primeiro é sortear entre quatro colegas — 43%
   * das propostas iriam para a pessoa errada, e o mesmo processo
   * (0000814-61.2026.5.22.0002) rendia propostas para dois advogados, nenhum
   * deles o responsável.
   *
   * O CADASTRO SABE, E O RESTO DO SISTEMA JÁ O USA
   * `processos_advogados` tem um `principal` marcado à mão, e o atalho
   * `processo.advogadoId` bate com ele em 131 de 131 processos. O caminho que
   * cria ATIVIDADE direto (`responsavel(p.advogadoId)`) sempre usou isso. Só a
   * proposta divergia — de modo que a MESMA publicação caía com pessoas
   * diferentes conforme mencionasse prazo ou não. Uma regra, um dono.
   *
   * A OAB CITADA CONTINUA VALENDO — como segunda opção, para o processo sem
   * responsável ativo (2 na produção). Aí um nome da equipe é melhor que nada.
   *
   * `null` é resposta legítima: a proposta órfã aparece na fila comum de quem
   * coordena. São 2 em 1.433 — mas proposta endereçada a quem saiu do sindicato
   * seria pior, porque ninguém a veria.
   */
  private async donoDaProposta(
    processo: ProcessoAlvo,
    comunicacaoId: string,
  ): Promise<string | null> {
    if (processo.advogadoId) {
      const ativo = await this.prisma.user.findFirst({
        where: { id: processo.advogadoId, ativo: true },
        select: { id: true },
      });
      if (ativo) return ativo.id;
    }

    const c = await this.prisma.comunicacaoDjen.findUnique({
      where: { id: comunicacaoId },
      select: { advogados: true },
    });
    const citados = Array.isArray(c?.advogados)
      ? (c!.advogados as { numeroOab?: string; ufOab?: string }[])
      : [];
    if (citados.length) {
      const chave = (n?: string | null, u?: string | null) =>
        `${String(u ?? '').trim().toUpperCase()}-${String(n ?? '').replace(/\D/g, '')}`;
      const nossos = await this.prisma.user.findMany({
        where: { ativo: true, oab: { not: null }, oabUf: { not: null } },
        select: { id: true, oab: true, oabUf: true },
      });
      const porOab = new Map(nossos.map((a) => [chave(a.oab, a.oabUf), a.id]));
      for (const a of citados) {
        const achado = porOab.get(chave(a?.numeroOab, a?.ufOab));
        if (achado) return achado;
      }
    }
    return null;
  }

  private async carregarProcesso(processoId: string): Promise<ProcessoAlvo | null> {
    const p = await this.prisma.processo.findUnique({
      where: { id: processoId },
      select: {
        id: true,
        numeroCNJ: true,
        advogadoId: true,
        filiadoId: true,
        // O polo do sindicato sai do VÍNCULO com o cadastro institucional, não
        // do nome: as 96 partes que são o sindicato estão todas ligadas a ele.
        partes: {
          where: { parteExterna: { institucional: true } },
          select: { polo: true },
        },
      },
    });
    if (!p) return null;

    const responsavelId = await this.responsavel(p.advogadoId);
    if (!responsavelId) {
      this.logger.warn('[CORRELACAO] Nenhum usuário ativo para atribuir tarefas — nada criado.');
      return null;
    }

    const noAtivo = p.partes.some((x) => x.polo === 'ATIVO');
    const noPassivo = p.partes.some((x) => x.polo === 'PASSIVO');
    // Nos DOIS polos (recurso) não há papel a comparar — fica indefinido, e
    // indefinido cria tarefa, como sempre.
    const nossoPolo = noAtivo && !noPassivo ? 'ATIVO' : noPassivo && !noAtivo ? 'PASSIVO' : null;

    const { partes: _partes, ...resto } = p;
    return { ...resto, responsavelId, nossoPolo };
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
  /**
   * De que lado o SINDICATO está NESTE processo.
   *
   * É o que permite ler "intime-se a executada" como ordem nossa quando somos
   * nós a executada. `null` quando o sindicato não é parte (a ação é do
   * filiado e nós só patrocinamos) ou quando está nos dois polos — nos dois
   * casos não dá para atribuir papéis, e a trava não decide nada.
   */
  nossoPolo: 'ATIVO' | 'PASSIVO' | null;
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

