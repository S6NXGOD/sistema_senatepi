import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CorrelacaoService } from './correlacao.service';
import { trechoDaOrdem } from './utils/trecho-da-ordem.util';

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
    const compromissoId = await this.correlacao.criarAtividadeDaProposta(c.id, usuarioId);
    if (!compromissoId) {
      throw new BadRequestException(
        'Não foi possível criar a atividade — a publicação precisa estar ligada a um processo.',
      );
    }
    await this.prisma.comunicacaoDjen.update({
      where: { id: c.id },
      data: { compromissoId },
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
    await this.prisma.comunicacaoDjen.update({
      where: { id: c.id },
      data: {
        tarefaDispensadaEm: new Date(),
        tarefaDispensadaMotivo: 'RECUSADA_PELO_ADVOGADO',
        // Quem recusou fica no lugar de quem recebeu: a caixa some para ele, e
        // o histórico continua sabendo de quem foi a decisão.
        tarefaPropostaPara: usuarioId,
        motivoDaRecusa: motivo?.trim()?.slice(0, 300) || null,
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
   */
  async escalarEsquecidas(): Promise<number> {
    const corte = new Date(Date.now() - this.DIAS_ATE_ESCALAR * 24 * 3_600_000);
    const esquecidas = await this.prisma.comunicacaoDjen.findMany({
      where: {
        tarefaPropostaEm: { not: null, lt: corte },
        compromissoId: null,
        tarefaDispensadaEm: null,
        prazoMencionadoDias: { not: null },
      },
      select: { id: true, tarefaPropostaPara: true, numeroProcesso: true },
      take: 50,
    });

    let criadas = 0;
    for (const c of esquecidas) {
      try {
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
    return criadas;
  }

  /** Carrega a proposta garantindo que ela ainda está esperando decisão. */
  private async propostaAberta(id: string) {
    const c = await this.prisma.comunicacaoDjen.findUnique({
      where: { id },
      select: { id: true, compromissoId: true, tarefaPropostaEm: true, tarefaDispensadaEm: true },
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
