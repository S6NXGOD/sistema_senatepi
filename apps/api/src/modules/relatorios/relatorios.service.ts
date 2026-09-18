import { Injectable } from '@nestjs/common';
import {
  Prisma, SituacaoFiliado, StatusAtendimento, StatusCompromisso, StatusProcesso, UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { integracaoAtiva, tenant } from '../../tenant/tenant.config';
import { nivelEfetivo } from '../../common/permissions/permissoes.constants';
import { anoBR, inicioDoDiaBR } from '../processos/utils/data-br.util';
import {
  IMPROCEDENCIA, MINIMO_PARA_MEDIANA, PROCEDENCIA, PROCEDENCIA_PARCIAL, baseDoAcervo,
} from '../processos/padroes.service';
import { ESPERANDO_DECISAO } from '../processos/djen-busca.service';
import { daPessoa } from '../agenda/equipe.util';
import { ORIGEM_DA_CONCLUSAO } from '../atendimentos/fechamento-pela-consulta';
import { adversarioDoProcesso } from '../dashboard/dashboard.module';
import {
  anosDaSerie, outrosDoAssunto, resultadoDoCodigo, rotuloDaComarca, serieDeAjuizadas,
  serieDeSentencas, umaPorProcesso, type AjuizadasDoAno, type ResultadoSentenca,
  type SentencasDoAno, type TextoRepetido,
} from './relatorio.util';
import { SELECAO_DAS_ABERTAS, contarAbertasPorPessoa } from './abertas-da-pessoa.util';
import {
  publicacoesQueCitam,
  temInscricao,
} from '../processos/utils/publicacoes-que-citam.util';

/**
 * RELATÓRIOS — o que a equipe entregou, o que ficou, e como o sindicato está
 * na Justiça.
 *
 * DUAS DECISÕES QUE MOLDAM TUDO AQUI:
 *
 * 1. NÃO EXISTE RANKING. Nada de posição, nota, medalha ou "melhor do mês".
 *    São nove advogados que se conhecem pelo nome; uma tabela ordenada por
 *    volume vira comparação pública de produtividade entre colegas cujos casos
 *    não são comparáveis — uma execução simples e uma ação civil pública contam
 *    "1" cada. A ordem é ALFABÉTICA, de propósito, e a leitura fica com quem
 *    conhece o trabalho.
 *
 * 2. O ADVOGADO VÊ O PRÓPRIO ESPELHO. A permissão `relatorios` é VISUALIZAR
 *    para ele, mas o recorte é aqui: ele recebe uma linha, a dele. Quem
 *    coordena recebe todas. Sem isso, "relatório de equipe" seria o mesmo que
 *    publicar a produção de cada um para todos.
 *
 * A METADE QUE FALTAVA. Até 12/09/2026 o relatório contava atividade e
 * atendimento e não dizia nada do que um sindicato presta contas: quantas
 * sentenças saíram e para que lado, quantas ações entraram por ano, contra quem
 * e onde. `justica` responde com o carimbo do tribunal. Nenhum número ali é
 * previsão, e nenhum é recortado por advogado — seria taxa de vitória de
 * colega, o placar da decisão 1 entrando por outra porta.
 *
 * O QUE ESTE SERVIÇO NÃO MEDE, e é deliberado: qualidade. Nenhum número aqui
 * diz se a peça era boa. E há o que ele ainda NÃO CONSEGUE dizer: quanto as
 * ações renderam (o valor da causa está vazio em todos os processos ativos) e
 * o tamanho real do balcão (atendimento que não é registrado não existe aqui).
 */

export interface LinhaEquipe {
  usuarioId: string;
  nome: string;
  papel: string;
  /** Atividades concluídas no período. */
  concluidas: number;
  /** Abertas agora, independentemente do período. É a foto, não o filme. */
  abertas: number;
  /** Abertas e de dia anterior — o dia virou. A régua do sino e do painel. */
  atrasadas: number;
  /** Mediana em minutos, só das que tiveram cronômetro. `null` sem amostra. */
  medianaMinutos: number | null;
  /** Quantas das concluídas tiveram cronômetro — a base da mediana. */
  cronometradas: number;
}

export interface Contagem {
  rotulo: string;
  total: number;
}

/** Uma contagem que leva a algum lugar: `chave` é o que a tela usa no link. */
export interface ContagemComChave extends Contagem {
  chave: string;
}

export interface SentencaNoPeriodo {
  processoId: string;
  numeroCNJ: string | null;
  adversario: string | null;
  resultado: ResultadoSentenca;
  data: string;
}

export interface ItemDaAgenda {
  id: string;
  titulo: string;
  tipo: string;
  inicio: string;
  processo: { id: string; numeroCNJ: string | null } | null;
  responsavel: { id: string; nome: string; nomeExibicao: string | null; avatarUrl: string | null } | null;
}

export interface Justica {
  /** De que lado estamos no acervo ATIVO — a mesma régua do Panorama. */
  nossoPapel: { autor: number; representando: number; reu: number };
  institucionais: number;
  individuais: number;
  /** Sentenças por ano, uma por processo em cada ano, com os anos zerados. */
  sentencasPorAno: SentencasDoAno[];
  /** Ações por ano de distribuição, com os anos zerados. */
  ajuizadasPorAno: AjuizadasDoAno[];
  sentencasNoPeriodo: SentencaNoPeriodo[];
  /** Quantas houve de fato — a lista tem teto e não pode parecer o todo. */
  totalSentencasNoPeriodo: number;
  /** Contra quem, no acervo ativo. `chave` é a parte externa. */
  adversarios: ContagemComChave[];
  /** Onde tramitam, no acervo ativo. `chave` é o código IBGE da comarca. */
  comarcas: ContagemComChave[];
  /**
   * QUANTO TEMPO DA DISTRIBUIÇÃO À SENTENÇA — mediana de dias, no acervo todo.
   *
   * A pergunta que a diretoria faz depois de "quantas ganhamos" é "em quanto
   * tempo", e o relatório não respondia. Vale para a reunião e vale no balcão:
   * é o que se diz ao filiado que pergunta quanto demora.
   *
   * MEDIANA, não média — um caso parado sete anos por precatório descreveria um
   * acervo que não existe. Mesma régua do Panorama (`medianaAteSentenca`): a
   * SENTENÇA mais recente de cada processo, pela CTE `julgamento`.
   *
   * Nula com menos de três julgados; `baseDaMediana` diz sobre quantos ela foi
   * calculada, porque número sem base não se discute.
   */
  medianaAteSentencaDias: number | null;
  baseDaMediana: number;

  /** Sobre o quê, pelos assuntos de mérito (sem os de rito). */
  temas: Contagem[];
}

export interface Proximos {
  dias: number;
  audiencias: ItemDaAgenda[];
  totalAudiencias: number;
  prazos: ItemDaAgenda[];
  totalPrazos: number;
}

export interface Publicacoes {
  recebidas: number;
  viraramTarefa: number;
  dispensadas: number;
  /** Estado de AGORA, não do período — ver `publicacoes()`. */
  esperandoDecisao: number;
}

/**
 * AS INTIMAÇÕES QUE CITAM ESTA PESSOA, e o que foi feito com elas.
 *
 * Pedido de 18/09/2026: "colocar no relatório individual de cada advogado as
 * intimações que ele teve, ações que tomou". O relatório pessoal não tinha
 * nada disso — publicações eram leitura da casa, e com razão: o CONTADOR da
 * operação é de quem coordena. Mas "quantas intimações me nomearam e o que
 * virou de cada uma" é outra pergunta, e é o espelho da própria pessoa.
 *
 * O VÍNCULO É POR CITAÇÃO (OAB), não por acervo: o ato do DJEN intima a equipe
 * inteira, e o processo pode ser de um colega. Ver `publicacoes-que-citam`.
 *
 * `oRoboDispensou` está separado de propósito e NÃO é ação da pessoa: é o robô
 * decidindo não criar tarefa (notícia velha, ordem da outra parte). Somá-lo às
 * ações humanas diria que alguém trabalhou onde ninguém tocou.
 */
export interface MinhasIntimacoes {
  /** Sem OAB no cadastro não existe vínculo por citação — a tela explica. */
  temOab: boolean;
  /** Publicações do período que nomeiam esta inscrição. */
  recebidas: number;
  /** Das recebidas, quantas viraram tarefa na agenda. */
  viraramTarefa: number;
  /** Dessas tarefas, quantas já foram concluídas. */
  tarefasConcluidas: number;
  /** Dessas tarefas, quantas continuam em aberto. */
  tarefasEmAberto: number;
  /** O robô olhou e decidiu não criar tarefa. Decisão dele, não da pessoa. */
  oRoboDispensou: number;
}

export interface Robo {
  criadas: number;
  concluidas: number;
  canceladasPeloRobo: number;
  canceladasPorPessoas: number;
  abertas: number;
}

/**
 * O QUADRO ASSOCIATIVO — a primeira pergunta de qualquer reunião de diretoria,
 * e o relatório não respondia (18/09/2026).
 *
 * O painel mostrava entradas e saídas do MÊS num cartão; o documento que vai
 * para a assembleia não tinha nada. Quantos sócios o sindicato tem, quantos
 * entraram e quantos saíram no período é o número que abre a reunião.
 *
 * `saidas` conta pelo CARIMBO `desfiliadoEm`, e não pela situação de hoje. Os
 * campos da desfiliação são preservados na reativação de propósito — são o
 * registro de que a saída aconteceu —, então exigir `situacao: DESFILIADO`
 * esconderia quem saiu e voltou dentro do mesmo período. Quem voltou vem
 * contado à parte, para o saldo não mentir nem para um lado nem para o outro.
 *
 * `semDataDeFiliacao` está aqui pelo mesmo motivo que em processos: sem ele,
 * "entraram 3" numa base com 2.378 cadastros sem data parece o quadro inteiro.
 */
export interface QuadroAssociativo {
  /** Estoque de HOJE — quantos sócios o sindicato tem agora. */
  ativosHoje: number;
  /** Filiaram-se no período (`dataFiliacao`). */
  novos: number;
  /** Saíram no período (`desfiliadoEm`), tenham voltado ou não. */
  saidas: number;
  /** Das saídas do período, quantas já foram revertidas. */
  reativados: number;
  /** `novos - saidas`. Com reativação no meio, ver o número acima. */
  saldo: number;
  /** Ativos sem data de filiação: não entram em `novos`. */
  semDataDeFiliacao: number;
  /** Por que saíram — a estatística que o motivo padronizado existe para dar. */
  porMotivo: Contagem[];
}

export interface Relatorio {
  periodo: { de: string; ate: string };
  escopo: 'GLOBAL' | 'PESSOAL';
  /** Quando a coordenação pediu o espelho de UMA pessoa. */
  focoUsuario: { id: string; nome: string } | null;

  /** O quadro associativo no período. Nulo para quem não vê filiados. */
  quadro: QuadroAssociativo | null;

  /** Só no espelho de uma pessoa — nulo na visão da casa. */
  minhasIntimacoes: MinhasIntimacoes | null;
  equipe: LinhaEquipe[];
  atividades: {
    concluidas: number;
    canceladas: number;
    abertas: number;
    atrasadas: number;
    porDesfecho: Contagem[];
    /**
     * QUE TIPO DE TRABALHO. "Concluiu 15" não diz se foram quinze audiências
     * ou quinze telefonemas — e a diferença é o dia inteiro de alguém.
     */
    porTipo: Contagem[];
    /** Quantas nasceram de robô e quantas de gente. */
    automaticas: number;
    manuais: number;
  };
  processos: {
    /** Entraram no SISTEMA no período — inclui acervo antigo recém-importado. */
    cadastrados: number;
    /** Foram AJUIZADOS no período. É o número de "casos novos" de verdade. */
    distribuidos: number;
    ativos: number;
    /**
     * ESTOQUE: encerrados hoje. Era "encerrados no período" contado por
     * `updatedAt`, e qualquer atualização do cadastro — inclusive a
     * sincronização do robô — fazia um processo encerrado há anos contar como
     * encerrado no mês.
     */
    encerrados: number;
    /** Ativos sem data de distribuição: não entram em "ajuizadas" até o CNJ informar. */
    semDataDeDistribuicao: number;
    /*
      ESTAS DUAS SÃO DO ACERVO ATIVO, como as vizinhas — e a variável dizia o
      contrário (18/09/2026). Ela se chamava `processosPeriodo` e guarda
      `findMany({ statusInterno: ATIVO })`: o nome me fez ler "cadastrados no
      período" e escrever uma legenda errada na tela. Renomeada para
      `acervoAtivoDetalhado`, que é o que ela traz.
    */
    porArea: Contagem[];
    porTribunal: Contagem[];
    /**
      Do acervo ATIVO, quantos estão sem a informação. Sem isto a lista soma
      menos que o total de ativos e ninguém sabe se faltou dado ou faltou linha
      — é a mesma regra de `assuntoNaoInformado` nos atendimentos. Medido na
      cópia local: 3 ativos, ZERO com área e 3 com tribunal.
     */
    semAreaInformada: number;
    semTribunalInformado: number;
  };
  atendimentos: {
    registrados: number;
    concluidos: number;
    /**
     * Dos concluídos, os que fecharam sozinhos quando a consulta foi registrada
     * (desde 15/09/2026). Antes dessa data a coluna de origem não existia e o
     * número é zero: a legenda da tela diz "desde 15/09/2026".
     */
    concluidosPelaConsulta: number;
    /** Pessoas diferentes atendidas — o mesmo filiado voltando três vezes é um. */
    filiadosAtendidos: number;
    porCanal: Contagem[];
    porAtendente: Contagem[];
    /**
     * SOBRE O QUE O FILIADO PROCUROU — a pergunta que a diretoria faz e que o
     * sistema não sabia responder. `naoInformado` conta os registros anteriores
     * ao campo e os que ficaram em branco: sem ele, uma amostra de três viraria
     * "100% progressão de nível".
     */
    porAssunto: Contagem[];
    assuntoNaoInformado: number;
    /**
     * O QUE HÁ DENTRO DE "OUTRO": só os textos que se repetem, agrupados sem
     * acento nem caixa. Os que aparecem uma vez viram `outrosUnicos` — ver
     * `outrosDoAssunto`.
     */
    outrosAssuntos: TextoRepetido[];
    outrosUnicos: number;
    porSetor: Contagem[];
  };
  /** O sindicato na Justiça. `null` para quem não vê processos. */
  justica: Justica | null;
  /** Audiências e prazos dos próximos dias. `null` para quem não vê a agenda. */
  proximos: Proximos | null;
  /** O que o Diário trouxe. Só na visão da casa e com o DJEN ligado. */
  publicacoes: Publicacoes | null;
  /** O que o robô fez com o próprio trabalho. Só na visão da casa. */
  robo: Robo | null;
  geradoEm: string;
}

const DIA_MS = 24 * 3_600_000;
/** Cada lista mostra oito. Mais que isso vira anexo, e anexo ninguém lê. */
const ITENS_POR_LISTA = 8;
/** Sentenças listadas no período; o total vem à parte. */
const MAX_SENTENCAS = 40;
const DIAS_A_FRENTE = 30;
const MAX_PROXIMOS = 15;
/** Audiência e perícia: hora marcada diante do juízo. */
const TIPOS_AUDIENCIA = ['AUDIENCIA', 'PERICIA'];
const TIPOS_PRAZO = ['PRAZO'];
const ABERTOS = [StatusCompromisso.PENDENTE, StatusCompromisso.EM_ANDAMENTO];

const SELECAO_DA_AGENDA = Prisma.validator<Prisma.CompromissoSelect>()({
  id: true,
  titulo: true,
  tipo: true,
  inicio: true,
  processo: { select: { id: true, numeroCNJ: true } },
  responsavel: { select: { id: true, nome: true, nomeExibicao: true, avatarUrl: true } },
});

/** Mediana e não média: uma atividade esquecida aberta a noite inteira
 *  distorceria a média e não move a mediana. */
function mediana(valores: number[]): number | null {
  if (!valores.length) return null;
  const ord = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ord.length / 2);
  return ord.length % 2 ? ord[meio] : Math.round((ord[meio - 1] + ord[meio]) / 2);
}

function contar<T>(itens: T[], chave: (t: T) => string | null): Contagem[] {
  const mapa = new Map<string, number>();
  for (const i of itens) {
    const k = chave(i);
    if (!k) continue;
    mapa.set(k, (mapa.get(k) ?? 0) + 1);
  }
  return [...mapa.entries()]
    .map(([rotulo, total]) => ({ rotulo, total }))
    .sort((a, b) => b.total - a.total || a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
}

@Injectable()
export class RelatoriosService {
  constructor(private readonly prisma: PrismaService) {}

  async montar(
    de: Date,
    ate: Date,
    usuario: { id: string; role: UserRole | string; permissoes?: unknown },
    /**
     * FOCO EM UMA PESSOA — pedido da coordenação para conversar com alguém, não
     * para publicar um pódio. O advogado NÃO pode usar: para ele o recorte já é
     * ele mesmo, e aceitar o parâmetro abriria o espelho do colega.
     */
    focoId?: string,
  ): Promise<Relatorio> {
    // `ate` chega como data; o período fecha no FIM do dia informado, senão
    // "de 01/09 até 30/09" perderia tudo que aconteceu no dia 30.
    const inicio = inicioDoDiaBR(de);
    const fim = new Date(inicioDoDiaBR(ate).getTime() + DIA_MS);
    const agora = new Date();
    /**
     * ATRASADA É O DIA QUE VIROU — e não a hora que passou.
     *
     * Era `inicio < agora`, a conta que o painel e o sino já tinham abandonado:
     * o "Cadastrar ação do Diário" que o robô marca para as 15h do próprio dia
     * ficava atrasado às 15h01, e a tela ainda escrevia "prazo vencido" sobre
     * ele — afirmação que o sistema não tem como sustentar.
     */
    const hojeIni = inicioDoDiaBR(agora);

    const souAdvogado = usuario.role === 'ADVOGADO';
    /** O foco só existe para quem vê a equipe inteira. */
    const foco = souAdvogado ? undefined : focoId?.trim() || undefined;
    const alvo = souAdvogado ? usuario.id : foco;

    /**
     * O DADO SEGUE A MATRIZ, e não só o módulo de relatórios.
     *
     * Quem tem `relatorios` e não tem `processos` não recebe sentença, parte
     * contrária nem número de processo — o mesmo corte do painel. Esconder na
     * tela é conforto, não controle de acesso.
     */
    const role = usuario.role as UserRole;
    const veProcessos = nivelEfetivo(role, usuario.permissoes, 'processos') !== 'SEM_ACESSO';
    const veAgenda = nivelEfetivo(role, usuario.permissoes, 'agenda') !== 'SEM_ACESSO';
    const veFiliados = nivelEfetivo(role, usuario.permissoes, 'filiados') !== 'SEM_ACESSO';
    /**
     * PUBLICAÇÕES E ROBÔ SÃO LEITURA DA CASA. Não existem no espelho de uma
     * pessoa, e o advogado não os recebe: são instrumento de quem coordena a
     * operação, como a carga da equipe no painel.
     */
    const daCasa = !alvo && veProcessos;
    const djenLigado = integracaoAtiva('djen', process.env.DJEN_INTEGRACAO);

    /*
      A RÉGUA DO SINO, e não uma cópia dela. Escrita à mão aqui, o espelho do
      advogado contava como sua a tarefa em que o robô o pôs de reserva: "em
      aberto", "canceladas" e "próximos 30 dias" inflavam com o trabalho do
      colega. Ver `daPessoa`.
    */
    const soMeu: Prisma.CompromissoWhereInput = alvo ? daPessoa(alvo) : {};

    const noPeriodo = { gte: inicio, lt: fim };

    const [
      [
        concluidas,
        canceladas,
        abertas,
        processosNovos,
        processosDistribuidos,
        processosAtivos,
        processosEncerrados,
        processosSemData,
        acervoAtivoDetalhado,
        atendimentos,
        pessoas,
      ],
      [justica, proximos, publicacoes, robo],
      minhasIntimacoes,
      quadro,
    ] = await Promise.all([
      Promise.all([
        /**
         * CONCLUÍDA CONTA PARA QUEM CONCLUIU — inclusive no escopo pessoal.
         *
         * A primeira versão filtrava o escopo pessoal por "sou o responsável",
         * e o mesmo advogado aparecia com 13 no próprio relatório e 15 no da
         * coordenação: duas ele havia concluído sem ser o responsável. Dois
         * números para a mesma pergunta é pior que número nenhum.
         */
        this.prisma.compromisso.findMany({
          where: {
            ...(alvo ? { concluidoPor: alvo } : {}),
            status: StatusCompromisso.CONCLUIDO,
            concluidoEm: noPeriodo,
          },
          select: {
            concluidoPor: true, responsavelId: true, desfecho: true,
            tipo: true, origemAutomatica: true,
            iniciadoEm: true, concluidoEm: true,
          },
        }),
        this.prisma.compromisso.count({
          where: { ...soMeu, status: StatusCompromisso.CANCELADO, canceladoEm: noPeriodo },
        }),
        this.prisma.compromisso.findMany({
          where: { ...soMeu, status: { in: ABERTOS } },
          // A equipe vem junto: a linha de cada pessoa usa a régua `daPessoa`.
          select: SELECAO_DAS_ABERTAS,
        }),
        this.prisma.processo.count({ where: { createdAt: noPeriodo } }),
        /**
         * DISTRIBUÍDOS, e não cadastrados — são coisas diferentes e o relatório
         * mentiria juntando as duas. Na primeira carga do acervo, 127 processos
         * entraram no sistema em agosto, e o mais antigo é de 2015: "127 novos no
         * mês" seria uma afirmação falsa sobre o trabalho da equipe.
         */
        this.prisma.processo.count({ where: { dataDistribuicao: noPeriodo } }),
        this.prisma.processo.count({ where: { statusInterno: StatusProcesso.ATIVO } }),
        this.prisma.processo.count({ where: { statusInterno: StatusProcesso.ENCERRADO } }),
        /*
          A RESSALVA DE "AJUIZADAS": processo cadastrado sem o índice do CNJ fica
          sem data de distribuição, e não entra na conta até o tribunal informar.
          Dizer quantos são impede o zero de parecer "nenhuma ação nova".
        */
        this.prisma.processo.count({
          where: { statusInterno: StatusProcesso.ATIVO, dataDistribuicao: null },
        }),
        this.prisma.processo.findMany({
          where: { statusInterno: StatusProcesso.ATIVO },
          select: { categoria: true, tribunal: true },
        }),
        this.prisma.atendimento.findMany({
          where: {
            createdAt: noPeriodo,
            // O foco vale também para o balcão: "o que o Ivo atendeu no mês".
            ...(alvo ? { atendentePorId: alvo } : {}),
          },
          select: {
            status: true, canal: true, assunto: true, assuntoOutro: true, setor: true, filiadoId: true,
            conclusaoOrigem: true,
            atendente: { select: { nome: true, nomeExibicao: true } },
          },
        }),
        this.prisma.user.findMany({
          where: alvo ? { id: alvo } : { ativo: true },
          select: { id: true, nome: true, nomeExibicao: true, role: true },
          orderBy: { nome: 'asc' },
        }),
      ]),
      Promise.all([
        veProcessos ? this.justica(inicio, fim, agora) : null,
        veAgenda ? this.proximos(soMeu, hojeIni) : null,
        daCasa && djenLigado ? this.publicacoes(inicio, fim) : null,
        daCasa ? this.robo(inicio, fim) : null,
      ]),
      /*
        O ESPELHO DA PESSOA — o oposto de `daCasa`. Só existe quando há alvo, e
        exige `processos`: intimação é ato do acervo, e quem não vê processo não
        recebe número de processo por outra porta.
      */
      alvo && veProcessos ? this.minhasIntimacoes(alvo, inicio, fim) : null,

      /*
        O QUADRO É LEITURA DA CASA, e exige `filiados` na matriz: quem não vê o
        cadastro não recebe o tamanho dele por outra porta. No espelho de uma
        pessoa não aparece — "quantos sócios temos" não é pergunta de espelho.
      */
      !alvo && veFiliados ? this.quadroAssociativo(inicio, fim) : null,
    ]);

    const duracoes = new Map<string, number[]>();
    const porPessoa = new Map<string, { concluidas: number; cronometradas: number }>();
    for (const c of concluidas) {
      // Quem CONCLUIU, e não quem era responsável: o relatório conta entrega.
      const quem = c.concluidoPor ?? c.responsavelId;
      if (!quem) continue;
      const atual = porPessoa.get(quem) ?? { concluidas: 0, cronometradas: 0 };
      atual.concluidas++;
      if (c.iniciadoEm && c.concluidoEm) {
        atual.cronometradas++;
        const min = Math.round((c.concluidoEm.getTime() - c.iniciadoEm.getTime()) / 60_000);
        if (min >= 0) duracoes.set(quem, [...(duracoes.get(quem) ?? []), min]);
      }
      porPessoa.set(quem, atual);
    }

    /*
      EM ABERTO E ATRASADAS DE CADA LINHA, PELA RÉGUA `daPessoa`.

      Até 13/09/2026 a linha contava só o responsável. No espelho do advogado a
      busca já era `daPessoa` e a soma não: a tarefa em que ele participa entrava
      em "abertas" do topo e sumia da linha dele. E a aba Uso e produtividade
      passou a contar por `daPessoa` na mesma data — as duas abas dos Relatórios
      não podem dar dois números para a mesma pessoa.
    */
    const abertasPorPessoa = contarAbertasPorPessoa(abertas, hojeIni);

    /**
     * ORDEM ALFABÉTICA, e a lista traz TODO MUNDO — inclusive quem fechou zero.
     *
     * Ordenar por volume publicaria um pódio. E esconder quem ficou em zero
     * seria pior que mostrar: o zero pode ser férias, pode ser um mês inteiro
     * dentro de uma ação civil pública que não gera "atividade concluída", e é
     * justamente a linha que precisa de conversa, não de sumiço.
     */
    const equipe: LinhaEquipe[] = pessoas.map((p) => {
      const fez = porPessoa.get(p.id) ?? { concluidas: 0, cronometradas: 0 };
      const tem = abertasPorPessoa.get(p.id) ?? { abertas: 0, atrasadas: 0 };
      return {
        usuarioId: p.id,
        nome: p.nomeExibicao || p.nome,
        papel: p.role,
        concluidas: fez.concluidas,
        abertas: tem.abertas,
        atrasadas: tem.atrasadas,
        cronometradas: fez.cronometradas,
        medianaMinutos: mediana(duracoes.get(p.id) ?? []),
      };
    });

    const alvoNome = alvo ? (pessoas.find((x) => x.id === alvo) ?? null) : null;

    return {
      periodo: { de: inicio.toISOString(), ate: fim.toISOString() },
      escopo: souAdvogado ? 'PESSOAL' : 'GLOBAL',
      focoUsuario:
        foco && alvoNome ? { id: alvoNome.id, nome: alvoNome.nomeExibicao || alvoNome.nome } : null,
      minhasIntimacoes,
      quadro,
      equipe,
      atividades: {
        concluidas: concluidas.length,
        canceladas,
        abertas: abertas.length,
        atrasadas: abertas.filter((a) => a.inicio < hojeIni).length,
        porDesfecho: contar(concluidas, (c) => c.desfecho),
        porTipo: contar(concluidas, (c) => String(c.tipo)),
        automaticas: concluidas.filter((c) => c.origemAutomatica).length,
        manuais: concluidas.filter((c) => !c.origemAutomatica).length,
      },
      processos: {
        cadastrados: processosNovos,
        distribuidos: processosDistribuidos,
        ativos: processosAtivos,
        encerrados: processosEncerrados,
        semDataDeDistribuicao: processosSemData,
        porArea: contar(acervoAtivoDetalhado, (p) => p.categoria),
        porTribunal: contar(acervoAtivoDetalhado, (p) => p.tribunal),
        semAreaInformada: acervoAtivoDetalhado.filter((p) => !p.categoria).length,
        semTribunalInformado: acervoAtivoDetalhado.filter((p) => !p.tribunal).length,
      },
      atendimentos: {
        registrados: atendimentos.length,
        /*
          O SENTIDO MUDOU EM 14/09/2026 (rodada 3). Até ali, concluir era um
          toque só e aceitava atendimento com a consulta ainda por acontecer (o
          #7 foi concluído assim). Desde então só conclui sem consulta futura:
          a consulta que não aconteceu é cancelada junto e o atendimento guarda
          quem, quando e como terminou. O número de antes não é reescrito; se a
          diretoria comparar períodos dos dois lados da data, a legenda diz.
        */
        concluidos: atendimentos.filter((a) => a.status === StatusAtendimento.CONCLUIDO).length,
        /*
          E DESDE 15/09/2026 (rodada 4) o atendimento também fecha sozinho quando
          a consulta nascida dele é registrada. `concluidos` continua contando
          todos, e por isso SOBE a partir dessa data: os que a triagem fechava à
          mão minutos depois agora fecham na hora. Este número separa quantos
          vieram da consulta, para a comparação entre períodos não enganar.
        */
        concluidosPelaConsulta: atendimentos.filter(
          (a) => a.status === StatusAtendimento.CONCLUIDO && a.conclusaoOrigem === ORIGEM_DA_CONCLUSAO.CONSULTA,
        ).length,
        filiadosAtendidos: new Set(atendimentos.map((a) => a.filiadoId)).size,
        porCanal: contar(atendimentos, (a) => a.canal),
        porAtendente: contar(
          atendimentos,
          (a) => a.atendente?.nomeExibicao || a.atendente?.nome || null,
        ),
        porAssunto: contar(atendimentos, (a) => (a.assunto ? String(a.assunto) : null)),
        assuntoNaoInformado: atendimentos.filter((a) => !a.assunto).length,
        ...outrosDoAssunto(
          atendimentos.map((a) => ({
            assunto: a.assunto ? String(a.assunto) : null,
            assuntoOutro: a.assuntoOutro,
          })),
        ),
        porSetor: contar(atendimentos, (a) => (a.setor ? String(a.setor) : null)),
      },
      justica,
      proximos,
      publicacoes,
      robo,
      geradoEm: new Date().toISOString(),
    };
  }

  /**
   * O SINDICATO NA JUSTIÇA — sentenças, ações por ano, contra quem e onde.
   *
   * NÃO muda com o foco em uma pessoa, de propósito: recortar sentença por
   * advogado seria publicar taxa de vitória de colega. É do sindicato.
   */
  private async justica(inicio: Date, fim: Date, agora: Date): Promise<Justica> {
    const cnpj = tenant.cnpj.replace(/\D/g, '');
    const base = baseDoAcervo(cnpj);
    const anos = anosDaSerie(anoBR(agora));
    const primeiroAno = anos[0];
    const ativo = { statusInterno: StatusProcesso.ATIVO };
    const somosNos = { parteExterna: { institucional: true } };

    const [
      autor,
      reu,
      representando,
      porTipoAcao,
      sentencasRaw,
      ajuizadasRaw,
      movimentosDoPeriodo,
      organizacaoDoSindicato,
      adversarios,
      temas,
      comarcasRaw,
      duracaoRaw,
    ] = await Promise.all([
      this.prisma.processo.count({ where: { ...ativo, partes: { some: { polo: 'ATIVO', ...somosNos } } } }),
      this.prisma.processo.count({ where: { ...ativo, partes: { some: { polo: 'PASSIVO', ...somosNos } } } }),
      this.prisma.processo.count({
        where: { ...ativo, AND: [{ partes: { some: {} } }, { partes: { none: somosNos } }] },
      }),
      this.prisma.processo.groupBy({ by: ['tipoAcao'], where: ativo, _count: { _all: true } }),
      /*
        SENTENÇAS POR ANO — uma por processo em cada ano, a mais recente.

        Todo o acervo, encerrados inclusive: a sentença de 2023 de um processo
        já arquivado continua sendo resultado de 2023. É o carimbo do tribunal,
        com os códigos de julgamento do Panorama, no ano de Teresina.
      */
      this.prisma.$queryRaw<{ ano: number; codigo: number; processos: number }[]>(Prisma.sql`
        SELECT s.ano, s.codigo, count(*)::int AS processos
          FROM (
            SELECT DISTINCT ON (m.processo_id, EXTRACT(YEAR FROM m.data_movimento - interval '3 hours'))
                   EXTRACT(YEAR FROM m.data_movimento - interval '3 hours')::int AS ano,
                   m.codigo_movimento AS codigo
              FROM movimentacoes_processuais m
             WHERE m.codigo_movimento IN (${PROCEDENCIA}, ${IMPROCEDENCIA}, ${PROCEDENCIA_PARCIAL})
               AND EXTRACT(YEAR FROM m.data_movimento - interval '3 hours') >= ${primeiroAno}
             ORDER BY m.processo_id, EXTRACT(YEAR FROM m.data_movimento - interval '3 hours'),
                      m.data_movimento DESC
          ) s
         GROUP BY s.ano, s.codigo
      `),
      this.prisma.$queryRaw<{ ano: number; processos: number }[]>(Prisma.sql`
        SELECT EXTRACT(YEAR FROM p.data_distribuicao)::int AS ano, count(*)::int AS processos
          FROM processos p
         WHERE p.data_distribuicao IS NOT NULL
           AND p.status_interno NOT IN ('PRE_PROCESSUAL', 'RASCUNHO')
           AND EXTRACT(YEAR FROM p.data_distribuicao) >= ${primeiroAno}
         GROUP BY 1
      `),
      this.prisma.movimentacaoProcessual.findMany({
        where: {
          codigoMovimento: { in: [PROCEDENCIA, PROCEDENCIA_PARCIAL, IMPROCEDENCIA] },
          dataMovimento: { gte: inicio, lt: fim },
        },
        orderBy: { dataMovimento: 'desc' },
        take: 200,
        select: {
          dataMovimento: true,
          codigoMovimento: true,
          processo: {
            select: {
              id: true,
              numeroCNJ: true,
              partes: {
                select: { nome: true, polo: true, principal: true, parteExternaId: true, filiadoId: true },
              },
            },
          },
        },
      }),
      this.prisma.parteExterna.findFirst({ where: { documento: cnpj }, select: { id: true } }),
      /* Contra quem e sobre o quê: as CTEs do Panorama, para as duas telas concordarem. */
      this.prisma.$queryRaw<ContagemComChave[]>(Prisma.sql`
        ${base}
        SELECT a.parte_externa_id AS chave,
               coalesce(a.nome_fantasia, a.nome) AS rotulo,
               count(DISTINCT p.id)::int AS total
          FROM processos p
          JOIN adversario a ON a.processo_id = p.id
         WHERE p.status_interno = 'ATIVO'
         GROUP BY 1, 2
         ORDER BY 3 DESC, 2
         LIMIT ${ITENS_POR_LISTA}
      `),
      this.prisma.$queryRaw<Contagem[]>(Prisma.sql`
        ${base}
        SELECT t.assunto AS rotulo, count(DISTINCT p.id)::int AS total
          FROM processos p
          JOIN tema t ON t.processo_id = p.id
         WHERE p.status_interno = 'ATIVO'
         GROUP BY 1
         ORDER BY 2 DESC, 1
         LIMIT ${ITENS_POR_LISTA}
      `),
      this.prisma.processo.groupBy({
        by: ['municipioIBGE'],
        where: { ...ativo, municipioIBGE: { not: null } },
        _count: { _all: true },
      }),
      /*
        QUANTO TEMPO ATÉ A SENTENÇA — a mediana, calculada no banco.

        `percentile_cont` faz a conta sobre a fatia inteira sem trazer uma linha
        por processo até aqui. A fatia é a MESMA do resto: a CTE `julgamento`
        entrega a sentença mais recente de cada processo, com os códigos do CNJ.

        Duração negativa é dado sujo, não caso relâmpago — a sentença anterior à
        distribuição fica de fora em vez de puxar a mediana para baixo.
      */
      this.prisma.$queryRaw<{ mediana: number | null; base: number }[]>(Prisma.sql`
        ${base}
        SELECT percentile_cont(0.5) WITHIN GROUP (
                 ORDER BY (j.data_movimento::date - p.data_distribuicao::date)
               )::int AS mediana,
               count(*)::int AS base
          FROM processos p
          JOIN julgamento j ON j.processo_id = p.id
         WHERE p.data_distribuicao IS NOT NULL
           AND j.data_movimento::date >= p.data_distribuicao::date
      `),
    ]);

    const baseDaMediana = duracaoRaw[0]?.base ?? 0;
    const entes = comarcasRaw.length
      ? await this.prisma.ente.findMany({
          where: { codigo: { in: comarcasRaw.map((c) => c.municipioIBGE as number) } },
          select: { codigo: true, nome: true, uf: true },
        })
      : [];
    const enteDe = new Map(entes.map((e) => [e.codigo, e]));
    const comarcas: ContagemComChave[] = comarcasRaw
      .map((c) => {
        const codigo = c.municipioIBGE as number;
        const ente = enteDe.get(codigo);
        return {
          chave: String(codigo),
          rotulo: ente ? rotuloDaComarca(ente.nome, ente.uf, tenant.endereco.uf) : `Município ${codigo}`,
          total: c._count._all,
        };
      })
      .sort((a, b) => b.total - a.total || a.rotulo.localeCompare(b.rotulo, 'pt-BR'))
      .slice(0, ITENS_POR_LISTA);

    const idDoSindicato = organizacaoDoSindicato?.id ?? null;
    const sentencas = umaPorProcesso(
      movimentosDoPeriodo
        .map((m): SentencaNoPeriodo | null => {
          const resultado = resultadoDoCodigo(m.codigoMovimento);
          if (!resultado) return null;
          return {
            processoId: m.processo.id,
            numeroCNJ: m.processo.numeroCNJ,
            adversario: adversarioDoProcesso(m.processo.partes, idDoSindicato),
            resultado,
            data: m.dataMovimento.toISOString(),
          };
        })
        .filter((s): s is SentencaNoPeriodo => s !== null),
    );

    const doTipo = (tipo: string) => porTipoAcao.find((x) => x.tipoAcao === tipo)?._count._all ?? 0;

    return {
      nossoPapel: { autor, representando, reu },
      institucionais: doTipo('INSTITUCIONAL'),
      individuais: doTipo('INDIVIDUAL'),
      sentencasPorAno: serieDeSentencas(sentencasRaw, anos),
      ajuizadasPorAno: serieDeAjuizadas(ajuizadasRaw, anos),
      sentencasNoPeriodo: sentencas.slice(0, MAX_SENTENCAS),
      totalSentencasNoPeriodo: sentencas.length,
      adversarios,
      comarcas,
      temas,
      /*
        CALA COM MENOS DE TRÊS: mediana de dois é o ponto médio de dois números,
        não um padrão — a mesma régua do Panorama.
      */
      medianaAteSentencaDias: baseDaMediana >= MINIMO_PARA_MEDIANA ? (duracaoRaw[0]?.mediana ?? null) : null,
      baseDaMediana,
    };
  }

  /**
   * OS PRÓXIMOS TRINTA DIAS — audiência, perícia e prazo, os compromissos com a
   * Justiça. Respeita o recorte: o advogado vê os dele; o foco, os da pessoa.
   */
  private async proximos(soMeu: Prisma.CompromissoWhereInput, hojeIni: Date): Promise<Proximos> {
    const ate = new Date(hojeIni.getTime() + (DIAS_A_FRENTE + 1) * DIA_MS);
    const where = (tipos: string[]): Prisma.CompromissoWhereInput => ({
      ...soMeu,
      tipo: { in: tipos },
      status: { in: ABERTOS },
      inicio: { gte: hojeIni, lt: ate },
    });
    const [audiencias, totalAudiencias, prazos, totalPrazos] = await Promise.all([
      this.prisma.compromisso.findMany({
        where: where(TIPOS_AUDIENCIA),
        orderBy: { inicio: 'asc' },
        take: MAX_PROXIMOS,
        select: SELECAO_DA_AGENDA,
      }),
      this.prisma.compromisso.count({ where: where(TIPOS_AUDIENCIA) }),
      this.prisma.compromisso.findMany({
        where: where(TIPOS_PRAZO),
        orderBy: { inicio: 'asc' },
        take: MAX_PROXIMOS,
        select: SELECAO_DA_AGENDA,
      }),
      this.prisma.compromisso.count({ where: where(TIPOS_PRAZO) }),
    ]);
    const item = (c: (typeof audiencias)[number]): ItemDaAgenda => ({
      id: c.id,
      titulo: c.titulo,
      tipo: c.tipo,
      inicio: c.inicio.toISOString(),
      processo: c.processo,
      responsavel: c.responsavel,
    });
    return {
      dias: DIAS_A_FRENTE,
      audiencias: audiencias.map(item),
      totalAudiencias,
      prazos: prazos.map(item),
      totalPrazos,
    };
  }

  /**
   * O QUE O DIÁRIO TROUXE E O QUE SE FEZ COM ISSO.
   *
   * Os três primeiros números são do PERÍODO. A fila (`esperandoDecisao`) é de
   * AGORA, e de propósito: o que espera decisão desde antes do período continua
   * esperando, e cortar pela data esconderia justamente o mais antigo. A regra
   * da fila é a da busca de publicações — ver `ESPERANDO_DECISAO`.
   */
  private async publicacoes(inicio: Date, fim: Date): Promise<Publicacoes> {
    const noPeriodo: Prisma.ComunicacaoDjenWhereInput = {
      dataDisponibilizacao: { gte: inicio, lt: fim },
    };
    const [recebidas, viraramTarefa, dispensadas, esperandoDecisao] = await Promise.all([
      this.prisma.comunicacaoDjen.count({ where: noPeriodo }),
      this.prisma.comunicacaoDjen.count({ where: { ...noPeriodo, compromissoId: { not: null } } }),
      this.prisma.comunicacaoDjen.count({ where: { ...noPeriodo, tarefaDispensadaEm: { not: null } } }),
      this.prisma.comunicacaoDjen.count({ where: ESPERANDO_DECISAO }),
    ]);
    return { recebidas, viraramTarefa, dispensadas, esperandoDecisao };
  }

  /**
   * O QUADRO ASSOCIATIVO NO PERÍODO — ver `QuadroAssociativo`.
   *
   * Uma leitura da CASA: "quantos sócios temos" não é pergunta de espelho
   * pessoal, e no recorte de uma pessoa o bloco não aparece.
   */
  private async quadroAssociativo(inicio: Date, fim: Date): Promise<QuadroAssociativo> {
    const noPeriodo = { gte: inicio, lt: fim };
    const saiuNoPeriodo: Prisma.FiliadoWhereInput = { desfiliadoEm: noPeriodo };
    const [ativosHoje, novos, saidas, reativados, semDataDeFiliacao, motivos] = await Promise.all([
      this.prisma.filiado.count({ where: { situacao: SituacaoFiliado.ATIVO } }),
      this.prisma.filiado.count({ where: { dataFiliacao: noPeriodo } }),
      this.prisma.filiado.count({ where: saiuNoPeriodo }),
      // Saiu no período e HOJE não está desfiliado: a saída foi revertida.
      this.prisma.filiado.count({
        where: { ...saiuNoPeriodo, situacao: { not: SituacaoFiliado.DESFILIADO } },
      }),
      this.prisma.filiado.count({
        where: { situacao: SituacaoFiliado.ATIVO, dataFiliacao: null },
      }),
      this.prisma.filiado.groupBy({
        by: ['motivoDesfiliacao'],
        where: saiuNoPeriodo,
        _count: { _all: true },
      }),
    ]);

    return {
      ativosHoje,
      novos,
      saidas,
      reativados,
      saldo: novos - saidas,
      semDataDeFiliacao,
      porMotivo: motivos
        .map((m) => ({ rotulo: m.motivoDesfiliacao ?? 'NAO_INFORMADO', total: m._count._all }))
        .sort((a, b) => b.total - a.total || a.rotulo.localeCompare(b.rotulo, 'pt-BR')),
    };
  }

  /**
   * AS INTIMAÇÕES QUE CITAM UMA PESSOA — o espelho dela, não o contador da casa.
   *
   * Só roda quando há alvo (o advogado olhando o próprio relatório, ou a
   * coordenação focando alguém). Na visão da casa devolve nulo: "quantas
   * intimações me nomearam" não é pergunta que o coletivo responda.
   *
   * NÃO É MEDIDA DE PRODUTIVIDADE, e a tela diz isso com todas as letras. O ato
   * do DJEN intima a EQUIPE inteira — quem tem mais processos na OAB aparece
   * com mais intimações sem ter trabalhado mais. O que o número serve é para a
   * própria pessoa mostrar o serviço que passou pelas mãos dela.
   */
  private async minhasIntimacoes(
    alvo: string,
    inicio: Date,
    fim: Date,
  ): Promise<MinhasIntimacoes> {
    const advogado = await this.prisma.user.findUnique({
      where: { id: alvo },
      select: { oab: true, oabUf: true },
    });
    const vazio: MinhasIntimacoes = {
      temOab: temInscricao(advogado),
      recebidas: 0,
      viraramTarefa: 0,
      tarefasConcluidas: 0,
      tarefasEmAberto: 0,
      oRoboDispensou: 0,
    };
    if (!vazio.temOab) return vazio;

    const ids = await publicacoesQueCitam(this.prisma, advogado, { de: inicio, ate: fim });
    if (!ids.length) return vazio;

    /*
      UMA CONSULTA SÓ, e não cinco contagens: os ids já estão em mãos e a
      publicação é uma linha curta. Contar no banco cinco vezes a mesma fatia
      custaria cinco varreduras para responder o que uma leitura resolve.
    */
    const linhas = await this.prisma.comunicacaoDjen.findMany({
      where: { id: { in: ids } },
      select: {
        tarefaDispensadaEm: true,
        compromisso: { select: { status: true } },
      },
    });

    let viraramTarefa = 0;
    let tarefasConcluidas = 0;
    let tarefasEmAberto = 0;
    let oRoboDispensou = 0;
    for (const l of linhas) {
      if (l.compromisso) {
        viraramTarefa++;
        if (l.compromisso.status === StatusCompromisso.CONCLUIDO) tarefasConcluidas++;
        else if ((ABERTOS as StatusCompromisso[]).includes(l.compromisso.status)) tarefasEmAberto++;
      } else if (l.tarefaDispensadaEm) {
        oRoboDispensou++;
      }
    }

    return {
      temOab: true,
      recebidas: linhas.length,
      viraramTarefa,
      tarefasConcluidas,
      tarefasEmAberto,
      oRoboDispensou,
    };
  }

  /**
   * O ROBÔ, MEDIDO PELO QUE SOBROU DO TRABALHO DELE.
   *
   * As tarefas que ele criou no período e onde elas estão hoje. As canceladas
   * se dividem em duas: as que o PRÓPRIO robô cancelou (achou duplicidade, ou o
   * ato perdeu o objeto — `canceladoPor` vazio) e as que uma pessoa teve de
   * cancelar. Só a segunda é trabalho que ele deu. Medido em 12/09/2026: das
   * tarefas do robô canceladas no último mês, 14 foram por ele mesmo e 2 por
   * pessoas.
   */
  private async robo(inicio: Date, fim: Date): Promise<Robo> {
    const criadasNoPeriodo: Prisma.CompromissoWhereInput = {
      origemAutomatica: true,
      createdAt: { gte: inicio, lt: fim },
    };
    const [porStatus, canceladasPeloRobo] = await Promise.all([
      this.prisma.compromisso.groupBy({
        by: ['status'],
        where: criadasNoPeriodo,
        _count: { _all: true },
      }),
      this.prisma.compromisso.count({
        where: { ...criadasNoPeriodo, status: StatusCompromisso.CANCELADO, canceladoPor: null },
      }),
    ]);
    const doStatus = (s: StatusCompromisso) => porStatus.find((x) => x.status === s)?._count._all ?? 0;
    return {
      criadas: porStatus.reduce((total, x) => total + x._count._all, 0),
      concluidas: doStatus(StatusCompromisso.CONCLUIDO),
      canceladasPeloRobo,
      canceladasPorPessoas: doStatus(StatusCompromisso.CANCELADO) - canceladasPeloRobo,
      abertas: doStatus(StatusCompromisso.PENDENTE) + doStatus(StatusCompromisso.EM_ANDAMENTO),
    };
  }
}
