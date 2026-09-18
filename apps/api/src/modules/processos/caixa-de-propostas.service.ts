import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CorrelacaoService,
  JANELA_DE_TAREFA_DIAS,
  mesmoAtoPeloLink,
  nossoPoloPelasPartes,
} from './correlacao.service';
import { trechoDaOrdem } from './utils/trecho-da-ordem.util';
import { deQuemEOPrazo, oPrazoPodeVirarData } from './utils/de-quem-e-a-ordem.util';
import { tenant } from '../../tenant/tenant.config';

/**
 * A CAIXA DE ENTRADA DO ADVOGADO — o robô propõe, a pessoa decide.
 *
 * POR QUE ELA EXISTE
 * O robô lê o teor e tenta descobrir de quem é a ordem. Medido nas 1.433
 * publicações do acervo: PROVA que é nossa em 15,8%, prova que é da outra parte
 * em 4,1% — e nos 80% restantes não sabe. Criar tarefa nesses 80% encheu a
 * agenda de trabalho alheio (das 14 atividades que ele criou, 5 já tinham sido
 * canceladas à mão); não criar perderia prazo.
 *
 * As duas saídas são ruins porque a pergunta estava errada. Quem decide se
 * aquilo é trabalho dele é o advogado, e ele decide em um segundo olhando o
 * trecho da ordem — coisa que nenhuma heurística faz.
 *
 * O QUE NÃO PASSA POR AQUI
 * Ordem nossa PROVADA com prazo escrito no ato vira tarefa direto. Pedir
 * aprovação para um prazo já demonstrado é cerimônia, e cerimônia é o que faz
 * gente parar de ler aviso. São 7 dos 49 atos de um mês.
 *
 * A PROPOSTA NÃO É UM LIMBO
 * A publicação continua inteira na aba Publicações desde o primeiro minuto. A
 * caixa não decide o que se vê; decide o que entra na AGENDA.
 *
 * E TEM REDE: proposta com prazo que ninguém responde em três dias vira tarefa
 * sozinha (`escalarEsquecidas`). O modo de falhar "ninguém abriu a caixa" não
 * pode custar um prazo.
 */
@Injectable()
export class CaixaDePropostasService {
  private readonly logger = new Logger(CaixaDePropostasService.name);

  /**
   * Dias que uma proposta COM PRAZO espera antes de virar tarefa sozinha.
   *
   * Três: dois dias úteis cobrem um fim de semana, e a janela da varredura do
   * DJEN é de três dias — mais que isso e o lembrete nasceria em cima do
   * vencimento. Proposta SEM prazo nunca escala: ela não tem relógio.
   */
  private readonly DIAS_ATE_ESCALAR = 3;

  constructor(
    private readonly prisma: PrismaService,
    private readonly correlacao: CorrelacaoService,
  ) {}

  /** O que está esperando decisão. Sempre do escopo de UMA pessoa. */
  async listar(usuarioId: string, verTodas: boolean) {
    const itens = await this.prisma.comunicacaoDjen.findMany({
      where: {
        tarefaPropostaEm: { not: null },
        compromissoId: null,
        tarefaDispensadaEm: null,
        /*
          A CAIXA DA COORDENAÇÃO É A DELA MAIS AS ÓRFÃS — nunca a de todo mundo.

          `verTodas` foi escrito como "sem filtro", e isso estava errado nas
          duas pontas. Para quem coordena, despejar as 40 propostas/mês da
          equipe é entregar uma caixa que ninguém abre — e ainda deixa a pessoa
          decidir sobre prazo de processo que não acompanha.

          O que justificou este parâmetro foi outra coisa: a proposta ÓRFÃ, cujo
          dono foi desligado ou que o robô não soube endereçar. Essa some do
          mundo se ninguém puder vê-la, e o prazo dela corre igual.

          Então o escopo ampliado é `minhas OU sem dono`. O advogado continua
          vendo só as dele.
        */
        ...(verTodas
          ? { OR: [{ tarefaPropostaPara: usuarioId }, { tarefaPropostaPara: null }] }
          : { tarefaPropostaPara: usuarioId }),
      },
      orderBy: [
        // Com prazo primeiro, e dentro disso o mais antigo — é a ordem em que o
        // risco vence, não a ordem em que chegou.
        { prazoMencionadoDias: { sort: 'asc', nulls: 'last' } },
        { dataDisponibilizacao: 'asc' },
      ],
      take: 100,
      select: {
        id: true,
        numeroProcesso: true,
        siglaTribunal: true,
        nomeOrgao: true,
        nomeClasse: true,
        tipoComunicacao: true,
        texto: true,
        dataDisponibilizacao: true,
        providencia: true,
        prazoMencionadoDias: true,
        tarefaPropostaEm: true,
        link: true,
        propostaPara: {
          select: { id: true, nome: true, nomeExibicao: true, avatarUrl: true, avatarKey: true },
        },
        processo: {
          select: {
            id: true,
            numeroCNJ: true,
            partes: {
              where: { principal: true },
              select: { nome: true, polo: true },
              orderBy: { polo: 'asc' },
            },
          },
        },
      },
    });

    return itens.map((i) => ({ ...i, ordem: trechoDaOrdem(i.texto) }));
  }

  /** Quantas esperam — o número do selo, sem carregar a lista. */
  contar(usuarioId: string, verTodas: boolean): Promise<number> {
    return this.prisma.comunicacaoDjen.count({
      where: {
        tarefaPropostaEm: { not: null },
        compromissoId: null,
        tarefaDispensadaEm: null,
        // Mesmo escopo da listagem: o selo não pode contar o que a lista não mostra.
        ...(verTodas
          ? { OR: [{ tarefaPropostaPara: usuarioId }, { tarefaPropostaPara: null }] }
          : { tarefaPropostaPara: usuarioId }),
      },
    });
  }

  /**
   * ACEITAR — a proposta vira tarefa de verdade, para quem aceitou.
   *
   * O responsável é QUEM ACEITOU, e não o dono original da proposta: se o
   * Murilo assume um item endereçado à Morgana, a tarefa é dele. Foi ele quem
   * disse "isto é meu".
   */
  async aceitar(id: string, usuarioId: string) {
    const c = await this.propostaAberta(id);
    // A cópia do mesmo ato já virou atividade: aceitar liga a esta, em vez de
    // pôr uma segunda tarefa para o mesmo ato na agenda (14/09/2026).
    const irma = await this.irmaComAtividade(c);
    const compromissoId =
      irma?.compromissoId ?? (await this.correlacao.criarAtividadeDaProposta(c.id, usuarioId));
    if (!compromissoId) {
      throw new BadRequestException(
        'Não foi possível criar a atividade — a publicação precisa estar ligada a um processo.',
      );
    }
    await this.prisma.comunicacaoDjen.update({
      where: { id: c.id },
      data: {
        compromissoId,
        /*
          A DECISÃO FICA GRAVADA COM O NOME DE QUEM DECIDIU.

          "Publicações decididas" contava a proposta ENDEREÇADA à pessoa que
          virou tarefa. Aceitar não troca o destinatário, então o aceite de um
          colega creditava quem só recebeu. E a escalada automática também
          contava: ignorar a caixa AUMENTAVA o número. Agora a decisão é um fato
          gravado aqui; `escalarEsquecidas` não grava, e a varredura também não.
        */
        tarefaDecididaEm: new Date(),
        tarefaDecididaPor: usuarioId,
      },
    });
    return { compromissoId };
  }

  /**
   * RECUSAR — não vira tarefa, e o motivo fica gravado.
   *
   * O motivo não é burocracia: é o único dado que diz ONDE a regra erra. Hoje o
   * robô só sabe que 80% dos atos são indefinidos; com o motivo ele passa a
   * saber quantos desses eram da outra parte, quantos já estavam resolvidos e
   * quantos simplesmente não pedem nada. É por aí que a heurística melhora sem
   * palpite.
   */
  async recusar(id: string, usuarioId: string, motivo?: string) {
    const c = await this.propostaAberta(id);
    const agora = new Date();
    await this.prisma.comunicacaoDjen.update({
      where: { id: c.id },
      data: {
        tarefaDispensadaEm: agora,
        tarefaDispensadaMotivo: 'RECUSADA_PELO_ADVOGADO',
        // Quem recusou fica no lugar de quem recebeu: a caixa some para ele, e
        // o histórico continua sabendo de quem foi a decisão.
        tarefaPropostaPara: usuarioId,
        motivoDaRecusa: motivo?.trim()?.slice(0, 300) || null,
        // A mesma decisão, nas colunas que os Relatórios leem — igual ao aceitar.
        tarefaDecididaEm: agora,
        tarefaDecididaPor: usuarioId,
      },
    });
    return { ok: true };
  }

  /**
   * A REDE: proposta com prazo que ninguém respondeu vira tarefa sozinha.
   *
   * O modo de falhar da caixa de entrada é "ninguém abriu". Para uma proposta
   * sem prazo isso é inofensivo — ela espera. Para uma COM prazo é perder
   * prazo, e nenhuma melhoria de ruído vale isso.
   *
   * A tarefa nasce marcada: o título diz que veio de proposta não respondida,
   * para ninguém confundir com o que o robô provou.
   *
   * DUAS PROPOSTAS NÃO ESCALAM MAIS (17/09/2026), e nenhuma delas some:
   *
   *  1. AQUELA CUJO PRAZO É DA OUTRA PARTE. A rede lia só "tem prazo escrito" —
   *     o mesmo raciocínio que punha "Juntar documentos" na agenda por causa de
   *     um prazo de 15 dias da empresa executada
   *     (0001381-91.2023.5.22.0101). O ato foi para a caixa justamente porque a
   *     prova não fechou; deixar o relógio fechá-la três dias depois é criar,
   *     pela porta dos fundos, a tarefa que a porta da frente recusou.
   *
   *  2. AQUELA CUJO ATO JÁ SAIU DA JANELA de trabalho. Tarefa nascida de um ato
   *     de mais de 30 dias nasce vencida, e nascer vencida é o que faz a agenda
   *     deixar de ser levada a sério — 47 das 48 tarefas cegas eram assim.
   *
   * PROPOSTA NÃO EXPIRA. As duas continuam na caixa, inteiras, esperando gente;
   * o que deixa de acontecer é virarem tarefa sozinhas. Por isso nenhuma delas
   * recebe `tarefaDispensadaEm`: o carimbo de dispensa é o que APAGA o item da
   * caixa, e apagar é o contrário do que se quer aqui. A decisão de não escalar
   * aparece no log, e o item continua visível para quem decide.
   */
  async escalarEsquecidas(): Promise<number> {
    const corte = new Date(Date.now() - this.DIAS_ATE_ESCALAR * 24 * 3_600_000);
    const esquecidas = await this.prisma.comunicacaoDjen.findMany({
      where: {
        tarefaPropostaEm: { not: null, lt: corte },
        compromissoId: null,
        tarefaDispensadaEm: null,
        prazoMencionadoDias: { not: null },
        /*
          A JANELA FICA NA CONSULTA, e não no laço, de propósito: o ato velho
          nunca mais vai escalar, e no laço ele ocuparia uma das 50 vagas do
          lote todas as noites, empurrando para fora a proposta nova — que é
          exatamente a que tem prazo correndo.
        */
        dataDisponibilizacao: {
          gte: new Date(Date.now() - JANELA_DE_TAREFA_DIAS * 24 * 3_600_000),
        },
      },
      select: {
        id: true,
        tarefaPropostaPara: true,
        numeroProcesso: true,
        processoId: true,
        link: true,
        texto: true,
        // O polo do sindicato NESTE processo é o que permite ler "intime-se a
        // executada" como prazo nosso quando somos nós a executada.
        processo: {
          select: {
            partes: {
              where: { parteExterna: { institucional: true } },
              select: { polo: true },
            },
          },
        },
      },
      take: 50,
    });

    let criadas = 0;
    let deixadasNaCaixa = 0;
    for (const c of esquecidas) {
      try {
        /*
          DE QUEM É O PRAZO — a mesma pergunta, e a mesma função, que decide se
          o ato vai direto para a agenda em `aplicarAposDjen`. Uma régua só: se
          o robô não manda a tarefa na hora porque todo prazo do ato é da outra
          parte, o relógio não pode mandar por ele três dias depois.
        */
        const nossoPolo = nossoPoloPelasPartes(c.processo?.partes ?? []);
        if (!oPrazoPodeVirarData(deQuemEOPrazo(c.texto, nossoPolo, tenant.sigla))) {
          deixadasNaCaixa++;
          continue;
        }
        /*
          A CÓPIA DO MESMO ATO NÃO ESCALA DE NOVO (14/09/2026).

          O DJEN manda uma comunicação por destinatário, com o mesmo link. Duas
          cópias esquecidas na caixa viravam duas tarefas para o mesmo ato, e a
          cópia de um ato que o advogado RECUSOU virava tarefa três dias depois,
          por cima da recusa. A correlação já não cria esse par; isto cuida do
          que estiver na caixa e do que ela deixar passar. As duas cópias do
          lote saem na ordem: a primeira cria, a segunda encontra a tarefa.
        */
        const irma = await this.irmaDecidida(c);
        if (irma) {
          await this.prisma.comunicacaoDjen.update({
            where: { id: c.id },
            data: irma.compromissoId
              ? { compromissoId: irma.compromissoId }
              : { tarefaDispensadaEm: new Date(), tarefaDispensadaMotivo: 'COPIA_DO_MESMO_ATO' },
          });
          continue;
        }
        const compromissoId = await this.correlacao.criarAtividadeDaProposta(
          c.id,
          c.tarefaPropostaPara,
          true,
        );
        if (!compromissoId) continue;
        await this.prisma.comunicacaoDjen.update({
          where: { id: c.id },
          data: { compromissoId },
        });
        criadas++;
      } catch (err) {
        // Uma proposta que falha não pode travar as outras — a rede existe para
        // reduzir risco, nunca para criar um novo.
        this.logger.warn(
          `[CAIXA] Não deu para escalar a proposta do ${c.numeroProcesso}: ${(err as Error).message}`,
        );
      }
    }
    if (criadas) {
      this.logger.log(
        `[CAIXA] ${criadas} proposta(s) com prazo sem resposta em ${this.DIAS_ATE_ESCALAR} dias viraram tarefa.`,
      );
    }
    if (deixadasNaCaixa) {
      // Sai no log porque é a decisão mais nova daqui: se ela começar a segurar
      // demais, é neste número que se vê antes de alguém perder um prazo.
      this.logger.log(
        `[CAIXA] ${deixadasNaCaixa} proposta(s) ficaram na caixa em vez de virar tarefa — ` +
          'todo prazo do ato é da parte contrária.',
      );
    }
    return criadas;
  }

  /** Outra cópia do mesmo ato (mesmo processo e link) que já virou atividade. */
  private irmaComAtividade(c: { id: string; processoId: string | null; link: string | null }) {
    if (!c.processoId || !c.link) return Promise.resolve(null);
    return this.prisma.comunicacaoDjen.findFirst({
      where: {
        ...mesmoAtoPeloLink({ id: c.id, processoId: c.processoId, link: c.link }),
        compromissoId: { not: null },
      },
      select: { compromissoId: true },
    });
  }

  /**
   * Outra cópia do mesmo ato que já tem decisão: atividade ou dispensa.
   *
   * A com atividade vem primeiro: se uma cópia foi recusada e a outra aceita,
   * vale o aceite, e a tarefa que existe é a que se liga.
   *
   * A dispensa COPIA_DO_MESMO_ATO NÃO é decisão: ela só segue a proposta ainda
   * aberta. Contá-la dispensava a própria proposta que ela seguia, e o ato
   * ficava sem tarefa nenhuma (o teste das duas cópias pegou isso). O motivo
   * nulo entra pelo `OR` porque `{ not: X }` não traz a linha nula.
   */
  private irmaDecidida(c: { id: string; processoId: string | null; link: string | null }) {
    if (!c.processoId || !c.link) return Promise.resolve(null);
    return this.prisma.comunicacaoDjen.findFirst({
      where: {
        ...mesmoAtoPeloLink({ id: c.id, processoId: c.processoId, link: c.link }),
        OR: [
          { compromissoId: { not: null } },
          {
            tarefaDispensadaEm: { not: null },
            OR: [{ tarefaDispensadaMotivo: null }, { tarefaDispensadaMotivo: { not: 'COPIA_DO_MESMO_ATO' } }],
          },
        ],
      },
      orderBy: { compromissoId: { sort: 'asc', nulls: 'last' } },
      select: { compromissoId: true },
    });
  }

  /** Carrega a proposta garantindo que ela ainda está esperando decisão. */
  private async propostaAberta(id: string) {
    const c = await this.prisma.comunicacaoDjen.findUnique({
      where: { id },
      select: {
        id: true, processoId: true, link: true,
        compromissoId: true, tarefaPropostaEm: true, tarefaDispensadaEm: true,
      },
    });
    if (!c) throw new BadRequestException('Publicação não encontrada.');
    if (!c.tarefaPropostaEm) throw new BadRequestException('Esta publicação não é uma proposta.');
    /*
      DOIS CLIQUES NÃO PODEM VIRAR DUAS TAREFAS. Dois advogados olhando a mesma
      caixa da coordenação, ou o mesmo dedo duas vezes no celular: quem chegar
      depois recebe uma recusa clara em vez de duplicar o trabalho.
    */
    if (c.compromissoId) throw new BadRequestException('Esta proposta já virou atividade.');
    if (c.tarefaDispensadaEm) throw new BadRequestException('Esta proposta já foi decidida.');
    return c;
  }
}
