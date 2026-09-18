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
import { diaDeCalendarioBR } from './utils/data-br.util';
import { tenant } from '../../tenant/tenant.config';

const DIA_MS = 24 * 3_600_000;

/**
 * Dias que uma proposta COM PRAZO espera antes de virar tarefa sozinha.
 *
 * Três: dois dias úteis cobrem um fim de semana, e a janela da varredura do
 * DJEN é de três dias — mais que isso e o lembrete nasceria em cima do
 * vencimento. Proposta SEM prazo nunca escala: ela não tem relógio.
 *
 * É A MESMA RÉGUA QUE DÁ ESTADO À PROPOSTA na tela (`situacaoDaProposta`), e
 * de propósito: o dia em que o robô desiste de esperar é o dia em que o item
 * passa a pedir uma pessoa. Duas constantes dariam duas verdades.
 */
export const DIAS_ATE_ESCALAR = 3;

/**
 * QUANTOS CARACTERES DO TEOR VIAJAM ATÉ O NAVEGADOR — e por que não o teor.
 *
 * A caixa mandava `texto` inteiro de até 100 publicações a cada abertura do
 * painel (2.476 caracteres em média) para alimentar uma prévia de 180. Agora só
 * vai quando a prévia PRECISA dele: sem `ordem` recortada, a tela cai para o
 * corpo do ato sem o timbre, e essa régua é do lado web (`separarTimbre`), que
 * já a tem e já a testa — não existe terceira cópia da lógica do timbre aqui.
 *
 * 1.400 porque o corte do timbre olha no máximo os 900 primeiros caracteres e a
 * tela mostra 180 do que sobra: o que vem depois disso nunca seria lido.
 */
const CHARS_PARA_A_PREVIA = 1_400;

/**
 * O QUE ACONTECE COM UMA PROPOSTA QUE ENVELHECE.
 *
 * A pergunta do dono foi "elas somem depois que perdem o prazo?". Não somem:
 * não há corte de data em lugar nenhum desta caixa, e não vai haver — o corte
 * nunca esconde o que pede atenção, e o que se esconde aqui é prazo.
 *
 * O defeito era outro, e pior: a proposta do dia 60 era desenhada igual à do
 * dia 1. Quem abria o painel via quatro linhas paradas, sem nada que dissesse
 * qual delas o sistema ainda cuida e qual já é só dela. Medido na produção em
 * 18/09/2026: 16 propostas na casa inteira, a mais velha com 9 dias, e **15 das
 * 16 sem prazo escrito no ato** — ou seja, sem a rede do `escalarEsquecidas`.
 * Quinze itens que ficariam ali para sempre, todos com a mesma cara.
 *
 * Então o envelhecimento virou ESTADO — derivado na leitura, sem tabela, sem
 * evento e sem nada para fechar:
 *
 *  NOVA           chegou há menos de `DIAS_ATE_ESCALAR` dias. Ninguém está
 *                 atrasado: ou o robô ainda vai escalar (se há prazo escrito),
 *                 ou a pessoa ainda tem folga para olhar. Não pede nada.
 *
 *  PARADA         passou o prazo do robô e ela CONTINUA aqui. Se tivesse rede,
 *                 a rede já teria agido e o item teria saído da caixa; estar
 *                 aqui depois disso significa que só uma pessoa resolve. Âmbar,
 *                 que é a cor de "pede você".
 *
 *  FORA_DA_JANELA o ATO passou de `JANELA_DE_TAREFA_DIAS`. Aqui a rede não age
 *                 mais — e essa desistência era silenciosa. Uma atividade
 *                 aberta agora nasceria vencida, que é o que fez as 48 tarefas
 *                 cegas serem desligadas. O item não some nem é dispensado: ele
 *                 passa a dizer o que é, e vai para o topo da caixa.
 *
 * O estado não apaga, não fecha e não dispensa nada. Ele só muda a ORDEM, a COR
 * e a frase — que é o que faltava para a caixa ser uma fila viva em vez de um
 * depósito.
 */
export type EstadoDaProposta = 'NOVA' | 'PARADA' | 'FORA_DA_JANELA';

export interface SituacaoDaProposta {
  estado: EstadoDaProposta;
  /** Dias inteiros desde que o robô propôs — a MESMA conta do `escalarEsquecidas`. */
  diasNaCaixa: number;
  /** Dias de calendário de Teresina desde a disponibilização do ato. */
  diasDoAto: number;
}

/**
 * A idade da proposta, nas duas contas que significam coisas diferentes.
 *
 * `diasNaCaixa` sai de INSTANTE menos instante, igual ao corte da rede: o
 * estado tem de virar no mesmo segundo em que o robô desiste de esperar.
 *
 * `diasDoAto` sai de DIA DE CALENDÁRIO: `dataDisponibilizacao` é `@db.Date` e
 * chega como meia-noite UTC. Subtrair um instante disso erra por até um dia
 * inteiro, e "há 2 dias" numa publicação de ontem é o tipo de número que faz
 * alguém tratar como velho o que é novo.
 */
export function situacaoDaProposta(
  p: { tarefaPropostaEm: Date | null; dataDisponibilizacao: Date },
  agora: Date = new Date(),
): SituacaoDaProposta {
  // Linha antiga sem carimbo de proposta: o ato é a única data confiável.
  const propostaEm = p.tarefaPropostaEm ?? p.dataDisponibilizacao;
  const diasNaCaixa = Math.max(0, Math.floor((agora.getTime() - propostaEm.getTime()) / DIA_MS));
  const diasDoAto = Math.max(
    0,
    Math.round((diaDeCalendarioBR(agora).getTime() - p.dataDisponibilizacao.getTime()) / DIA_MS),
  );
  const estado: EstadoDaProposta =
    diasDoAto > JANELA_DE_TAREFA_DIAS
      ? 'FORA_DA_JANELA'
      : diasNaCaixa >= DIAS_ATE_ESCALAR
        ? 'PARADA'
        : 'NOVA';
  return { estado, diasNaCaixa, diasDoAto };
}

/** Quem pede uma pessoa. É o que a tela nunca pode esconder atrás do corte. */
export function pedeDecisaoAgora(estado: EstadoDaProposta): boolean {
  return estado !== 'NOVA';
}

const PESO_DO_ESTADO: Record<EstadoDaProposta, number> = {
  FORA_DA_JANELA: 0,
  PARADA: 1,
  NOVA: 2,
};

/**
 * A ORDEM DA CAIXA — trabalho antes de número, e o que pede gente primeiro.
 *
 * Era `prazoMencionadoDias asc nulls last` e depois a data: a proposta com
 * prazo subia sempre, mesmo sendo a que o robô resolve sozinho em três dias, e
 * as quatro vagas da tela entupiam com o item mais velho e mais indecidível.
 *
 * Agora o primeiro critério é o ESTADO. Dentro do mesmo estado vale o que
 * valia: prazo escrito primeiro (é o único relógio que o ato traz), e depois o
 * ato mais antigo. O `id` no fim é só para a ordem não dançar entre duas
 * aberturas do painel com os mesmos dados.
 */
export function ordemDaCaixa(
  a: { estado: EstadoDaProposta; prazoMencionadoDias: number | null; dataDisponibilizacao: Date; id: string },
  b: { estado: EstadoDaProposta; prazoMencionadoDias: number | null; dataDisponibilizacao: Date; id: string },
): number {
  const porEstado = PESO_DO_ESTADO[a.estado] - PESO_DO_ESTADO[b.estado];
  if (porEstado) return porEstado;
  const comPrazo = Number(b.prazoMencionadoDias != null) - Number(a.prazoMencionadoDias != null);
  if (comPrazo) return comPrazo;
  const porData = a.dataDisponibilizacao.getTime() - b.dataDisponibilizacao.getTime();
  if (porData) return porData;
  return a.id.localeCompare(b.id);
}

/**
 * A REGRA DE QUEM É O ADVERSÁRIO MORA NO PAINEL — e a importação dela é TARDIA.
 *
 * A caixa imprimia `partes.find((p) => p.polo === 'PASSIVO')`, uma segunda
 * implementação da pergunta "contra quem é este processo?" — e a errada: quando
 * a ação é CONTRA o sindicato, o passivo somos nós, e o cartão escrevia o nome
 * do próprio sindicato como adversário. A regra com dono é
 * `adversarioDoProcesso`, que casa o nosso polo, cai no lado do filiado quando
 * não somos parte e prefere ficar em branco a chutar.
 *
 * POR QUE `require` E NÃO `import`: medido. `app.module` carrega
 * `ProcessosModule` (linha 23) antes de `DashboardModule` (linha 33); um import
 * estático daqui fecha o ciclo processos → dashboard → processos e o
 * `@Module({ imports: [ProcessosModule] })` do painel passa a receber
 * `undefined` — a API não sobe. Resolvido na CHAMADA, que só acontece depois do
 * bootstrap, o ciclo não existe. `caixa-que-envelhece.spec.ts` guarda as duas
 * pontas: que a regra é a canônica e que o painel continua montando.
 */
type RegraDoAdversario = typeof import('../dashboard/dashboard.module').adversarioDoProcesso;
let regraDoAdversario: RegraDoAdversario | null = null;

function adversarioDoProcesso(...args: Parameters<RegraDoAdversario>): string | null {
  if (!regraDoAdversario) {
    const painel = require('../dashboard/dashboard.module') as typeof import('../dashboard/dashboard.module');
    regraDoAdversario = painel.adversarioDoProcesso;
  }
  return regraDoAdversario(...args);
}

/** O que a consulta da caixa traz do banco, antes de virar item de tela. */
export interface PropostaBruta {
  id: string;
  numeroProcesso: string;
  siglaTribunal: string | null;
  nomeOrgao: string | null;
  nomeClasse: string | null;
  tipoComunicacao: string | null;
  texto: string;
  dataDisponibilizacao: Date;
  providencia: string | null;
  prazoMencionadoDias: number | null;
  tarefaPropostaEm: Date | null;
  link: string | null;
  propostaPara: {
    id: string; nome: string; nomeExibicao: string | null;
    avatarUrl: string | null; avatarKey: string | null;
  } | null;
  processo: {
    id: string;
    numeroCNJ: string | null;
    partes: {
      nome: string; polo: string; principal: boolean;
      parteExternaId: string | null; filiadoId: string | null;
      parteExterna: { nomeFantasia: string | null } | null;
    }[];
  } | null;
}

/**
 * UMA LINHA DA CAIXA, pronta para desenhar — e sem o que a tela não usa.
 *
 * As PARTES não vão mais no payload. Elas iam para o navegador só para o
 * cartão descobrir o adversário, e era ali que a segunda regra vivia; com o
 * nome já resolvido aqui, o front não tem mais como divergir do painel.
 */
export function itemDaCaixa(
  bruto: PropostaBruta,
  idDoSindicato: string | null,
  agora: Date = new Date(),
) {
  const { texto, processo, ...resto } = bruto;
  const ordem = trechoDaOrdem(texto);
  return {
    ...resto,
    ...situacaoDaProposta(bruto, agora),
    ordem,
    // Só quando a prévia precisa dele — ver `CHARS_PARA_A_PREVIA`.
    texto: ordem ? null : texto.slice(0, CHARS_PARA_A_PREVIA),
    adversario: processo ? adversarioDoProcesso(processo.partes, idDoSindicato) : null,
    processo: processo ? { id: processo.id, numeroCNJ: processo.numeroCNJ } : null,
  };
}

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
 *
 * E QUANDO NÃO TEM REDE, a caixa diz. Nada expira aqui — o que envelhece muda
 * de ESTADO e sobe na fila (ver `situacaoDaProposta`).
 */
@Injectable()
export class CaixaDePropostasService {
  private readonly logger = new Logger(CaixaDePropostasService.name);

  /** Ver a constante do módulo: uma régua só para a rede e para o estado. */
  private readonly DIAS_ATE_ESCALAR = DIAS_ATE_ESCALAR;

  constructor(
    private readonly prisma: PrismaService,
    private readonly correlacao: CorrelacaoService,
  ) {}

  /**
   * O que está esperando decisão. Sempre do escopo de UMA pessoa.
   *
   * A ORDEM SAI DAQUI, e não do banco: ela depende do ESTADO, que é derivado do
   * relógio e não existe em coluna nenhuma. O banco entrega em ordem de ato
   * mais antigo — assim, se algum dia houver mais que o teto de linhas, o que
   * fica de fora é o mais novo, que é justamente quem tem mais tempo.
   */
  async listar(usuarioId: string, verTodas: boolean, agora: Date = new Date()) {
    const [itens, sindicato] = await Promise.all([
      this.propostasAbertas(usuarioId, verTodas),
      /*
        A ORGANIZAÇÃO DO PRÓPRIO SINDICATO, achada pelo CNPJ do tenant — é a
        chave que permite dizer de que lado estamos sem comparar nome. Nula é
        aceitável: `adversarioDoProcesso` cai para a rede do nome com a sigla.
      */
      this.prisma.parteExterna.findFirst({
        where: { documento: tenant.cnpj.replace(/[^0-9]/g, '') },
        select: { id: true },
      }),
    ]);

    return itens.map((i) => itemDaCaixa(i, sindicato?.id ?? null, agora)).sort(ordemDaCaixa);
  }

  private propostasAbertas(usuarioId: string, verTodas: boolean): Promise<PropostaBruta[]> {
    return this.prisma.comunicacaoDjen.findMany({
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
      // A ordem de tela é `ordemDaCaixa`, em memória. Esta aqui só decide QUEM
      // sobrevive ao teto de linhas: o ato mais antigo, que é o mais em risco.
      orderBy: [{ dataDisponibilizacao: 'asc' }],
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
            /*
              TODAS AS PARTES, e não só as principais.

              A regra canônica do adversário precisa saber em que polo NÓS
              estamos — e o sindicato nem sempre é a parte marcada como
              principal. Com a lista podada, a pergunta "a ação é contra nós?"
              era respondida com o que sobrou, e o cartão chegou a imprimir o
              nome do próprio sindicato como adversário.

              Elas não saem daqui: `itemDaCaixa` resolve o nome e o payload leva
              só o resultado.
            */
            partes: {
              select: {
                nome: true, polo: true, principal: true,
                parteExternaId: true, filiadoId: true,
                parteExterna: { select: { nomeFantasia: true } },
              },
              orderBy: { polo: 'asc' },
            },
          },
        },
      },
    });
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
        /*
          A QUEM O ROBÔ ENDEREÇOU CONTINUA GRAVADO — e era isto que a recusa
          destruía.

          `tarefaPropostaPara: usuarioId` sobrescrevia o destinatário com quem
          recusou, e a justificativa escrita aqui ("a caixa some para ele") não
          se sustentava: a caixa filtra por `tarefaDispensadaEm: null`, então a
          proposta já sai da lista pela dispensa, seja de quem for. O que a
          linha fazia de fato era apagar o único registro de PARA QUEM o robô
          mandou — e essa é a coluna com que se mede se o endereçamento acerta.
          A proposta recusada pela colega passava a parecer endereçada a ela.

          Quem decidiu fica em `tarefaDecididaPor`, que é a coluna da decisão e
          é de onde os Relatórios leem desde 13/09/2026.
        */
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
