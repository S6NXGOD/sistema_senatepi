import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { diasUteisEntre } from './dias-uteis';
import { inicioDoMesBR, mesBR } from '../processos/utils/data-br.util';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  StatusAtendimento,
  Prisma,
  SituacaoFiliado,
  StatusCompromisso,
  StatusEvento,
  StatusColaborador,
  StatusProcesso,
  TipoDependente,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { integracaoAtiva, tenant } from '../../tenant/tenant.config';
import { PRE_PROCESSUAIS } from '../processos/processos.service';
import { DIAS_ATE_DORMENTE } from '../processos/utils/tpu.util';
import { PARTE_ORDER } from '../processos/partes.service';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { AudienciasService } from '../processos/audiencias.service';
import { ProcessosModule } from '../processos/processos.module';
import { ModuloTenant } from '../../common/tenant/modulo-tenant.decorator';
import { Modulo } from '../../common/permissions/modulo.decorator';
import { nivelEfetivo } from '../../common/permissions/permissoes.constants';
import { ultimoUsoReal, ultimosUsosReais } from './ultimo-acesso.util';
import {
  daPessoa, motivoParaAvisarAEquipe, ondeSouReserva, porQueAEquipePrecisa, type AvisoParaAEquipe,
} from '../agenda/equipe.util';
import { limitesDoDia, recorteAberto } from '../agenda/recortes.util';
import { SELECT_CONSULTA_DO_ENCAMINHAMENTO } from '../atendimentos/encaminhamento.util';
import { SELECAO_DAS_ABERTAS, contarAbertasPorPessoa } from '../relatorios/abertas-da-pessoa.util';
import { publicacoesQueCitam } from '../processos/utils/publicacoes-que-citam.util';
import {
  LINHA_QUE_PROVA_QUE_RODOU,
  PREFIXO_RODADA_SEM_ALVO,
  SO_CHAMADAS_AO_TRIBUNAL,
  cartaoDeAtendimentosPendentes,
  contarFilas,
  emOrdemAlfabetica,
  itemDoCadastroACompletar,
  wheresDoPainel,
  type LinhaDoCadastroACompletar,
} from './painel.regras';

// Brasil não adota horário de verão desde 2019 → offset fixo UTC-3. Usamos isto
// para calcular "hoje/esta semana" pelo relógio de Teresina, e não pelo do
// servidor (Railway roda em UTC), evitando que um compromisso das 22h "vaze"
// para o dia seguinte.
const OFFSET_BR = 3 * 3_600_000;
const DIA_MS = 24 * 3_600_000;

/**
 * O QUE VEM DO BANCO para cada publicação do painel. Declarado aqui porque o
 * agrupamento das cópias acontece fora do Prisma e precisa do tipo por escrito.
 */
interface PublicacaoBruta {
  id: string;
  link: string | null;
  /**
   * O TEOR — carregado só para AGRUPAR as cópias.
   *
   * Custa a janela de 7 dias (dezenas de linhas, não o acervo). Sem ele o
   * painel voltaria a agrupar só por link, e o tribunal emite um código de
   * validação por destinatário: o mesmo ato aparecia duas vezes.
   */
  texto: string;
  tipoComunicacao: string | null;
  nomeOrgao: string | null;
  providencia: string | null;
  prazoMencionadoDias: number | null;
  dataDisponibilizacao: Date;
  compromissoId: string | null;
  compromisso: { status: string } | null;
  processo: {
    id: string;
    numeroCNJ: string | null;
    partes: { nome: string; polo: string; principal: boolean; parteExternaId: string | null }[];
    advogado: {
      id: string;
      nome: string;
      nomeExibicao: string | null;
      avatarUrl: string | null;
      avatarKey: string | null;
    } | null;
  } | null;
}

/**
 * CONTRA QUEM É O PROCESSO.
 *
 * "De quem é" tem resposta ruim nesta base — só 4 dos 127 processos têm filiado
 * vinculado, e o sindicato é o polo ativo em 93 deles. Repetir o nome do
 * próprio sindicato em toda linha do painel não informa nada; o réu informa:
 * FMS/THE, Unimed, Hapvida.
 */
export function adversarioDoProcesso(
  partes: {
    nome: string;
    polo: string;
    principal: boolean;
    parteExternaId: string | null;
    /** Parte ligada a um filiado: o lado de quem representamos, quando o sindicato não é parte. */
    filiadoId?: string | null;
  }[],
  idDoSindicato: string | null,
): string | null {
  const nosso = partes.find((p) => ehONossoSindicato(p, idDoSindicato));

  /*
    DE QUE LADO ESTAMOS — e quem está do outro. Quatro casos, nesta ordem:

    1. O sindicato é parte: o adversário é o outro polo. Autor na esmagadora
       maioria, réu em alguns.
    2. O sindicato não é parte, mas uma parte está LIGADA A UM FILIADO: é a
       ação dele, que conduzimos, e o adversário é o outro polo. É o que acerta
       quando o filiado é o RÉU — o inquérito para apuração de falta grave que a
       empresa move contra o dirigente sindical, a cobrança contra o empregado.
    3. Sem nenhuma das duas marcas, o adversário é o polo PASSIVO: quem move a
       ação que o sindicato conduz é a pessoa. Conferido em 12/09/2026 nas 31
       ações em que só representamos: em todas, a pessoa no ativo e a empresa ou
       o ente no passivo, e nenhuma pessoa no passivo. A regra antiga devolvia
       "a primeira parte", que era a própria filiada em 20 de 26 ações ativas.
    4. Sem passivo nenhum, NINGUÉM. Era "sobra tudo" — e sobrava a filiada: 4
       casos pré-processuais, ainda sem réu cadastrado, diriam que a pessoa que
       defendemos é a parte contrária. Linha vazia é honesta; nome errado, não.
  */
  const doFiliado = nosso ? undefined : partes.find((p) => p.filiadoId);
  const nossoLado = nosso?.polo ?? doFiliado?.polo;
  const candidatos = nossoLado
    ? partes.filter((p) => p.polo !== nossoLado)
    : partes.filter((p) => p.polo === 'PASSIVO');
  if (!candidatos.length) return null;

  // A parte PRINCIPAL do polo, quando marcada; senão a primeira.
  return (candidatos.find((p) => p.principal) ?? candidatos[0]).nome;
}

/**
 * A PARTE É O PRÓPRIO SINDICATO?
 *
 * A CHAVE É A ORGANIZAÇÃO CANÔNICA, resolvida pelo CNPJ do tenant — 226 das 263
 * partes cadastradas apontam para uma, e a do sindicato é uma só.
 *
 * Comparar NOME não serviria como regra principal: nas partes importadas dos
 * tribunais o sindicato figura como "SINDICATO DOS ENFERMEIROS E TÉCNICOS DE
 * ENFERMAGEM DO ESTADO DO PIAUÍ", SEM a sigla — enquanto o DJEN o nomeia
 * "…DO ESTADO DO PIAUI - SENATEPI". Procurar a sigla erraria em 96 processos.
 *
 * E "começa com SINDICATO" seria pior ainda: disputa de representatividade
 * entre sindicatos existe, e a regra larga leria o adversário como sendo nós.
 *
 * O nome só entra como rede para as 33 partes que são texto solto, sem
 * organização vinculada, e aí exige a sigla — que é específica o bastante.
 */
export function ehONossoSindicato(
  parte: { nome: string; parteExternaId: string | null },
  idDoSindicato: string | null,
): boolean {
  if (idDoSindicato && parte.parteExternaId) return parte.parteExternaId === idDoSindicato;
  const limpo = parte.nome.normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase();
  return limpo.includes(tenant.sigla.toUpperCase());
}

/**
 * DE QUEM É O PROCESSO — e o silêncio quando a resposta é "nosso".
 *
 * O autor é o próprio sindicato em 93 dos 127 processos: escrever "SENATEPI"
 * em toda linha do painel gasta espaço para dizer o que já se sabia. Aqui ele
 * só aparece quando é OUTRO — a filiada, o grupo de profissionais, o sindicato
 * parceiro —, que é justamente a linha em que a pergunta "de quem é isto?" tem
 * resposta útil.
 */
export function autorQueInforma(
  partes: { nome: string; polo: string; principal: boolean; parteExternaId: string | null }[],
  idDoSindicato: string | null,
): string | null {
  const ativa =
    partes.find((x) => x.polo === 'ATIVO' && x.principal) ?? partes.find((x) => x.polo === 'ATIVO');
  if (!ativa) return null;
  return ehONossoSindicato(ativa, idDoSindicato) ? null : ativa.nome;
}

/**
 * EM QUE POLO NÓS ESTAMOS.
 *
 * Muda o que a publicação significa: a mesma "intimação para manifestar-se" é
 * ataque quando somos autor e defesa quando somos réu. A leitura sai das
 * partes; quando o sindicato não figura em nenhum polo (ação de filiado em que
 * ele é só o patrono), devolve nulo em vez de chutar.
 */
export function nossoPolo(
  partes: { nome: string; polo: string; principal: boolean; parteExternaId: string | null }[],
  idDoSindicato: string | null,
): 'ATIVO' | 'PASSIVO' | null {
  const nossa = partes.find((x) => ehONossoSindicato(x, idDoSindicato));
  if (!nossa) return null;
  return nossa.polo === 'ATIVO' || nossa.polo === 'PASSIVO' ? nossa.polo : null;
}

/** Data-only (UTC 00:00) do dia de `base` em Brasília — casa com colunas @db.Date. */
function dateOnlyBR(base: Date): Date {
  const br = new Date(base.getTime() - OFFSET_BR);
  return new Date(Date.UTC(br.getUTCFullYear(), br.getUTCMonth(), br.getUTCDate()));
}

/**
 * A consulta só roda com acesso ao módulo; sem ele, lista vazia — do MESMO tipo.
 *
 * `cond ? Promise.resolve([]) : consulta` faz o TypeScript ler o vazio como
 * `never[]`, e o primeiro acesso a um campo do item deixa de compilar.
 */
function seTiverAcesso<T>(acesso: boolean, consulta: () => Promise<T[]>): Promise<T[]> {
  return acesso ? consulta() : Promise.resolve([]);
}

/** Compromissos abertos (pendentes ou em andamento). */
const ABERTOS = { in: [StatusCompromisso.PENDENTE, StatusCompromisso.EM_ANDAMENTO] };

/**
 * Um processo que o CNJ recusou na última tentativa (ver `falhasDatajud24h`).
 *
 * `processoId` é nulo quando o processo foi excluído depois da falha — o log
 * sobrevive com o NPU, que aí é a única identidade disponível. LGPD: só o
 * metadado público (NPU, tribunal) e o nome do filiado principal, que a lista
 * de processos já mostra.
 */
interface FalhaDatajud {
  processoId: string | null;
  numeroCNJ: string;
  tribunal: string | null;
  httpStatus: number | null;
  mensagemErro: string | null;
  createdAt: Date;
  filiado: string | null;
  /**
   * Quanto tempo a chamada durou. 45.000ms é o nosso teto de espera — com ele
   * a tela distingue "o CNJ demorou demais" de "o CNJ não respondeu", que
   * levam a conclusões diferentes.
   */
  duracaoMs: number | null;
  /**
   * QUANDO ESTE PROCESSO FOI LIDO COM SUCESSO PELA ÚLTIMA VEZ — e é esta a
   * informação que faltava.
   *
   * A faixa dizia "a varredura não conseguiu atualizar 6 processos" e listava
   * seis. Medido em 05/09/2026: os seis eram *timeouts de 45s* de UMA rodada, e
   * todos tinham sido lidos com sucesso 33 a 37 horas antes, sem nada novo no
   * CNJ. Nenhum estava desatualizado. A faixa acusava um problema de processo
   * onde havia um soluço passageiro da rodada.
   */
  ultimoSucesso: Date | null;
}

/**
 * Um NPU que o CNJ diz não conhecer — e que o robô continua perguntando.
 *
 * Este caso é gravado como `sucesso = true` (a consulta FUNCIONOU; o índice é
 * que não tem o processo), e por isso era invisível. Medido: um único NPU
 * consultado **151 vezes em 7 dias**, sempre com a mesma resposta. Ou o número
 * está errado, ou o processo não foi distribuído — e as duas coisas são
 * trabalho de gente, não de robô.
 */
interface ProcessoDesconhecidoNoCnj {
  processoId: string | null;
  numeroCNJ: string;
  tribunal: string | null;
  filiado: string | null;
  tentativas: number;
  desde: Date;
  ultima: Date;
}

/** Campos mínimos de um compromisso para os cards da home (LGPD: só o essencial). */
const compSelect = {
  id: true,
  titulo: true,
  tipo: true,
  status: true,
  inicio: true,
  fim: true,
  local: true,
  urgente: true,
  /**
   * O MOTIVO VIAJA JUNTO COM A MARCA.
   *
   * O painel desenhava a tarja "Urgente" à mão, sem trazer `urgenteMotivo` —
   * enquanto a agenda usa o `SeloUrgente`, que mostra o porquê ao passar o
   * mouse. Marca vermelha sem explicação é exatamente o que faz a equipe
   * aprender a ignorar a marca, e foi para isso que o campo foi criado.
   */
  urgenteMotivo: true,
  urgenteEm: true,
  iniciadoEm: true,
  responsavel: { select: { id: true, nome: true, nomeExibicao: true, avatarUrl: true, avatarKey: true } },
  filiado: { select: { id: true, nomeCompleto: true } },
  /**
   * As PARTES entram para o cartão poder dizer de que caso é a atividade.
   *
   * O painel sofria do mesmo problema da agenda: duas linhas "Verificação de
   * Intimação / Prazo" idênticas, sem nada que as distinguisse. `PARTE_ORDER`
   * põe a principal de cada polo primeiro — a tela pega a primeira PASSIVO.
   */
  processo: {
    select: {
      id: true,
      numeroCNJ: true,
      titulo: true,
      partes: { select: { nome: true, polo: true }, orderBy: PARTE_ORDER },
    },
  },
  /** O link da chamada, quando a consulta é por vídeo (C4). */
  linkReuniao: true,
  /**
   * A TAREFA "CADASTRAR AÇÃO DO DIÁRIO" leva o NPU que falta no acervo (C7).
   *
   * Com ele o gesto da linha é cadastrar, e não concluir: fechar como
   * "Cumprida" deixava a ação na fila de "Ações sem cadastro" e a agenda dizia
   * que estava feito — e `fecharTarefaDeCadastro` não corrige tarefa já fechada.
   */
  sugestaoDeCadastro: { select: { numeroCNJ: true } },
} as const;

/**
 * O MESMO CARTÃO PARA QUEM NÃO TEM O MÓDULO DE PROCESSOS — sem as partes e sem a
 * ação a cadastrar.
 *
 * A Triagem tem `processos: SEM_ACESSO` no preset, e as listas de atividade
 * mandavam para ela quem litiga em cada caso. É o corte que a agenda já faz na
 * listagem desde 13/09/2026 (`cardSelectSemPartes`): saber contra quem é o
 * processo é dado de Processos. O NPU da ação nova também sai — o link
 * "Cadastrar" levaria a uma tela que ela não abre.
 */
const compSelectSemProcessos = {
  ...compSelect,
  processo: { select: { id: true, numeroCNJ: true, titulo: true } },
  sugestaoDeCadastro: false,
} as const;

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audiencias: AudienciasService,
  ) {}

  /**
   * A integração do DJEN está ligada nesta instalação?
   *
   * Lido do ambiente/tenant e NÃO do `DjenService`, de propósito: o painel
   * pertence a outro módulo, e injetar o serviço de processos aqui criaria uma
   * dependência circular por um booleano. `integracaoAtiva` é função pura e dá
   * a mesma resposta — inclusive a precedência da variável de ambiente sobre a
   * declaração do tenant, que é o que permite ligar e desligar sem redeploy.
   */
  private get djenAtivo(): boolean {
    return integracaoAtiva('djen', process.env.DJEN_INTEGRACAO);
  }

  // =========================================================================
  // HOME consolidada e ciente do perfil (1 request → tudo que a tela precisa)
  // =========================================================================

  async resumo(user: AuthUser) {
    const agora = new Date();
    // O dia de Teresina, pela mesma função dos recortes da agenda.
    const { hojeIni, hojeFim } = limitesDoDia(agora);
    /**
     * Janela do bloco de publicações. Sete dias e não três (a janela do cron):
     * o painel é lido às segundas, e três dias esconderiam o que chegou na
     * sexta — justamente quando o prazo já está correndo.
     */
    const seteDiasAtras = new Date(agora.getTime() - 7 * DIA_MS);
    const menos7dias = new Date(agora.getTime() - 7 * DIA_MS);
    const inicioMes = (() => {
      const br = new Date(agora.getTime() - OFFSET_BR);
      return new Date(Date.UTC(br.getUTCFullYear(), br.getUTCMonth(), 1) + OFFSET_BR);
    })();
    const hojeData = dateOnlyBR(agora);
    const amanhaData = new Date(hojeData.getTime() + DIA_MS);

    const souAdvogado = user.role === 'ADVOGADO';
    const ehGestao = user.role === 'ADMINISTRADOR' || user.role === 'COORDENACAO';
    /** Quem EDITA filiado — é de quem é a fila de recadastro. */
    const podeVerFiliados = nivelEfetivo(user.role, user.permissoes, 'filiados') === 'EDITAR';
    /**
     * QUEM NÃO TEM O MÓDULO DE PROCESSOS NÃO RECEBE O DADO DE PROCESSOS.
     *
     * A Triagem tem `processos: SEM_ACESSO` no preset do perfil, e a home
     * escondia os blocos jurídicos só na TELA — o teor das publicações, o
     * nome das partes contrárias e o do advogado de cada processo viajavam
     * até o navegador dela de qualquer forma. É a mesma regra já escrita para
     * `cargaEquipe`: o corte é no backend; esconder no front é conforto, não
     * controle de acesso.
     */
    const veProcessos = nivelEfetivo(user.role, user.permissoes, 'processos') !== 'SEM_ACESSO';
    /**
     * MESMA REGRA PARA A AGENDA — e ela faltava.
     *
     * As listas de compromisso carregam `filiado.nomeCompleto`, o nome do
     * responsável e as partes do processo. Quem tem `agenda: SEM_ACESSO` via
     * tudo isso chegar ao navegador; o que o impedia de ler era o `pode.agenda`
     * da TELA. Hoje nenhum usuário da produção está nessa condição — mas 13 dos
     * 14 têm permissão customizada, e a tela de usuários oferece o SEM_ACESSO
     * como opção. Esconder no front é conforto, não controle de acesso: é a
     * mesma frase que já está escrita acima para `veProcessos`.
     *
     * Os CONTADORES continuam vindo: são agregados sem dado pessoal, e a tela
     * já decide quais cartões desenhar. O que passa a ser cortado é o conteúdo.
     */
    const veAgenda = nivelEfetivo(user.role, user.permissoes, 'agenda') !== 'SEM_ACESSO';
    /**
     * O PLANTÃO TAMBÉM SE CORTA NO SERVIDOR.
     *
     * `equipeHoje` ia para todo mundo, e quem escondia o cartão era o
     * `pode.escalas` da tela — a mesma contradição que `veAgenda` corrigiu
     * (auditoria das escalas, 12/09/2026). O preset da Triagem é SEM_ACESSO; na
     * produção ela tem a escala na matriz própria e continua recebendo.
     */
    const veEscalas = nivelEfetivo(user.role, user.permissoes, 'escalas') !== 'SEM_ACESSO';
    /** A lista de atendimentos pendentes é dado do módulo de atendimentos; o contador continua. */
    const veAtendimentos = nivelEfetivo(user.role, user.permissoes, 'atendimentos') !== 'SEM_ACESSO';
    /**
     * Escopo pessoal do advogado: suas atividades e sua carteira. Demais perfis
     * enxergam a operação inteira.
     *
     * INCLUI O QUE ELE ACOMPANHA SEM RESPONDER. Desde que a atividade passou a
     * ter equipe, filtrar só por `responsavelId` deixaria o segundo advogado de
     * uma audiência sem ela no próprio painel — ele veria "0 audiências esta
     * semana" no dia em que tem uma. O atalho fica no OR junto com a tabela
     * pelo mesmo motivo documentado em `AgendaService.listar`.
     */
    /*
      A RÉGUA DO SINO, e não uma cópia dela. Escrito à mão aqui, o recorte
      incluía a reserva que o robô anexa à tarefa automática: desde 11/09/2026 o
      painel do advogado contava como sua a tarefa do colega em que ele é
      reserva, enquanto o sino dizia o contrário. A tarefa do caso em que ele é
      reserva aparece à parte, com o nome de quem responde — ver `daEquipe` em
      `alertas`.
    */
    const meu: Prisma.CompromissoWhereInput = souAdvogado ? daPessoa(user.id) : {};
    /** O que cada número conta é o que o link dele abre na agenda — ver `wheresDoPainel`. */
    const painel = wheresDoPainel(meu, agora);
    /** As listas de atividade, sem as partes para quem não vê Processos. */
    const cartao = veProcessos ? compSelect : compSelectSemProcessos;

    /**
     * O ACERVO DO ADVOGADO — mesma régua do filtro "meus" da tela de
     * Processos (`FILTRO_RAPIDO.meus`), que já inclui o processo que ele
     * acompanha sem ser o responsável principal.
     *
     * Sem isto, o advogado abria a home e via publicação dos processos dos
     * outros oito colegas. Publicação alheia na sua tela é ruído com cara de
     * prazo: ou ele confere uma a uma para descobrir que não é dele, ou
     * aprende a ignorar o bloco — e aí perde a que era.
     */
    const meuAcervo: Prisma.ProcessoWhereInput = souAdvogado
      ? { advogados: { some: { advogadoId: user.id } } }
      : {};

    /*
      "AS MINHAS PUBLICAÇÕES" ERRAVA NOS DOIS SENTIDOS.

      O recorte pessoal do Diário era só `processo: meuAcervo` — as publicações
      dos processos em que o advogado está VINCULADO. Mas quem é intimado é quem
      está NOMEADO no ato, e as duas listas são bem diferentes. Medido na
      produção em 07/09/2026, janela de 30 dias com providência:

        advogado           via acervo   que o citam
        Dra. Jaqueline          0            4      <- não via nenhuma das suas
        Dra. Morgana           32            6      <- 26 que não a citam
        Dr. Tiago              30           21
        Dr. Carlos Henrique    32           34      <- perdia 2

      O falso negativo é o grave: prazo corre para quem foi intimado, e a
      Dra. Jaqueline abria o painel e via zero. O falso positivo também custa —
      uma fila com 26 itens que não são seus ensina a não olhar a fila.

      A SOLUÇÃO É A UNIÃO, e não a troca: quem responde pelo caso precisa ver o
      ato mesmo quando a intimação saiu no nome do colega. O que muda é a
      ORDEM e a marca — `meCita` sobe primeiro e leva selo (ver `resumirPublicacoes`).

      Por que SQL cru: `advogados` é um JSON de objetos e o `array_contains` do
      Prisma exige o objeto INTEIRO igual, inclusive o `nome` — que vem do
      tribunal em caixa alta e sem acento. A OAB é a única chave confiável.
    */
    const oabDoUsuario = souAdvogado
      ? await this.prisma.user.findUnique({
          where: { id: user.id },
          select: { oab: true, oabUf: true },
        })
      : null;

    // Sem o módulo de processos as consultas do Diário nem rodam — gastar uma
    // varredura de JSON para um conjunto que ninguém vai usar é só desperdício.
    const idsQueMeCitam = veProcessos
      ? await this.publicacoesQueCitam(oabDoUsuario, seteDiasAtras)
      : [];

    /** Escopo pessoal do Diário: o meu acervo OU o ato que me nomeia. */
    const meuDjen: Prisma.ComunicacaoDjenWhereInput = souAdvogado
      ? { OR: [{ processo: meuAcervo }, ...(idsQueMeCitam.length ? [{ id: { in: idsQueMeCitam } }] : [])] }
      : {};

    /*
      "PARADA" SÓ FAZ SENTIDO DEPOIS QUE A DATA CHEGOU.

      A regra era `aberta E sem mexer há 7 dias`, e não olhava a data da
      atividade. Uma audiência marcada para daqui a três semanas, que ninguém
      tocou porque ainda não há o que fazer, contava como "parada" — e o
      "Preparar audiência" que o robô passou a criar dias antes da pauta é
      exatamente esse caso: nasce cedo e fica intocado de propósito. Sem este
      corte, a faixa ia acusar de abandono o trabalho que ainda nem começou.

      Medido na produção em 12/09/2026, antes do corte: 1 atividade parada, e
      com a data já vencida — o corte não esconde nada do que existe hoje, só
      impede o alarme falso que viria.
    */
    const paradaWhere: Prisma.CompromissoWhereInput = {
      ...meu,
      status: ABERTOS,
      updatedAt: { lt: menos7dias },
      inicio: { lte: agora },
    };

    const [
      // KPIs globais
      processosAtivos,
      processosTotal,
      processosPreProcessuais,
      atendimentosPendentesCount,
      filiadosAtivos,
      filiadosTotal,
      novosFiliadosMes,
      prazosSemana,
      // Alertas (escopo do perfil)
      atrasadasCount,
      passaramDaHoraCount,
      semMovimentacaoCount,
      urgentesEmAbertoCount,
      // Listas
      atividadesHoje,
      proximasAtividades,
      audienciasSemana,
      audienciasSemanaTotal,
      pendenciasAtivas,
      atendimentosPendentes,
      movimentacoesRecentes,
      plantaoHoje,
      proximasEscalas,
      // Gráficos
      canalGroup,
      atendimentos14Raw,
      crescimentoRaw,
      // Radar de audiências (DataJud → Agenda)
      audienciasAAgendar,
      // Movimentação do quadro associativo
      desfiliadosMes,
      saidasRaw,
      // Saúde do robô de sincronização
      ultimaSync,
      falhasSync,
      desconhecidosNoCnj,
      processosMonitorados,
      // Qualidade do dado e painéis por perfil
      filiadosSemDataFiliacao,
      abertasDaEquipeRaw,
      contatosHoje,
      aniversariantes,
      cadastros,
      tempoMedioTriagem,
      saudeSincronizacao,
      // Saúde e conteúdo do robô do DJEN (publicações)
      djenPublicacoes7d,
      djenUltimaPublicacao,
      djenRecentes,
      organizacaoDoSindicato,
      adversariosRaw,
      filaDosPendentes,
    ] = await Promise.all([
      /*
        O NÚMERO DE PROCESSOS NÃO VAI PARA QUEM NÃO VÊ PROCESSOS (18/09/2026).

        A tela já escondia o cartão (`pode.processos &&`), mas a API mandava os
        três números assim mesmo — e a Triagem tem `processos: SEM_ACESSO`.
        Conferido no payload dela: `processosAtivos`, `processosTotal` e
        `processosPreProcessuais` chegavam preenchidos. É exatamente o que a
        regra da casa condena: esconder na tela é conforto, não controle de
        acesso. Nulo, e o cartão continua invisível pelo mesmo caminho.
      */
      veProcessos
        ? this.prisma.processo.count({ where: { statusInterno: StatusProcesso.ATIVO } })
        : Promise.resolve(null),
      /**
       * O TOTAL QUE O CARTÃO MOSTRA — o mesmo universo da tela de Processos.
       *
       * O cartão mostrava só os ATIVOS, e quem tinha 5 processos cadastrados
       * lia "4" como "só existem 4": arquivado, suspenso e encerrado sumiam sem
       * deixar rastro. Daí o total no subtítulo, para responder "cadê o resto?"
       * sem abrir a lista.
       *
       * SÓ QUE ELE CONTAVA TUDO, inclusive os pré-processuais — e a tela de
       * Processos os esconde da lista padrão, de propósito. O cartão dizia "11
       * no total", a tela dizia "7 processos", e nenhum dos dois explicava a
       * diferença. Dois números com a mesma palavra é como se um deles
       * estivesse errado, e a pessoa perde a confiança nos dois.
       *
       * Agora este conta o MESMO conjunto da tela, e a fila pré-processual vai
       * logo abaixo, com nome próprio. Os dois somam o que há no banco.
       */
      veProcessos
        ? this.prisma.processo.count({ where: { statusInterno: { notIn: PRE_PROCESSUAIS } } })
        : Promise.resolve(null),
      veProcessos
        ? this.prisma.processo.count({ where: { statusInterno: { in: PRE_PROCESSUAIS } } })
        : Promise.resolve(null),
      this.prisma.atendimento.count({ where: { status: 'PENDENTE' } }),
      this.prisma.filiado.count({ where: { situacao: SituacaoFiliado.ATIVO } }),
      this.prisma.filiado.count(),
      this.prisma.filiado.count({ where: { dataFiliacao: { gte: inicioMes, lte: agora } } }),
      /*
        "PRAZOS ESTA SEMANA" É A ABA 7 DIAS FILTRADA EM PRAZO — que é o link do
        cartão. Somava audiência e só contava início a partir de hoje: o número
        dizia uma coisa e o clique mostrava outra (auditoria de 12/09/2026).
      */
      this.prisma.compromisso.count({ where: painel.prazosSemana }),
      /*
        ATRASADA = FICOU PARA TRÁS, o dia já virou. Era `inicio < agora`.

        O sistema tinha DUAS definições da palavra mais grave que ele usa, e
        elas discordavam na cara do usuário: o sino (`pendencias.service.ts`)
        conta o que sobrou de DIA ANTERIOR, o painel contava tudo com a HORA
        passada. Em 08/09/2026 isso dava sino = 0 e painel = "8 atrasadas",
        para a mesma pessoa no mesmo instante.

        Venceu a do sino, porque é a que não admite discussão: ninguém defende
        que uma tarefa de ontem por fazer esteja em dia. O que é de HOJE com a
        hora passada virou o contador de baixo — informação, não alarme. Ver
        `estadoDoPrazo` em `lib/agenda.ts` (web) para o argumento inteiro.
      */
      this.prisma.compromisso.count({ where: painel.atrasadas }),
      /* Passou da hora marcada, mas ainda é HOJE — o robô agenda para as 15:00
         do próprio dia, e às 15:01 isso não é prazo perdido. */
      this.prisma.compromisso.count({ where: painel.passaramDaHora }),
      this.prisma.compromisso.count({ where: paradaWhere }),
      // Urgente EM ABERTO, sem corte de data — a aba "Em aberto" com urgentes=1.
      this.prisma.compromisso.count({ where: painel.urgentes }),
      // Atividades de hoje
      !veAgenda ? Promise.resolve([]) : this.prisma.compromisso.findMany({
        where: painel.atividadesHoje,
        orderBy: { inicio: 'asc' },
        take: 12,
        select: cartao,
      }),
      /*
        O QUE VENCE NOS PRÓXIMOS DIAS — e que não aparecia em lugar nenhum.

        A home tinha três janelas: vencido (Pendências), HOJE (Atividades) e
        audiência dos 7 dias. Um PRAZO para amanhã não cabia em nenhuma delas: o
        advogado via só o número no cartão "Prazos esta semana", sem uma linha
        sequer dizendo qual é.

        Medido na produção em 07/09/2026: dos compromissos abertos do sindicato
        inteiro, **os seis** caíam exatamente nessa faixa — zero vencidos, zero
        hoje, zero audiências na semana. A home do Dr. Carlos Henrique dizia
        "nenhuma atividade agendada para hoje" enquanto ele tinha prazo para
        amanhã e para depois.

        Audiência fica de FORA porque já tem bloco próprio logo acima; repetir a
        mesma audiência em dois cartões é o erro que a faixa do DJEN já cometeu.
      */
      !veAgenda ? Promise.resolve([]) : this.prisma.compromisso.findMany({
        // De amanhã até o fim do sétimo dia, em aberto, sem audiência — ver `wheresDoPainel`.
        where: painel.proximasAtividades,
        orderBy: { inicio: 'asc' },
        take: 8,
        select: cartao,
      }),
      // Audiências da semana (próximos 7 dias)
      !veAgenda ? Promise.resolve([]) : this.prisma.compromisso.findMany({
        where: painel.audienciasSemana,
        orderBy: { inicio: 'asc' },
        take: 8,
        select: cartao,
      }),
      // O selo do bloco: o que o "Ver" abre (aba=7dias&tipo=AUDIENCIA), sem o
      // corte de 8 da lista — ver `audienciasSemanaTotal` em `wheresDoPainel`.
      this.prisma.compromisso.count({ where: painel.audienciasSemanaTotal }),
      /*
        O QUE FICOU PARA TRÁS — e só isso.

        Esta lista era `inicio < agora` sem piso, e alimentava um bloco
        "Pendências ativas" no fim do painel. Medido em 08/09/2026: das 8
        pendências, **as 8** já estavam em `atividadesHoje` (nenhuma de dia
        anterior). O painel renderizava o mesmo trabalho TRÊS vezes — a barra
        amarela contando 8, a lista de atividades marcando as 8 de âmbar, e o
        bloco de baixo listando as 8 de novo.

        Agora o piso é o INÍCIO DE HOJE: aqui só entra o que venceu em dia
        anterior, que é justamente o que a lista de hoje não mostrava. As duas
        viram uma fila só na tela, com o atrasado no topo. Nada se perde e
        nada se repete.
      */
      !veAgenda ? Promise.resolve([]) : this.prisma.compromisso.findMany({
        where: painel.atrasadas,
        orderBy: { inicio: 'asc' },
        /*
          12, o teto do que pede atenção na fila da tela. Com 8, a API cortava
          antes do painel: o cabeçalho dizia 14 atrasadas, a lista mostrava 8 e o
          rodapé não sabia das outras (auditoria das ações rápidas, 12/09/2026).
        */
        take: 12,
        select: cartao,
      }),
      /*
        ATENDIMENTOS PENDENTES — com a consulta que cada um marcou.

        As consultas vêm só para derivar o estado (`situacaoDoEncaminhamento`, a
        mesma função da tela de Atendimentos) e não saem na resposta. O cartão
        mostra seis, na ordem de quem pede alguém (`cartaoDeAtendimentosPendentes`):
        por isso a leitura pega os 50 mais recentes e o corte vem depois de
        ordenar. Em 04/09/2026 havia 7 atendimentos na base inteira.

        Quem não tem o módulo de atendimentos não recebe a lista — nome do filiado,
        advogado e link da chamada são dado do módulo. O contador continua.
      */
      seTiverAcesso(veAtendimentos, () => this.prisma.atendimento.findMany({
        where: { status: 'PENDENTE' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          numero: true,
          canal: true,
          status: true,
          desfecho: true,
          createdAt: true,
          filiado: { select: { id: true, nomeCompleto: true } },
          compromissos: {
            where: { origemDesfechoId: null },
            select: SELECT_CONSULTA_DO_ENCAMINHAMENTO,
          },
        },
      })),
      /*
        Movimentações processuais recentes (DataJud, 7 dias) — só para quem vê
        Processos. Iam para todo mundo com NPU, descrição do andamento e nome do
        filiado, e quem escondia o bloco da Triagem era a tela (revisão de
        13/09/2026): o mesmo corte só no front que `veProcessos` condena.
      */
      seTiverAcesso(veProcessos, () => this.prisma.movimentacaoProcessual.findMany({
        where: { dataMovimento: { gte: menos7dias } },
        orderBy: { dataMovimento: 'desc' },
        take: 8,
        select: {
          id: true,
          descricao: true,
          dataMovimento: true,
          processo: { select: { id: true, numeroCNJ: true, filiado: { select: { nomeCompleto: true } } } },
        },
      })),
      // Plantão de hoje — só para quem vê a escala (ver `veEscalas`).
      seTiverAcesso(veEscalas, () => this.prisma.escalaAdvogado.findMany({
        where: { data: { gte: hojeData, lt: amanhaData } },
        orderBy: { horaInicio: 'asc' },
        select: {
          id: true,
          horaInicio: true,
          horaFim: true,
          advogado: { select: { id: true, nome: true, nomeExibicao: true, avatarUrl: true, avatarKey: true } },
        },
      })),
      // Próximas escalas (para "próximo plantão")
      seTiverAcesso(veEscalas, () => this.prisma.escalaAdvogado.findMany({
        where: { data: { gte: amanhaData } },
        orderBy: [{ data: 'asc' }, { horaInicio: 'asc' }],
        take: 8,
        select: {
          id: true,
          data: true,
          horaInicio: true,
          horaFim: true,
          advogado: { select: { id: true, nome: true, nomeExibicao: true, avatarUrl: true, avatarKey: true } },
        },
      })),
      // Gráfico: atendimentos por canal (todos)
      this.prisma.atendimento.groupBy({ by: ['canal'], _count: { _all: true } }),
      // Gráfico: volume de atendimentos nos últimos 14 dias
      this.prisma.atendimento.findMany({
        where: { createdAt: { gte: new Date(agora.getTime() - 14 * DIA_MS), lte: agora } },
        select: { createdAt: true },
      }),
      // Gráfico: crescimento de filiados (6 meses).
      // Usa `dataFiliacao` — e NÃO `createdAt`, que a importação legada
      // sobrescrevia. Quem está sem data (carga sem a informação na planilha)
      // fica fora da série em vez de virar um pico falso.
      this.prisma.filiado.findMany({
        where: { dataFiliacao: { gte: this.seisMesesAtras(), lte: agora } },
        select: { dataFiliacao: true },
      }),
      // Audiências designadas no DataJud que ainda não entraram na agenda.
      // Mesmo escopo do resto do painel: o advogado vê só a própria carteira.
      this.audiencias.listar({ advogadoId: souAdvogado ? user.id : undefined, limite: 6 }),

      // Saídas do quadro no mês — o contrapeso das entradas. Sem isto, o painel
      // só contava quem chega e a diretoria não via a evasão.
      this.prisma.filiado.count({
        where: { situacao: SituacaoFiliado.DESFILIADO, desfiliadoEm: { gte: inicioMes, lte: agora } },
      }),
      // Série de saídas (6 meses) para o comparativo do gráfico.
      this.prisma.filiado.findMany({
        where: { desfiliadoEm: { gte: this.seisMesesAtras(), lte: agora } },
        select: { desfiliadoEm: true },
      }),

      // SAÚDE DO ROBÔ do DataJud. O cron roda de madrugada e, quando falha,
      // falhava em silêncio: o painel mostrava "0 audiências a agendar" tanto
      // quando não havia nada quanto quando a varredura nem tinha rodado.
      this.prisma.logSincronizacaoDatajud.findFirst({
        // Só o DataJud: "quando o robô rodou pela última vez" se refere à
        // varredura das 02h. O DJEN roda às 05h e tem cadência própria.
        //
        // A LINHA DE RESUMO DA RODADA ENTRA AQUI, e de propósito (desde
        // 13/09/2026): ela é gravada no fim da varredura, e "rodada sem alvo"
        // é o robô ter rodado. Quem precisa só das chamadas ao tribunal —
        // `saudeDasFontes` e `falhasDatajud24h` — corta a linha de resumo.
        // A "Rodada interrompida" NÃO entra: ver `LINHA_QUE_PROVA_QUE_RODOU`.
        where: { AND: [{ fonte: 'DATAJUD' }, LINHA_QUE_PROVA_QUE_RODOU] },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, sucesso: true },
      }),
      this.falhasDatajud24h(new Date(agora.getTime() - DIA_MS)),
      // NPUs que o CNJ não conhece — janela larga: o que importa é a INSISTÊNCIA.
      this.processosDesconhecidosNoCnj(new Date(agora.getTime() - 30 * DIA_MS)),
      // Quantos processos o robô de fato varre — MESMO critério de
      // `ProcessosService.idsParaSincronizar`. É o denominador que faltava:
      // sem ele, "nunca rodou" virava alarme numa base sem processo nenhum,
      // acusando de parado um robô que simplesmente não tem o que fazer.
      this.prisma.processo.count({
        where: { statusInterno: { in: ['ATIVO', 'PENDENTE'] }, numeroCNJ: { not: null } },
      }),

      // Filiados sem data de filiação (vieram da carga sem a informação).
      // A tela informa o número em vez de fingir que a série está completa.
      this.prisma.filiado.count({ where: { dataFiliacao: null } }),

      /*
        CARGA DA EQUIPE — as abertas da casa, para somar pessoa por pessoa.

        É o que responde "quem está sobrecarregado?". Contava por `responsavelId`
        (um agrupamento no banco), e o clique abre a agenda da pessoa pela régua
        `daPessoa`: responde OU foi posta na atividade por gente. A audiência em
        que a advogada está na equipe não entrava no número dela e aparecia no
        clique. Uma leitura só, somada em memória pela mesma função do Uso e
        produtividade (`contarAbertasPorPessoa`): em 12/09/2026 eram 15 abertas
        na casa. Atrasada é a do dia que virou, a régua do resto do painel. Só
        roda para quem recebe a carga.
      */
      ehGestao
        ? this.prisma.compromisso.findMany({ where: recorteAberto(), select: SELECAO_DAS_ABERTAS })
        : Promise.resolve([]),

      // FILA DA TRIAGEM — tarefas de contato do dia (as que o robô cria antes
      // das audiências). Sem isto, a secretaria não tinha o próprio trabalho na
      // home: via o painel do jurídico com buracos.
      //
      // Só com a agenda, como as outras listas de atividade: era a única que
      // não passava por `veAgenda` (revisão de 13/09/2026).
      seTiverAcesso(veAgenda, () => this.prisma.compromisso.findMany({
        where: { tipo: 'CONTATO', status: ABERTOS, inicio: { lt: hojeFim } },
        orderBy: { inicio: 'asc' },
        take: 8,
        select: cartao,
      })),

      // Aniversariantes do dia — filiados e equipe na mesma lista.
      this.aniversariantesDeHoje(agora),
      // A fila de recadastro do balcão — ver o método.
      podeVerFiliados ? this.cadastrosACompletar(agora) : Promise.resolve({ itens: [], total: 0 }),
      // Tempo médio de resolução da triagem (30 dias).
      this.tempoMedioTriagem(agora),
      // Integrações: funcionando, instáveis ou paradas — ver `saudeDasFontes`.
      this.saudeDasFontes(agora),

      /**
       * PUBLICAÇÕES DO DJEN — volume, sinal de vida e as últimas.
       *
       * O painel já tinha "saúde do robô do DataJud", e a justificativa era que
       * a ausência de alerta é ambígua: "0 audiências a agendar" tanto pode ser
       * "não há nada" quanto "a varredura não rodou". O DJEN tem o mesmo
       * problema, agravado: ele passou UM MÊS devolvendo zero por bloqueio de
       * origem e nada na tela dizia isso.
       *
       * O VOLUME CONTA ATOS, NÃO CÓPIAS. O DJEN manda uma comunicação por
       * destinatário — o `link` do documento é o que identifica o ato. Contar
       * as linhas cruas dizia "4 publicações" onde havia 2, e a lista mostrava
       * o mesmo item duas vezes seguidas.
       */
      !veProcessos
        ? Promise.resolve([])
        : this.prisma.comunicacaoDjen.findMany({
            where: {
              dataDisponibilizacao: { gte: seteDiasAtras },
              ...meuDjen,
            },
            select: { link: true },
          }),
      !veProcessos
        ? Promise.resolve(null)
        : this.prisma.comunicacaoDjen.findFirst({
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true },
          }),
      /**
       * As últimas com PROVIDÊNCIA — não as últimas quaisquer.
       *
       * Edital e lista de distribuição chegam às dezenas e não pedem nada de
       * ninguém; listá-las no painel afogaria a intimação que pede peça em três
       * dias. A ordem é por data de disponibilização, que é a que conta prazo.
       *
       * O `take` é generoso porque as cópias só são agrupadas DEPOIS: cortar em
       * seis antes de agrupar entregaria três atos na tela.
       */
      !veProcessos
        ? Promise.resolve([])
        : this.prisma.comunicacaoDjen.findMany({
            where: {
              dataDisponibilizacao: { gte: seteDiasAtras },
              providencia: { notIn: ['NENHUMA'] },
              /*
                O QUE É DA PARTE CONTRÁRIA NÃO "PEDE PROVIDÊNCIA" NOSSA.

                O bloco se chama "Publicações que pedem providência" e é lido
                como lista de trabalho. Um ato cuja ordem é da reclamada tem
                providência classificada — o texto realmente pede algo — mas
                pede de OUTRA PESSOA. Deixá-lo aqui é a mesma confusão que fazia
                o robô criar tarefa: confundir "o ato pede algo" com "o ato pede
                algo de nós".

                O robô já carimba a decisão em `tarefaDispensadaMotivo`; aqui
                basta respeitá-la. A publicação continua visível na aba
                Publicações, com o aviso explicando de quem é o prazo.

                E O NULO PRECISA ENTRAR. `NOT: { motivo: 'X' }` vira
                `motivo <> 'X'` no SQL, que é NULO — não verdadeiro — quando a
                coluna é nula, e `WHERE nulo` descarta a linha. Nulo aqui
                significa "o robô nunca dispensou esta publicação", ou seja
                exatamente a intimação nova que o bloco existe para mostrar.
                Medido na produção em 10/09/2026: 37 das 1.488 sumiam assim, e
                eram as mais recentes.

                E VAI DENTRO DE `AND` por um motivo que quase passou: `meuDjen`
                também traz uma chave `OR` (o acervo do advogado OU o ato que o
                nomeia). Duas chaves `OR` no MESMO objeto não somam — a segunda
                sobrescreve a primeira. Espalhado depois, `...meuDjen` apagaria
                esta exclusão inteira, e só para quem é advogado.
              */
              AND: [
                {
                  OR: [
                    { tarefaDispensadaMotivo: null },
                    { tarefaDispensadaMotivo: { not: 'ORDEM_DA_OUTRA_PARTE' } },
                  ],
                },
                meuDjen,
              ],
            },
            orderBy: { dataDisponibilizacao: 'desc' },
            take: 40,
            select: {
              id: true, link: true, tipoComunicacao: true, nomeOrgao: true, providencia: true,
              // `texto` entra só para agrupar as cópias — ver `PublicacaoBruta`.
              texto: true,
              prazoMencionadoDias: true, dataDisponibilizacao: true, compromissoId: true,
              compromisso: { select: { status: true } },
              processo: {
                select: {
                  id: true, numeroCNJ: true,
                  /**
                    * QUEM ESTÁ DO OUTRO LADO — é isso que distingue um processo do
                    * outro nesta base.
                    *
                    * "De quem é o processo" tem resposta ruim aqui: só 4 dos 127
                    * processos têm filiado vinculado, e o polo ativo é o próprio
                    * sindicato em 93 deles. Repetir "SINDICATO DOS ENFERMEIROS…"
                    * em toda linha não informa nada. O réu — FMS/THE, Unimed,
                    * Hapvida — informa.
                    */
                  partes: {
                    select: { nome: true, polo: true, principal: true, parteExternaId: true, filiadoId: true },
                  },
                  /*
                    O AVATAR VAI JUNTO. Numa lista de seis publicações, o nome
                    do responsável é a coluna que se lê por último; o rosto é
                    reconhecido antes de qualquer texto, e é o que responde
                    "isto é meu?" sem precisar ler.
                  */
                  advogado: {
                    select: {
                      id: true, nome: true, nomeExibicao: true,
                      avatarUrl: true, avatarKey: true,
                    },
                  },
                },
              },
            },
          }),
      /**
       * A ORGANIZAÇÃO DO PRÓPRIO SINDICATO, achada pelo CNPJ do tenant.
       *
       * É o que permite dizer CONTRA QUEM é cada processo sem comparar nome:
       * nas partes importadas dos tribunais o sindicato aparece grafado de
       * várias formas e sem a sigla. Nulo é aceitável — o painel só deixa de
       * mostrar o adversário, não quebra.
       */
      this.prisma.parteExterna.findFirst({
        where: { documento: tenant.cnpj.replace(/\D/g, '') },
        select: { id: true },
      }),
      /**
       * CONTRA QUEM O SINDICATO MAIS LITIGA.
       *
       * Um sindicato processa os MESMOS empregadores repetidamente — medido
       * na produção: FMS/THE em 10 processos, Unimed em 7, Hapvida em 6. Essa
       * é a leitura que o jurídico sindical faz e que nenhuma tela mostrava:
       * é o que sustenta uma negociação coletiva, um TAC, uma ação civil
       * pública no lugar de dez individuais.
       *
       * Agrupado pela ORGANIZAÇÃO, não pelo nome — o mesmo réu chega dos
       * tribunais grafado de várias formas.
       */
      !veProcessos
        // O array vazio precisa do tipo: sem ele o TypeScript infere `never[]`
        // e o `.filter` abaixo passa a operar sobre `never`.
        ? Promise.resolve<{ parteExternaId: string | null; _count: { processoId: number } }[]>([])
        : this.prisma.parteProcesso.groupBy({
            by: ['parteExternaId'],
            where: {
              parteExternaId: { not: null },
              processo: {
                statusInterno: StatusProcesso.ATIVO,
                ...(souAdvogado ? meuAcervo : {}),
              },
            },
            _count: { processoId: true },
          }),
      /*
        AS DUAS FILAS DOS PENDENTES (15/09/2026, E3 da rodada 4) — com a triagem
        ou aguardando a consulta. A fila depende do relógio e das consultas, e só
        existe na leitura (`filaDoAtendimento`); por isso a contagem lê TODOS os
        pendentes, sem o corte de 50 da lista do cartão. Medido em 14/09: 10
        atendimentos na base, 2 pendentes.

        Roda para todo perfil, como o contador antigo: são números, e nada desta
        leitura sai na resposta (sem filiado, sem advogado, sem link).
      */
      this.prisma.atendimento.findMany({
        where: { status: StatusAtendimento.PENDENTE },
        select: {
          status: true,
          desfecho: true,
          createdAt: true,
          atendentePorId: true,
          compromissos: {
            where: { origemDesfechoId: null },
            select: { id: true, status: true, inicio: true, origemDesfechoId: true, createdAt: true, responsavel: { select: { id: true, nome: true, nomeExibicao: true } } },
          },
        },
      }),
    ]);

    /**
     * ADVERSÁRIOS RECORRENTES — resolve os nomes e tira o próprio sindicato.
     *
     * O `groupBy` devolve id e contagem; o nome vem em uma consulta só, para os
     * que sobraram. Menos de três processos não é padrão, é coincidência — o
     * corte evita uma lista com quarenta nomes de uma ocorrência cada.
     */
    const MINIMO_PARA_SER_PADRAO = 3;
    const adversarios = await (async () => {
      if (!veProcessos) return [];
      const relevantes = adversariosRaw
        .filter(
          (a) =>
            a.parteExternaId &&
            a.parteExternaId !== organizacaoDoSindicato?.id &&
            a._count.processoId >= MINIMO_PARA_SER_PADRAO,
        )
        .sort((a, b) => b._count.processoId - a._count.processoId)
        .slice(0, 6);
      if (!relevantes.length) return [];

      const orgs = await this.prisma.parteExterna.findMany({
        where: { id: { in: relevantes.map((a) => a.parteExternaId!) } },
        select: { id: true, nome: true, nomeFantasia: true, tipo: true },
      });
      const porId = new Map(orgs.map((o) => [o.id, o]));
      return relevantes
        .map((a) => {
          const org = porId.get(a.parteExternaId!);
          if (!org) return null;
          return {
            id: org.id,
            // O nome fantasia é o que a equipe usa na conversa ("Hapvida"), e o
            // razão social é o que o tribunal escreve. Prefere o curto.
            nome: org.nomeFantasia || org.nome,
            tipo: org.tipo,
            processos: a._count.processoId,
          };
        })
        .filter((a): a is NonNullable<typeof a> => a !== null);
    })();

    /*
      "PRÓXIMO PLANTÃO" — e ele passou a levar as HORAS junto.

      A consulta já selecionava `horaInicio`/`horaFim`; o objeto as jogava fora
      e o painel escrevia só "segunda-feira, 14/09". Medido na produção: o
      próximo plantão costuma estar a QUATRO dias (a escala pula o fim de
      semana), então a data sozinha não responde "quando alguém volta a estar
      disponível" — nem a que horas.

      `advogados` CONTINUA saindo, ao lado de `pessoas`. Web e API sobem em
      serviços separados: durante a janela de troca, a web antiga ainda lê o
      campo antigo. Quando ela tiver girado, este some.
    */
    type PessoaNoPlantao = {
      horaInicio: string;
      horaFim: string;
      advogado: typeof proximasEscalas[number]['advogado'];
    };
    let proximoPlantao:
      | {
          data: Date;
          pessoas: PessoaNoPlantao[];
          /** @deprecated Use `pessoas` — mantido para a janela de troca. */
          advogados: typeof proximasEscalas[number]['advogado'][];
        }
      | null = null;
    if (proximasEscalas.length) {
      const primeira = dateOnlyBR(proximasEscalas[0].data).getTime();
      const doDia = proximasEscalas.filter((e) => dateOnlyBR(e.data).getTime() === primeira);
      proximoPlantao = {
        data: doDia[0].data,
        pessoas: doDia.map((e) => ({
          horaInicio: e.horaInicio,
          horaFim: e.horaFim,
          advogado: e.advogado,
        })),
        advogados: doDia.map((e) => e.advogado),
      };
    }

    /**
     * Carga da equipe — só para quem GERE (Coordenação/Administrador).
     *
     * O corte é no BACKEND, não só na tela: a lista expõe nome e volume de
     * trabalho de cada advogado, e esconder no front deixaria o dado viajando
     * para quem não deve vê-lo. Advogado e Triagem recebem `null`.
     */
    const cargaEquipe = !ehGestao
      ? null
      : await (async () => {
          // A régua `daPessoa`, somada em memória — ver a leitura no `Promise.all`.
          const porPessoa = contarAbertasPorPessoa(abertasDaEquipeRaw, hojeIni);
          const ids = [...porPessoa.keys()];
          if (!ids.length) return [];
          /*
            QUANDO CADA UM ESTEVE AQUI PELA ÚLTIMA VEZ — o dado que faltava para
            cobrar quem some.

            O sino, a faixa e o painel avisam quem ABRE o sistema. A medição de
            12/09/2026 mostrou o furo: das três atividades atrasadas da casa,
            duas eram de uma pessoa que não entrava havia 39 dias. Aviso dentro
            do sistema não alcança quem não entra; quem alcança é a coordenação,
            e ela precisa ver isso ao lado do atraso. Ver `ultimoUsoReal`.
          */
          const [pessoas, sessoes, acoes] = await Promise.all([
            this.prisma.user.findMany({
              where: { id: { in: ids }, ativo: true },
              select: {
                id: true, nome: true, nomeExibicao: true, avatarUrl: true, avatarKey: true,
                ultimoLoginEm: true,
              },
            }),
            this.prisma.refreshToken.groupBy({
              by: ['userId'],
              where: { userId: { in: ids } },
              _max: { createdAt: true },
            }),
            this.prisma.auditoria.groupBy({
              by: ['userId'],
              where: { userId: { in: ids }, acao: { not: 'LOGIN' } },
              _max: { createdAt: true },
            }),
          ]);
          const sessaoPorId = new Map(sessoes.map((s) => [s.userId, s._max.createdAt]));
          const acaoPorId = new Map(acoes.map((a) => [a.userId, a._max.createdAt]));
          const itens = ids
            .map((id) => {
              const achada = pessoas.find((u) => u.id === id);
              if (!achada) return null; // usuário inativo/removido não entra no painel
              const { ultimoLoginEm, ...p } = achada;
              const conta = porPessoa.get(id)!;
              return {
                advogado: p,
                abertas: conta.abertas,
                atrasadas: conta.atrasadas,
                ultimoAcesso:
                  ultimoUsoReal(ultimoLoginEm, sessaoPorId.get(p.id), acaoPorId.get(p.id))?.toISOString() ??
                  null,
              };
            })
            .filter((x): x is NonNullable<typeof x> => x !== null);
          /*
            EM ORDEM ALFABÉTICA (D8, 13/09/2026). Era "mais atrasadas primeiro",
            com barra proporcional na tela — na prática, um pódio de quem atrasa.
          */
          return emOrdemAlfabetica(itens);
        })();

    /**
     * A CARTEIRA DO ADVOGADO — e por que ela ganhou dois números.
     *
     * "Meus processos", "minhas audiências", "atrasadas" e "urgentes" dizem o
     * que está NA AGENDA. Faltavam os dois riscos que não aparecem em agenda
     * nenhuma, porque não têm data marcada:
     *
     *  · o caso PRÉ-PROCESSUAL parado — ele sai da lista padrão de processos
     *    de propósito, e sem um contador aqui a única forma de lembrar dele é
     *    abrir a aba certa e olhar;
     *  · o processo SEM MOVIMENTAÇÃO há muito tempo — o que mais custa caro,
     *    e o único que ninguém cobra, porque não vence.
     *
     * Os dois são contados NA CARTEIRA DELE, não na do escritório: o painel do
     * advogado responde "o que EU tenho para fazer".
     */
    const minhaCarteira = souAdvogado
      ? await (async () => {
          /**
           * "PARADO" É UMA PALAVRA SÓ — E PRECISA DE UM NÚMERO SÓ.
           *
           * Este cartão dizia "sem movimentação" a partir de 30 dias; a lista
           * de processos passou a dizer "Parado há N meses" a partir de 90. Um
           * advogado que clicasse do cartão para a lista veria conjuntos
           * diferentes com o mesmo nome — a mesma armadilha do cartão que
           * contava 11 processos enquanto a tela mostrava 7.
           *
           * Ficou o 90, e a escolha é medida: no acervo de 25/08/2026, 16 dos
           * 38 processos vivos tinham andado entre 31 e 90 dias atrás. Com o
           * corte em 30, o cartão acusaria 58% da carteira — e "quase tudo está
           * parado" é a mesma coisa que "nada está parado", porque ninguém age
           * sobre uma lista que não distingue.
           */
          const paradoDesde = new Date(hojeIni.getTime() - DIAS_ATE_DORMENTE * DIA_MS);
          /**
           * A CARTEIRA É LIDA PELA TABELA DE ADVOGADOS, NÃO PELO ATALHO.
           *
           * `Processo.advogadoId` é atalho derivado: guarda só o advogado
           * PRINCIPAL. Um processo com cinco advogados tem cinco linhas em
           * `processos_advogados` e um único atalho — então contar pelo atalho
           * responde "de quantos processos eu sou o principal", que não é a
           * pergunta do painel.
           *
           * Foi assim que a Dra. Shérad viu "A ajuizar: 0" com um caso na tela
           * dela: ela está entre os advogados do caso, e o principal é outro.
           * Medido na produção em 21/08/2026 — atalho: 0, tabela: 1.
           *
           * Não precisa de OR com o atalho: `sincronizarAdvogados` grava a
           * linha do principal na tabela também, e a produção confirma (sete
           * processos com atalho, zero fora da tabela). É a mesma regra do
           * `FILTRO_RAPIDO.meus`, que a listagem usa — e é por isso que a lista
           * mostrava o caso e o painel não.
           */
          const souAdvogadoDoProcesso: Prisma.ProcessoWhereInput = {
            advogados: { some: { advogadoId: user.id } },
          };
          const [meusProcessos, minhasAudiencias, preProcessuais, semMovimentacaoMinha] =
            await Promise.all([
              this.prisma.processo.count({
                where: { ...souAdvogadoDoProcesso, statusInterno: StatusProcesso.ATIVO },
              }),
              // A aba 7 dias em audiência, da pessoa — o link do cartão (C11).
              this.prisma.compromisso.count({ where: painel.minhasAudiencias }),
              // Os DOIS rótulos do pré-processual: o legado ainda usa o antigo.
              this.prisma.processo.count({
                where: {
                  ...souAdvogadoDoProcesso,
                  statusInterno: { in: [StatusProcesso.PRE_PROCESSUAL, StatusProcesso.RASCUNHO] },
                },
              }),
              this.prisma.processo.count({
                where: {
                  ...souAdvogadoDoProcesso,
                  statusInterno: StatusProcesso.ATIVO,
                  numeroCNJ: { not: null },
                  AND: [
                    { movimentacoes: { none: { dataMovimento: { gte: paradoDesde } } } },
                    { movimentacoesInternas: { none: { createdAt: { gte: paradoDesde } } } },
                  ],
                },
              }),
            ]);
          return {
            meusProcessos,
            minhasAudiencias,
            atrasadas: atrasadasCount,
            urgentes: urgentesEmAbertoCount,
            preProcessuais,
            semMovimentacao: semMovimentacaoMinha,
          };
        })()
      : null;

    /** As duas filas da casa inteira, pela regra da tela de Atendimentos (ver `filaDosPendentes`). */
    const filasDoPainel = contarFilas(filaDosPendentes, agora);

    /**
     * A FILA DA TRIAGEM, do ponto de vista de QUEM ESTÁ NO BALCÃO.
     *
     * O painel já mostrava "atendimentos pendentes" — o número do sindicato
     * inteiro. Quem atende precisa de outra coisa: quanto EU já registrei hoje
     * (o ritmo do dia) e quantos aguardam encaminhamento. Sem isso, a secretaria
     * abre a home e vê a operação dos outros.
     */
    const minhaTriagem =
      user.role === 'TRIAGEM'
        ? await (async () => {
            const [registradosHoje, filiadosHoje] = await Promise.all([
              this.prisma.atendimento.count({
                where: { atendentePorId: user.id, createdAt: { gte: hojeIni, lt: amanhaData } },
              }),
              this.prisma.filiado.count({
                where: { createdAt: { gte: hojeIni, lt: amanhaData } },
              }),
            ]);
            /*
              "COMIGO, COM A TRIAGEM" (15/09/2026, E3). Contava todo pendente que a
              pessoa registrou, inclusive o que só espera a consulta do advogado: o
              balcão via trabalho onde não havia o que fazer. Agora é a fila
              TRIAGEM, pela mesma regra do KPI e do cartão. `semDesfecho` fica com o
              valor novo por uma versão, porque o web no ar ainda lê esse nome.
            */
            const { comATriagem } = contarFilas(filaDosPendentes, agora, user.id);
            return { registradosHoje, semDesfecho: comATriagem, comATriagem, filiadosHoje };
          })()
        : null;

    return {
      papel: user.role,
      escopo: souAdvogado ? 'PESSOAL' : 'GLOBAL',
      kpis: {
        processosAtivos,
        processosTotal,
        /** A fila que a lista padrão esconde — contada à parte, com nome. */
        processosPreProcessuais,
        /** Todo pendente. Fica por uma versão (janela de troca): o web novo lê as duas filas abaixo. */
        atendimentosPendentes: atendimentosPendentesCount,
        /** Pendentes que pedem uma ação da triagem — o KPI "Com a triagem" (E3). */
        atendimentosComATriagem: filasDoPainel.comATriagem,
        /** Pendentes que só esperam a consulta ser registrada; neutros, sem cobrança. */
        atendimentosAguardandoConsulta: filasDoPainel.aguardandoConsulta,
        prazosSemana,
        filiadosAtivos,
        filiadosTotal,
        novosFiliadosMes,
        // Contrapeso das entradas: sem a saída, o cartão só contava boa notícia.
        desfiliadosMes,
        saldoFiliadosMes: novosFiliadosMes - desfiliadosMes,
      },
      minhaCarteira,
      /** Fila própria de quem está no balcão (nulo fora da Triagem). */
      minhaTriagem,
      alertas: {
        atrasadas: atrasadasCount,
        /** De HOJE, com a hora marcada já passada. Informação, não alarme. */
        passaramDaHora: passaramDaHoraCount,
        semMovimentacao: semMovimentacaoCount,
        /*
          QUAIS ESTÃO PARADAS — o que faltava para a faixa virar trabalho.

          A faixa dizia "1 atividade está parada há mais de 7 dias" e levava
          para `/agenda` puro: a pessoa caía no quadro inteiro, na aba de hoje,
          e tinha de adivinhar qual era. O número sem o nome obriga a procurar,
          e aviso que obriga a procurar é aviso que se aprende a ignorar.

          Mesmo filtro da contagem (`paradaWhere`), então lista e número nunca
          discordam. Das mais antigas primeiro — a que está parada há mais tempo
          é a que mais precisa de alguém. Dez bastam: acima disso o caminho é a
          agenda, e a faixa diz quantas ficaram de fora.

          A consulta só roda quando há o que listar, que não é o caso normal.
        */
        paradas: semMovimentacaoCount
          ? await this.prisma.compromisso.findMany({
              where: paradaWhere,
              orderBy: { updatedAt: 'asc' },
              take: 10,
              select: {
                id: true,
                titulo: true,
                inicio: true,
                updatedAt: true,
                responsavel: {
                  select: { id: true, nome: true, nomeExibicao: true, avatarUrl: true, avatarKey: true },
                },
              },
            })
          : [],
        urgentes: urgentesEmAbertoCount,
        /*
          A EQUIPE DO ADVOGADO — as tarefas em que o robô o pôs de reserva.

          Duas listas, na ordem da urgência:
            · `precisam` — ninguém está cuidando: o responsável está sem entrar
              há uma semana ou mais (ou saiu do sistema), ou o dia já virou. É a
              MESMA regra da faixa de avisos (`motivoParaAvisarAEquipe`), então
              painel e faixa nunca discordam sobre ela;
            · `acompanhando` — em dia e com o dono por perto, de hoje a sete
              dias. Não é pendência: é saber o que a equipe tem na mão.

          Não entra em `atrasadas`, que é o que é dele (a régua de `daPessoa`),
          e só vem para o advogado: a gestão já vê a agenda de todo mundo.
        */
        daEquipe:
          souAdvogado && veAgenda
            ? await (async () => {
                const tarefas = await this.prisma.compromisso.findMany({
                  where: { status: ABERTOS, ...ondeSouReserva(user.id) },
                  orderBy: { inicio: 'asc' },
                  take: 60,
                  select: {
                    id: true,
                    titulo: true,
                    inicio: true,
                    responsavel: {
                      select: { id: true, nome: true, nomeExibicao: true, avatarUrl: true, avatarKey: true },
                    },
                  },
                });
                const usos = await ultimosUsosReais(this.prisma, tarefas.map((t) => t.responsavel.id));
                const agora = new Date();
                const fimDaSemana = new Date(hojeIni.getTime() + 8 * DIA_MS);
                const precisam: ((typeof tarefas)[number] & AvisoParaAEquipe & { detalhe: string })[] = [];
                const acompanhando: typeof tarefas = [];
                for (const t of tarefas) {
                  const aviso = motivoParaAvisarAEquipe(t, usos.get(t.responsavel.id), agora);
                  if (aviso) {
                    // A frase vem pronta — a mesma que a faixa de avisos mostra.
                    const nome = t.responsavel.nomeExibicao || t.responsavel.nome;
                    precisam.push({ ...t, ...aviso, detalhe: porQueAEquipePrecisa(nome, aviso) });
                  } else if (t.inicio < fimDaSemana) {
                    acompanhando.push(t);
                  }
                }
                return {
                  precisam: precisam.slice(0, 10),
                  totalPrecisam: precisam.length,
                  acompanhando: acompanhando.slice(0, 10),
                  totalAcompanhando: acompanhando.length,
                };
              })()
            : undefined,
        audienciasAAgendar: audienciasAAgendar.total,
      },
      audienciasAAgendar: audienciasAAgendar.items,
      /** Carga da equipe (nulo para o advogado — é instrumento de gestão). */
      cargaEquipe,
      /** Tarefas de contato com o filiado — a fila própria da Triagem. */
      contatosHoje,
      /**
       * QUEM PASSOU POR AQUI E ESTÁ COM A FICHA PELA METADE.
       *
       * Vazia para quem não edita filiado — é fila de trabalho do balcão, e
       * mostrar ao advogado uma lista que ele não pode resolver é ruído.
       */
      cadastrosACompletar: cadastros.itens,
      /** Quantos entram no critério, sem o corte da lista: "12 de 16". */
      cadastrosACompletarTotal: cadastros.total,
      /** Aniversariantes de hoje: filiados e equipe, na mesma lista. */
      aniversariantes,
      /**
       * Tempo médio da triagem (30 dias). `horas: null` quando não houve
       * resolução no período — melhor que exibir "0h" sobre amostra vazia.
       */
      tempoMedioTriagem,
      atividadesHoje,
      /** O que vence de amanhã até +7 dias (audiência tem bloco próprio). */
      proximasAtividades,
      audienciasSemana,
      /**
       * Quantas o "Ver" do bloco abre: aba=7dias&tipo=AUDIENCIA (+ pessoa=eu).
       * A lista acima para em 8 e só traz as abertas de hoje em diante; o selo
       * conta este número, o mesmo do cartão "Minhas audiências" do advogado.
       */
      audienciasSemanaTotal,
      pendenciasAtivas,
      /** Com o estado da consulta de cada um, na ordem de quem pede alguém. */
      atendimentosPendentes: cartaoDeAtendimentosPendentes(atendimentosPendentes, agora),
      movimentacoesRecentes,
      /**
       * O DJEN — saúde e conteúdo no mesmo bloco.
       *
       * Nasce da mesma constatação que criou a saúde do robô do DataJud: sem
       * ela, zero não se distingue de parado. No DJEN isso não é hipótese —
       * ele devolveu zero por UM MÊS, por bloqueio de origem, e a tela dizia
       * apenas "nenhuma publicação", que qualquer um leria como "o tribunal
       * não publicou nada nos meus processos".
       */
      /**
       * `ativa: false` para quem não tem o módulo — e não é eufemismo.
       *
       * Sem acesso, as consultas não rodam e `ultimaEm` chega nulo. Com
       * `ativa: true`, a regra classificaria isso como PRIMEIRA e a tela
       * mostraria "a integração está ligada mas nunca trouxe nada" — alarme
       * falso sobre um sistema saudável. Hoje o gate de módulo do front
       * esconde o bloco antes disso; depender só dele é depender da tela
       * para não mentir. Para quem não vê processos, a leitura honesta é
       * "não há seção do DJEN aqui", e é o que `ativa: false` significa.
       */
      djen: this.situacaoDjen(
        this.djenAtivo && veProcessos,
        djenPublicacoes7d,
        djenUltimaPublicacao?.createdAt ?? null,
        djenRecentes,
        agora,
        souAdvogado ? 'PESSOAL' : 'GLOBAL',
        organizacaoDoSindicato?.id ?? null,
        new Set(idsQueMeCitam),
      ),
      /**
       * Contra quem o sindicato mais litiga hoje. Vazio quando ninguém
       * aparece três vezes — e aí a tela não desenha o bloco.
       */
      adversarios,
      /** Nulo para quem não vê a escala — o corte é aqui, não na tela. */
      equipeHoje: veEscalas ? { plantaoHoje, proximoPlantao } : null,
      /**
       * Saúde do robô do DataJud. Existe porque a ausência de alerta era
       * ambígua: "0 audiências a agendar" tanto podia significar que não havia
       * nada quanto que a varredura noturna não rodou.
       *
       * `situacao` substituiu o booleano `atrasado`. O booleano só sabia
       * responder "faz tempo que não roda?", e respondia SIM numa base sem
       * processo nenhum — a home de produção abria com um alarme vermelho
       * dizendo que a sincronização estava parada, quando não havia nada a
       * sincronizar. Um estado não é um problema só por ser diferente do
       * ideal; virar alarme depende de haver trabalho pendente.
       */
      robo: this.situacaoRobo(ultimaSync, falhasSync, desconhecidosNoCnj, processosMonitorados, agora),
      /**
       * AS FONTES EXTERNAS ESTÃO DE PÉ?
       *
       * Só para quem coordena: é a única pessoa que faz alguma coisa com a
       * resposta. Ver `saudeDasFontes` para por que isto não se confunde com
       * `robo` nem com `djen`.
       */
      integracoes: ehGestao ? saudeSincronizacao : null,
      graficos: {
        atendimentosPorCanal: canalGroup.map((c) => ({ canal: c.canal, total: c._count._all })),
        atendimentos14dias: this.bucketDiario(atendimentos14Raw.map((a) => a.createdAt), 14),
        crescimentoFiliados: this.agruparPorMes(crescimentoRaw.map((f) => f.dataFiliacao!).filter(Boolean)),
        /** Entradas × saídas × saldo, 6 meses — inclui meses zerados. */
        movimentacaoQuadro: this.movimentacaoQuadro(
          crescimentoRaw.map((f) => f.dataFiliacao!).filter(Boolean),
          saidasRaw.map((f) => f.desfiliadoEm!).filter(Boolean),
          6,
        ),
        /**
         * Quantos ficaram de fora da série por não terem data de filiação
         * (vieram da carga sem a informação). A tela mostra o número em vez de
         * deixar o gráfico parecer completo quando não está.
         */
        filiadosSemDataFiliacao,
      },
    };
  }

  // =========================================================================
  // Endpoints legados (mantidos p/ compatibilidade)
  // =========================================================================

  async indicadores() {
    // O mês começa à meia-noite DAQUI. `setHours(0)` no contêiner, que roda em
    // UTC, é 21h do último dia do mês anterior — e "novos no mês" levava junto
    // quem se filiou na virada.
    const inicioMes = inicioDoMesBR();

    const [
      filiadosTotal,
      filiadosAtivos,
      filiadosInativos,
      filiadosNovosMes,
      conjuges,
      filhos,
      colaboradoresTotal,
      eventosRealizados,
      eventosAgendados,
      totalPresencas,
    ] = await this.prisma.$transaction([
      this.prisma.filiado.count(),
      this.prisma.filiado.count({ where: { situacao: SituacaoFiliado.ATIVO } }),
      this.prisma.filiado.count({ where: { situacao: SituacaoFiliado.INATIVO } }),
      this.prisma.filiado.count({ where: { createdAt: { gte: inicioMes } } }),
      // `filiadoId: { not: null }` porque o dependente agora pode ser da EQUIPE
      // do sindicato (ver o model `Dependente`). O bloco "dependentes" deste
      // painel fica logo abaixo de "filiados" e é lido como a família da BASE —
      // somar a família dos funcionários ali inflaria o número que o sindicato
      // usa para negociar convênio.
      this.prisma.dependente.count({
        where: { tipo: TipoDependente.CONJUGE, filiadoId: { not: null } },
      }),
      this.prisma.dependente.count({
        where: { tipo: TipoDependente.FILHO, filiadoId: { not: null } },
      }),
      // Uma contagem só: funcionários e prestadores viraram Colaborador.
      this.prisma.colaborador.count({ where: { status: StatusColaborador.ATIVO } }),
      this.prisma.evento.count({ where: { status: StatusEvento.REALIZADO } }),
      this.prisma.evento.count({ where: { status: StatusEvento.AGENDADO } }),
      this.prisma.presenca.count(),
    ]);

    return {
      filiados: {
        total: filiadosTotal,
        ativos: filiadosAtivos,
        inativos: filiadosInativos,
        novosNoMes: filiadosNovosMes,
      },
      dependentes: { total: conjuges + filhos, conjuges, filhos },
      colaboradores: { total: colaboradoresTotal },
      eventos: { realizados: eventosRealizados, agendados: eventosAgendados },
      presencas: { total: totalPresencas },
    };
  }

  async crescimentoFiliados() {
    const filiados = await this.prisma.filiado.findMany({
      where: { createdAt: { gte: this.seisMesesAtras() } },
      select: { createdAt: true },
    });
    return this.agruparPorMes(filiados.map((f) => f.createdAt));
  }

  async presencasPorEvento() {
    const eventos = await this.prisma.evento.findMany({
      orderBy: { dataInicio: 'desc' },
      take: 10,
      include: { _count: { select: { presencas: true } } },
    });
    return eventos.map((e) => ({ evento: e.nome, presencas: e._count.presencas }));
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  /**
   * Traduz o estado do robô do DataJud em UMA situação nomeada, para que a
   * tela não precise deduzir gravidade a partir de datas soltas.
   *
   * A ordem das perguntas é o que importa aqui — a primeira é "existe
   * trabalho?", não "faz quanto tempo que rodou?". Sem processo monitorado o
   * robô está ocioso, não parado, e ocioso não merece alerta nenhum.
   *
   *   SEM_OBJETO   nada monitorado — o robô não tem o que varrer
   *   PRIMEIRA     há processos, a primeira varredura ainda não aconteceu
   *   EM_DIA       varreu nas últimas 36h (o cron é diário, às 2h)
   *   ATRASADO     já varreu antes e parou — 36h a 3 dias
   *   PARADO       parado há mais de 3 dias: aí sim algo está errado
   */
  /**
   * SITUAÇÃO DO DJEN — a mesma pergunta que o robô do DataJud responde.
   *
   * A ordem das perguntas importa, e a primeira NÃO é "faz quanto tempo?":
   *
   *   DESLIGADA   a integração está off — não é falha, é escolha
   *   PRIMEIRA    ligada, nunca trouxe nada: ou acabou de ligar, ou está muda
   *   EM_DIA      trouxe publicação nas últimas 48h
   *   SILENCIOSA  já trouxe antes e parou há mais de 48h
   *
   * SILENCIOSA não é necessariamente erro — fim de semana e recesso existem, e
   * o Judiciário não publica. Por isso o rótulo é "silenciosa" e não "parada":
   * o painel informa, quem lê decide se estranha.
   */
  private situacaoDjen(
    ativa: boolean,
    linksDaSemana: { link: string | null }[],
    ultimaEm: Date | null,
    recentesBrutas: PublicacaoBruta[],
    agora: Date,
    escopo: 'GLOBAL' | 'PESSOAL',
    idDoSindicato: string | null,
    /** Ids das publicações que NOMEIAM quem está olhando (só no escopo pessoal). */
    idsQueMeCitam: ReadonlySet<string> = new Set(),
  ) {
    const HORA = 3_600_000;
    const horasSemNada = ultimaEm ? (agora.getTime() - ultimaEm.getTime()) / HORA : null;

    /*
      O SILÊNCIO SE MEDE EM DIAS ÚTEIS — e antes se media em horas.

      Conferido nas 1.408 publicações da produção: **nenhuma** tem data de
      disponibilização de sábado ou domingo. Segunda 339, terça 201, quarta 322,
      quinta 271, sexta 275, fim de semana ZERO. O Diário não circula.

      Com o corte em 48 HORAS, todo domingo à noite a home acusava a integração
      de silenciosa — e o texto ainda dizia, contradizendo a própria faixa,
      "fim de semana e recesso explicam silêncio curto". Foi o que o usuário viu:
      54h de silêncio que eram sexta à noite, sábado e domingo.

      Contando dia útil, esse mesmo intervalo dá ZERO e a faixa não aparece. Dois
      dias ÚTEIS sem publicação nenhuma, esse sim é estranho num acervo de 122
      processos.
    */
    const diasUteisSemNada = ultimaEm ? diasUteisEntre(ultimaEm, agora) : null;

    const situacao = !ativa
      ? 'DESLIGADA'
      : !ultimaEm
        ? 'PRIMEIRA'
        : diasUteisSemNada! < 2
          ? 'EM_DIA'
          : 'SILENCIOSA';

    /**
     * O VOLUME CONTA ATOS, NÃO CÓPIAS. Ver a consulta: o `link` é a identidade
     * do documento no tribunal, e a mesma intimação chega uma vez por
     * destinatário. Sem link (nunca aconteceu nas 136 medidas, mas o campo é
     * opcional), cada linha conta por si — é o palpite seguro.
     */
    const atos = new Set(
      linksDaSemana.map((c, i) => c.link ?? `sem-link-${i}`),
    );

    return {
      ativa,
      situacao,
      /** Dias ÚTEIS desde a última publicação — é o que a frase precisa dizer. */
      diasUteisSemNada,
      /** ATOS disponibilizados nos últimos 7 dias, já sem as cópias. */
      publicacoes7d: atos.size,
      ultimaEm,
      /** GLOBAL para gestão e triagem; PESSOAL para o advogado. */
      escopo,
      /**
       * As que pedem providência — e só elas. Ver a consulta: edital e lista de
       * distribuição chegam às dezenas e afogariam a intimação com prazo.
       */
      recentes: ativa ? this.resumirPublicacoes(recentesBrutas, idDoSindicato, idsQueMeCitam) : [],
    };
  }

  /**
   * Agrupa as cópias e resolve, para cada ato, a informação que a linha do
   * painel precisa: contra quem é, de quem é, e se já virou trabalho.
   */
  /**
   * OS IDS DAS PUBLICAÇÕES QUE NOMEIAM ESTA OAB.
   *
   * A ligação é pelo NÚMERO + UF, nunca pelo nome: o DJEN manda "ICARO SOL
   * ALMONDES SANTOS" e o cadastro tem "Ícaro Sol Almondes Santos" — casar por
   * texto perderia todo mundo com acento e ainda arriscaria homônimo. Mesma
   * chave usada para mostrar a foto do advogado na aba de Publicações.
   *
   * Recortado pela janela ANTES do `jsonb_array_elements`: sem isso a expansão
   * varreria as 1.408 publicações do acervo para responder sobre sete dias.
   */
  /**
   * Delega à regra única — ver `publicacoes-que-citam.util`. A consulta morava
   * aqui e ganhou um segundo dono (o relatório individual do advogado); duas
   * cópias discordariam no dia em que uma aprendesse algo.
   */
  private async publicacoesQueCitam(
    advogado: { oab: string | null; oabUf: string | null } | null,
    desde: Date,
  ): Promise<string[]> {
    return publicacoesQueCitam(this.prisma, advogado, { de: desde });
  }
  private resumirPublicacoes(
    brutas: PublicacaoBruta[],
    idDoSindicato: string | null,
    /** Ids que NOMEIAM quem está olhando — vazio fora do escopo pessoal. */
    idsQueMeCitam: ReadonlySet<string> = new Set(),
  ) {
    /*
      AGRUPAR POR LINK NÃO BASTA MAIS — e o painel mostrava o mesmo ato duas
      vezes por causa disso.

      O tribunal passou a emitir um código de validação POR DESTINATÁRIO, então
      as cópias de um mesmo ato chegam com links diferentes. Medido em
      08/09/2026 sobre as 1.433 publicações, entre pares do mesmo processo e
      dia: com links diferentes a mediana de semelhança é 0,973, e 262 de 303
      passam de 0,9 — são cópias. Só 34 ficam abaixo de 0,4, e essas são atos
      distintos de verdade.

      ESPELHO de `ehCopia` em `web/src/lib/publicacoes-irmas.ts`. As duas
      precisam concordar: se o painel agrupa e a aba não (ou o contrário), o
      mesmo acervo mostra dois números e ninguém sabe qual acreditar. O corte e
      a ordem das decisões são idênticos, e o comentário de lá tem a medição
      completa.
    */
    const grupos_: PublicacaoBruta[][] = [];
    for (const pub of brutas) {
      const irmao = grupos_.find((g) => ehCopiaDePublicacao(g[0], pub));
      if (irmao) irmao.push(pub);
      else grupos_.push([pub]);
    }
    const porAto = new Map<string, PublicacaoBruta[]>(
      grupos_.map((g, i) => [`g${i}`, g]),
    );

    /*
      O QUE ME INTIMA VEM PRIMEIRO.

      A ordem era só por data, e o corte em seis itens fazia o resto sumir. Um
      ato que NOMEIA o advogado — e cujo prazo, portanto, corre contra ele —
      podia cair fora da lista por causa de três publicações do acervo que
      chegaram um dia depois. Dentro de cada grupo a data continua mandando; o
      que muda é quem disputa as seis vagas.
    */
    const grupos = [...porAto.values()].sort((a, b) => {
      const citaA = a.some((p) => idsQueMeCitam.has(p.id)) ? 1 : 0;
      const citaB = b.some((p) => idsQueMeCitam.has(p.id)) ? 1 : 0;
      if (citaA !== citaB) return citaB - citaA;
      return b[0].dataDisponibilizacao.getTime() - a[0].dataDisponibilizacao.getTime();
    });

    return grupos.slice(0, 6).map((grupo) => {
      const pub = grupo[0];
      return {
        id: pub.id,
        /**
         * O ATO NOMEIA QUEM ESTÁ OLHANDO?
         *
         * `false` para todo mundo fora do escopo pessoal — no painel da gestão
         * a pergunta não faz sentido, e um selo que acende sempre não informa.
         * Quem foi intimado é quem está nomeado no ato; o vínculo do processo diz
         * outra coisa (quem responde pelo caso), e as duas divergem bastante.
         */
        meCita: grupo.some((p) => idsQueMeCitam.has(p.id)),
        tipoComunicacao: pub.tipoComunicacao,
        nomeOrgao: pub.nomeOrgao,
        providencia: pub.providencia,
        prazoMencionadoDias: pub.prazoMencionadoDias,
        dataDisponibilizacao: pub.dataDisponibilizacao,
        compromissoId: pub.compromissoId,
        /**
         * A tarefa existe E está ABERTA?
         *
         * `compromissoId` preenchido não basta: a atividade pode ter sido
         * concluída ou cancelada, e nos dois casos a publicação volta a ser
         * uma notícia sem dono. É a diferença entre "alguém está cuidando" e
         * "isto pediu algo e ninguém pegou".
         */
        temTarefaAberta:
          pub.compromisso?.status === 'PENDENTE' || pub.compromisso?.status === 'EM_ANDAMENTO',
        /**
         * NUNCA VIROU TAREFA — e isso é diferente de "a tarefa fechou".
         *
         * Concluída quer dizer que alguém fez. Cancelada quer dizer que alguém
         * decidiu que não era para fazer, e a decisão está registrada com
         * motivo. Nos dois casos houve trabalho humano, e marcar a linha como
         * "sem tarefa" seria apagar essa decisão. O risco de verdade é o ato
         * que pediu algo e nunca chegou a virar nada.
         */
        semTarefa: pub.compromissoId === null,
        /** Quantos destinatários receberam a MESMA comunicação. */
        copias: grupo.length,
        processo: pub.processo && {
          id: pub.processo.id,
          numeroCNJ: pub.processo.numeroCNJ,
          adversario: adversarioDoProcesso(pub.processo.partes, idDoSindicato),
          /** Só quando NÃO somos nós — ver `autorQueInforma`. */
          autor: autorQueInforma(pub.processo.partes, idDoSindicato),
          nossoPolo: nossoPolo(pub.processo.partes, idDoSindicato),
          advogado: pub.processo.advogado,
        },
      };
    });
  }

  /**
   * QUANTAS HORAS SEM LEITURA até um processo estar de fato ATRASADO.
   *
   * A varredura roda uma vez por dia. Perder UMA rodada é rotina do CNJ — o
   * próprio índice público oscila. Perder DUAS já é outra coisa, e aí vale
   * chamar alguém.
   */
  private static readonly HORAS_ATE_ATRASO = 48;

  private situacaoRobo(
    ultimaSync: { createdAt: Date; sucesso: boolean } | null,
    falhas: FalhaDatajud[],
    desconhecidos: ProcessoDesconhecidoNoCnj[],
    processosMonitorados: number,
    agora: Date,
  ) {
    const HORA = 3_600_000;
    const horasParadas = ultimaSync
      ? (agora.getTime() - ultimaSync.createdAt.getTime()) / HORA
      : null;

    const situacao =
      processosMonitorados === 0 ? 'SEM_OBJETO'
        : !ultimaSync ? 'PRIMEIRA'
          : horasParadas! <= 36 ? 'EM_DIA'
            : horasParadas! <= 72 ? 'ATRASADO'
              : 'PARADO';

    // Falha só é notícia se houve varredura para falhar.
    const lista = situacao === 'SEM_OBJETO' ? [] : falhas;

    /*
      "TENTATIVA QUE FALHOU" NÃO É "PROCESSO DESATUALIZADO".

      A faixa dizia "a varredura não conseguiu atualizar 6 processos" e listava
      seis com cor de alerta. Medido na produção em 05/09/2026: eram OITO
      timeouts de exatos 45s, todos da MESMA rodada, todos entre a 82ª e a 106ª
      consulta — e nas nove noites anteriores houve ZERO. Não é defeito de seis
      processos; é a rodada degradando no fim, provavelmente cota ou latência do
      CNJ.

      E o mais importante: os seis tinham sido lidos com sucesso de 33 a 37
      horas antes, sem nada novo. Nenhum estava desatualizado. Foi o que o
      usuário percebeu olhando a tela — "há processos atualizados que passaram
      nessa lista".

      Então a pergunta muda: não é "alguma tentativa falhou?", é "algum processo
      está sem leitura há tempo demais?". Só esses pedem ação.
    */
    const limite = agora.getTime() - DashboardService.HORAS_ATE_ATRASO * HORA;
    const atrasados = lista.filter(
      (f) => !f.ultimoSucesso || f.ultimoSucesso.getTime() < limite,
    );

    return {
      situacao,
      processosMonitorados,
      ultimaSincronizacao: ultimaSync?.createdAt ?? null,
      ultimaComSucesso: ultimaSync?.sucesso ?? null,
      falhas24h: lista.length,
      /** Destes, quantos estão de fato sem leitura há mais de 48h. */
      atrasados24h: atrasados.length,
      horasAteAtraso: DashboardService.HORAS_ATE_ATRASO,
      /**
       * QUAIS processos o CNJ recusou. O número sozinho não era acionável: a
       * barra dizia "2 processos" e mandava para a lista inteira, onde nada
       * distinguia os dois do resto. Com a lista, o aviso vira trabalho —
       * cada item abre o processo que falhou.
       */
      falhasProcessos: lista,
      /**
       * NPUs QUE O CNJ NÃO CONHECE — lista própria, porque não é falha do robô.
       * A consulta funciona; o índice é que não tem o processo. Ficava invisível
       * (gravado como sucesso) enquanto o robô perguntava 151 vezes em 7 dias.
       */
      desconhecidosNoCnj: situacao === 'SEM_OBJETO' ? [] : desconhecidos,
    };
  }

  /**
   * Processos JÁ CADASTRADOS cuja última tentativa de sincronização com o
   * DataJud, nas últimas 24h, terminou em erro.
   *
   * Três decisões importam aqui:
   *
   * 1. `origem <> IMPORTACAO` — e esta é a correção principal. A contagem
   *    antiga somava TODA linha de log com `sucesso = false`, inclusive a da
   *    importação, que é outra coisa completamente: alguém digitou um NPU no
   *    "Importar Processo" e o CNJ não achou. O processo NUNCA foi cadastrado.
   *    O painel então anunciava "o CNJ recusou a consulta de 2 processos" e
   *    mandava para a lista de processos — onde, evidentemente, não havia o
   *    que ver, porque aqueles dois nunca entraram no sistema. O erro de
   *    importação já é mostrado na hora, dentro do próprio diálogo; repeti-lo
   *    na home 12 horas depois, fantasiado de falha do robô, era só ruído.
   *    Sobram CRON (a varredura noturna) e MANUAL (o botão "Sincronizar" na
   *    ficha): as duas falam de processos que existem e têm ficha para abrir.
   *
   * 2. É a última tentativa por processo, não toda falha. Contar linhas de log
   *    inflava o aviso — o mesmo processo tentado três vezes virava "3
   *    processos" — e mantinha no alerta quem já tinha sincronizado depois,
   *    na re-sincronização manual. `DISTINCT ON` resolve os dois: pega a
   *    tentativa mais recente de cada processo e só reporta as que falharam.
   *
   * 3. A chave é `COALESCE(processo_id, numero_cnj)`. O log sobrevive à
   *    exclusão do processo (`onDelete: SetNull`), e nesse caso o NPU é a
   *    única identidade que resta — sem o COALESCE, todos os órfãos
   *    colapsariam num único NULL.
   *
   * 4. `fonte = 'DATAJUD'` — desde que o DJEN passou a gravar na mesma tabela,
   *    sem este filtro uma indisponibilidade do Comunica PJe apareceria no
   *    painel como "o CNJ recusou a consulta", que é outro sistema e outra
   *    providência. O DJEN tem contador próprio.
   *
   * 6. Sem a LINHA DE RESUMO DA RODADA (`SO_CHAMADAS_AO_TRIBUNAL`). Desde
   *    13/09/2026 cada rodada grava uma linha com processo e NPU nulos; o
   *    `COALESCE` acima juntaria todas sob NULL, e uma rodada interrompida
   *    viraria "processo com falha" sem processo nem número.
   */
  private falhasDatajud24h(desde: Date) {
    return this.prisma.$queryRaw<FalhaDatajud[]>`
      WITH ultima AS (
        SELECT DISTINCT ON (COALESCE(l.processo_id, l.numero_cnj))
               l.processo_id, l.numero_cnj, l.tribunal, l.sucesso,
               l.http_status, l.mensagem_erro, l.created_at, l.duracao_ms
          FROM logs_sincronizacao_datajud l
         WHERE l.created_at >= ${desde}
           AND l.fonte = 'DATAJUD'
           AND l.origem <> 'IMPORTACAO'::"OrigemSincronizacao"
           AND ${SO_CHAMADAS_AO_TRIBUNAL}
         ORDER BY COALESCE(l.processo_id, l.numero_cnj), l.created_at DESC
      )
      SELECT u.processo_id   AS "processoId",
             u.numero_cnj    AS "numeroCNJ",
             u.tribunal      AS "tribunal",
             u.http_status   AS "httpStatus",
             u.mensagem_erro AS "mensagemErro",
             u.created_at    AS "createdAt",
             u.duracao_ms    AS "duracaoMs",
             f.nome_completo AS "filiado",
             /*
               5. A ÚLTIMA LEITURA BEM-SUCEDIDA, sem recorte de tempo.

               Sem ela não dá para distinguir "o CNJ engasgou numa tentativa" de
               "este processo está sem leitura há uma semana" — e a faixa
               tratava os dois como a mesma coisa, com a mesma cor.
             */
             (SELECT max(s.created_at)
                FROM logs_sincronizacao_datajud s
               WHERE s.fonte = 'DATAJUD'
                 AND s.sucesso = true
                 AND (s.processo_id = u.processo_id
                      OR (u.processo_id IS NULL AND s.numero_cnj = u.numero_cnj))
             ) AS "ultimoSucesso"
        FROM ultima u
        LEFT JOIN processos p ON p.id = u.processo_id
        LEFT JOIN filiados  f ON f.id = p.filiado_id
       WHERE u.sucesso = false
       ORDER BY u.created_at DESC
       LIMIT 25
    `;
  }

  /**
   * OS NPUs QUE O CNJ NÃO CONHECE — e que o robô pergunta todo dia.
   *
   * Este caso é gravado como SUCESSO: a consulta funcionou, o índice é que não
   * tem o processo. Por isso ele nunca apareceu em lugar nenhum, e o robô seguiu
   * perguntando — um único NPU consumiu **151 consultas em 7 dias** na produção.
   *
   * NÃO É FALHA DO ROBÔ, e por isso não entra na mesma lista: é um dado da casa
   * para conferir. Processo recém-distribuído leva dias para ser indexado (e aí
   * some daqui sozinho); NPU digitado errado fica aqui para sempre. O corte de
   * 3 dias separa um do outro.
   */
  private processosDesconhecidosNoCnj(desde: Date) {
    return this.prisma.$queryRaw<ProcessoDesconhecidoNoCnj[]>`
      WITH nao_achados AS (
        SELECT l.processo_id, l.numero_cnj, max(l.tribunal) AS tribunal,
               count(*)::int AS tentativas,
               min(l.created_at) AS desde, max(l.created_at) AS ultima
          FROM logs_sincronizacao_datajud l
         WHERE l.fonte = 'DATAJUD'
           AND l.sucesso = true
           AND l.mensagem_erro ILIKE '%localizado no índice%'
           AND l.created_at >= ${desde}
         GROUP BY l.processo_id, l.numero_cnj
      )
      SELECT n.processo_id AS "processoId",
             n.numero_cnj  AS "numeroCNJ",
             n.tribunal,
             f.nome_completo AS "filiado",
             n.tentativas,
             n.desde,
             n.ultima
        FROM nao_achados n
        LEFT JOIN processos p ON p.id = n.processo_id
        LEFT JOIN filiados  f ON f.id = p.filiado_id
       /*
         SÓ O QUE JÁ DUROU. Um processo distribuído ontem ainda não está no
         índice, e avisar sobre ele seria acusar o tribunal de um atraso que é
         normal. Depois de três dias insistindo, a hipótese muda de lado.
       */
       WHERE n.desde <= now() - interval '3 days'
       ORDER BY n.tentativas DESC
       LIMIT 10
    `;
  }

  private seisMesesAtras(): Date {
    return inicioDoMesBR(new Date(), 5);
  }

  /** Agrupa datas por mês (YYYY-MM) para o gráfico de área. */
  private agruparPorMes(datas: Date[]): { mes: string; total: number }[] {
    const mapa = new Map<string, number>();
    for (const d of datas) {
      // `getMonth()` responde no fuso do processo: um cadastro das 22h do dia 31
      // caía no mês seguinte no ar e no mês certo aqui.
      const chave = mesBR(d);
      mapa.set(chave, (mapa.get(chave) ?? 0) + 1);
    }
    return Array.from(mapa, ([mes, total]) => ({ mes, total })).sort((a, b) => a.mes.localeCompare(b.mes));
  }

  /**
   * ANIVERSARIANTES DE HOJE — filiados e colaboradores na mesma lista.
   *
   * Precisa de SQL cru: comparar mês/dia exige `EXTRACT`, e o Prisma não expõe
   * função em `where`. As duas consultas são baratas (índice não ajuda numa
   * comparação de função, mas o filtro é sobre uma coluna pequena e o resultado
   * é de dezenas de linhas por dia).
   *
   * O dia é o de BRASÍLIA. As datas de nascimento são gravadas como meia-noite
   * de Brasília (03:00Z) ou, no legado, meia-noite UTC — em ambos os casos o
   * dia em UTC é o dia certo, então `EXTRACT` direto da coluna funciona para as
   * duas convenções (ver common/utils/datas.util.ts).
   */
  /**
   * QUEM PASSOU POR AQUI E ESTÁ COM A FICHA PELA METADE.
   *
   * A fila do balcão, e ela tem um recorte que não é óbvio. Medido em
   * 04/09/2026: dos 7.291 filiados, **7.137 não têm telefone** e 5.028 não têm
   * CPF. Uma lista com sete mil nomes não é fila de trabalho — é um relatório
   * de dívida que ninguém abre duas vezes.
   *
   * O RECORTE É "ESTÁ EM JOGO": quem teve atendimento nos últimos 60 dias, ou
   * é parte de um processo. São pessoas com quem o sindicato acabou de falar —
   * o telefone está no histórico da conversa, ou a pessoa atende se ligarem. Na
   * produção isso dá NOVE, das quais cinco com dado faltando. Nove é uma fila;
   * sete mil é um muro.
   *
   * O TOTAL VAI JUNTO — agora de verdade. Este comentário prometia um total e
   * a resposta nunca o trouxe: com 30 na fila, o cartão mostrava "12" como se
   * fosse tudo. `count(*) OVER ()` conta sob o MESMO filtro, antes do LIMIT, e
   * por isso lista e total não discordam. Medido em 12–13/09/2026: fila real de
   * 16.
   *
   * TELEFONE considera o secundário (a importação põe o "celular" lá: 383 fichas
   * ativas só têm número nesse campo), e cada linha diz o ESTADO do link de
   * recadastramento: ativo até quando, ou quando o filiado respondeu por ele.
   * Nunca "enviado" — o sistema não sabe se a mensagem saiu. A regra da linha
   * está em `itemDoCadastroACompletar`.
   */
  private async cadastrosACompletar(agora: Date) {
    const linhas = await this.prisma.$queryRaw<(LinhaDoCadastroACompletar & { total: bigint })[]>`
      SELECT f.id,
             f.nome_completo        AS nome,
             f.telefone_principal   AS telefone,
             f.telefone_secundario  AS "telefoneSecundario",
             f.cpf,
             f.data_nascimento      AS nascimento,
             CASE WHEN EXISTS (SELECT 1 FROM atendimentos a
                                WHERE a.filiado_id = f.id
                                  AND a.created_at > now() - interval '60 days')
                  THEN 'ATENDIMENTO' ELSE 'PROCESSO' END AS motivo,
             l.ativo_ate            AS "linkAtivoAte",
             l.respondeu_em         AS "respondeuPeloLinkEm",
             count(*) OVER ()       AS total
        FROM filiados f
        LEFT JOIN LATERAL (
          SELECT max(lr.expira_em) FILTER (WHERE lr.usado_em IS NULL
                                             AND lr.revogado_em IS NULL
                                             AND lr.expira_em > ${agora}) AS ativo_ate,
                 max(lr.usado_em) AS respondeu_em
            FROM links_recadastramento lr
           WHERE lr.filiado_id = f.id
        ) l ON true
       WHERE f.situacao = 'ATIVO'
         AND ((coalesce(btrim(f.telefone_principal), '') = ''
               AND coalesce(btrim(f.telefone_secundario), '') = '')
           OR coalesce(btrim(f.cpf), '') = ''
           OR f.data_nascimento IS NULL)
         AND (EXISTS (SELECT 1 FROM atendimentos a
                       WHERE a.filiado_id = f.id
                         AND a.created_at > now() - interval '60 days')
           OR EXISTS (SELECT 1 FROM partes_processo pp WHERE pp.filiado_id = f.id)
           OR EXISTS (SELECT 1 FROM processos pr WHERE pr.filiado_id = f.id))
       ORDER BY f.nome_completo
       LIMIT 12
    `;

    return {
      itens: linhas.map((l) => itemDoCadastroACompletar(l, agora)),
      total: linhas.length ? Number(linhas[0].total) : 0,
    };
  }

  /**
   * AS FONTES EXTERNAS ESTÃO DE PÉ? — e por que isto não é o `robo` nem o `djen`.
   *
   * `robo` responde "a varredura do DataJud rodou?"; `djen` responde "chegou
   * publicação nova?". Nenhum dos dois responde "a integração está QUEBRADA?",
   * e a diferença não é acadêmica: quando a ponte do DJEN caiu, o painel disse
   * SILENCIOSA — que se lê como semana parada, não como integração morta. Foram
   * semanas assim.
   *
   * A LEITURA SAI DO LOG DE CHAMADAS, que é o único lugar que sabe se a
   * requisição saiu e o que voltou:
   *
   *  - PARADA:   nenhuma chamada com sucesso nas últimas 48h. Os dois robôs
   *              rodam TODA madrugada, então 48h já perdoa uma noite inteira
   *              perdida — e duas noites em silêncio não é folga, é defeito.
   *  - INSTAVEL: houve sucesso recente, mas mais de um quinto das chamadas das
   *              últimas 24h falhou. O corte é alto de propósito: medido em
   *              7 dias, a taxa normal do DataJud é de 0,24% (2 falhas em 821),
   *              então 20% está ordens de grandeza acima do ruído e não vai
   *              acender por causa de um 429 isolado.
   *  - OK:       o resto.
   *
   * SEM CHAMADA NENHUMA NÃO É FALHA: uma instalação que nunca ligou a
   * integração devolve `SEM_USO`, e a tela não mostra nada. Alarme sobre
   * função desligada é o jeito mais rápido de ensinar a equipe a ignorar
   * alarme.
   *
   * SÓ CHAMADAS. A linha de resumo da rodada do DataJud (13/09/2026) não é
   * requisição ao tribunal e fica fora de todas as contas — ver
   * `SO_CHAMADAS_AO_TRIBUNAL`. Sem o corte, cada noite somaria uma "chamada"
   * que não existiu, e uma rodada interrompida pesaria como consulta recusada.
   */
  private async saudeDasFontes(agora: Date) {
    const desde24h = new Date(agora.getTime() - 24 * 3_600_000);

    const linhas = await this.prisma.$queryRaw<
      {
        fonte: string;
        ok24: bigint;
        falhas24: bigint;
        ultimo_sucesso: Date | null;
        ultima_falha: Date | null;
        ultimo_erro: string | null;
        ultima_rodada_ok: Date | null;
      }[]
    >`
      SELECT fonte,
             count(*) FILTER (WHERE sucesso     AND created_at > ${desde24h}) AS ok24,
             count(*) FILTER (WHERE NOT sucesso AND created_at > ${desde24h}) AS falhas24,
             max(created_at) FILTER (WHERE sucesso)     AS ultimo_sucesso,
             max(created_at) FILTER (WHERE NOT sucesso) AS ultima_falha,
             (array_agg(mensagem_erro ORDER BY created_at DESC)
                FILTER (WHERE NOT sucesso))[1]          AS ultimo_erro,
             CASE WHEN fonte = 'DATAJUD' THEN (
               SELECT max(r.created_at)
                 FROM logs_sincronizacao_datajud r
                WHERE r.fonte = 'DATAJUD'
                  AND r.processo_id IS NULL
                  AND r.numero_cnj IS NULL
                  AND r.sucesso
                  AND r.mensagem_erro LIKE ${`${PREFIXO_RODADA_SEM_ALVO}%`}
             ) END                                      AS ultima_rodada_ok
        FROM logs_sincronizacao_datajud
       WHERE ${SO_CHAMADAS_AO_TRIBUNAL}
       GROUP BY fonte
    `;

    return linhas.map((l) => {
      const ok24 = Number(l.ok24);
      const falhas24 = Number(l.falhas24);
      const chamadas24 = ok24 + falhas24;
      /*
        RODOU SEM NADA A CONSULTAR NÃO É "NÃO RODOU" (revisão de 13/09/2026).

        Sem processo ATIVO/PENDENTE com NPU, a varredura grava toda madrugada só
        a linha de resumo "Rodada sem alvo", com sucesso, e nenhuma chamada. As
        contas acima a cortam (e devem: não é chamada ao tribunal), então sobrava
        o último sucesso antigo com zero chamadas, e a gestão lia todo dia "a
        busca automática não executou" enquanto `robo` dizia SEM_OBJETO. A linha
        de resumo que deu certo vem à parte, só para responder "rodou?", pela
        mesma régua de dois dias úteis.
      */
      const rodouSemAlvo =
        !!l.ultima_rodada_ok && diasUteisEntre(l.ultima_rodada_ok, agora) < 2;

      /*
        O ATRASO SE MEDE EM DIAS ÚTEIS — e antes bastavam 24 horas sem chamada.

        Com uma varredura DIÁRIA, "24h sem consulta" dispara em qualquer soluço:
        um domingo, um feriado, uma rodada que atrasou. Foi o que o usuário viu
        numa segunda às 00h46 — faixa vermelha porque a última busca tinha sido
        sexta às 16h35. Um dia útil. Nada tinha se perdido: o Diário não circula
        no fim de semana e a edição de segunda ainda nem existia.

        Dois dias ÚTEIS é outra coisa: aí há uma edição inteira que não entrou.
      */
      const diasUteisSemSucesso = l.ultimo_sucesso
        ? diasUteisEntre(l.ultimo_sucesso, agora)
        : null;
      const atrasado = diasUteisSemSucesso === null || diasUteisSemSucesso >= 2;

      /*
        "NÃO RODOU" NÃO É "FALHOU" — e a tela dizia a segunda coisa.

        A faixa anunciava "DJEN sem nenhuma consulta bem-sucedida desde … —
        dois dias em silêncio é defeito", em vermelho, num domingo à noite. As
        duas frases estavam erradas: não houve consulta NENHUMA (nem falha), e
        o silêncio era sábado e domingo.

        Quem lê "consulta mal-sucedida" vai atrás do CNJ, da ponte, do
        certificado. Quem lê "o robô não rodou" vai atrás do agendador. São
        investigações diferentes, e o dado para separá-las sempre esteve aqui:
        `chamadas24 === 0` com sucesso antigo significa que ninguém tentou.
      */
      /*
        A ORDEM DAS PERGUNTAS.

        1. Nunca usada → SEM_USO (não é falha, é escolha; a tela não mostra nada).
        2. Em dia (menos de 2 dias úteis desde o último sucesso) → só resta saber
           se está INSTÁVEL. Antes esta pergunta vinha por último, e por isso um
           fim de semana virava PARADA antes de qualquer coisa.
        3. Atrasada e ninguém tentou → NAO_RODOU (agendador).
        4. Atrasada e as tentativas falharam → PARADA (CNJ, ponte, certificado).
      */
      const situacao = !l.ultimo_sucesso && chamadas24 === 0
        ? 'SEM_USO'
        : !atrasado
          ? (chamadas24 > 0 && falhas24 / chamadas24 > 0.2 ? 'INSTAVEL' : 'OK')
          : chamadas24 === 0 && rodouSemAlvo
            ? 'SEM_USO'
            : chamadas24 === 0
              ? 'NAO_RODOU'
              : 'PARADA';

      return {
        fonte: l.fonte,
        situacao,
        ok24,
        falhas24,
        ultimoSucesso: l.ultimo_sucesso,
        /** Dias ÚTEIS desde a última chamada que voltou — o critério do atraso. */
        diasUteisSemSucesso,
        ultimaFalha: l.ultima_falha,
        /** A mensagem crua da última falha — é o que se cola num chamado. */
        ultimoErro: l.ultimo_erro,
      };
    });
  }

  private async aniversariantesDeHoje(agora: Date) {
    const br = new Date(agora.getTime() - OFFSET_BR);
    const mes = br.getUTCMonth() + 1;
    const dia = br.getUTCDate();

    /*
      O SECUNDÁRIO VAI JUNTO para o botão de parabéns achar o celular pela mesma
      régua do envio do link (principal OU secundário): a importação grava o
      "celular" da planilha no secundário. A equipe (colaboradores) tem um
      telefone só.
    */
    const [filiados, colaboradores] = await Promise.all([
      this.prisma.$queryRaw<
        { id: string; nome: string; telefone: string | null; telefoneSecundario: string | null; nascimento: Date }[]
      >`
        SELECT id, nome_completo AS nome, telefone_principal AS telefone,
               telefone_secundario AS "telefoneSecundario", data_nascimento AS nascimento
          FROM filiados
         WHERE data_nascimento IS NOT NULL
           AND EXTRACT(MONTH FROM data_nascimento) = ${mes}
           AND EXTRACT(DAY   FROM data_nascimento) = ${dia}
           AND situacao = 'ATIVO'
         ORDER BY nome_completo
         LIMIT 30
      `,
      this.prisma.$queryRaw<
        { id: string; nome: string; telefone: string | null; telefoneSecundario: string | null; nascimento: Date }[]
      >`
        SELECT id, nome, telefone, NULL::text AS "telefoneSecundario", data_nascimento AS nascimento
          FROM colaboradores
         WHERE data_nascimento IS NOT NULL
           AND EXTRACT(MONTH FROM data_nascimento) = ${mes}
           AND EXTRACT(DAY   FROM data_nascimento) = ${dia}
           AND status <> 'DESLIGADO'
         ORDER BY nome
         LIMIT 30
      `,
    ]);

    /** Idade que a pessoa completa hoje. */
    const idade = (n: Date) => br.getUTCFullYear() - new Date(n).getUTCFullYear();

    return [
      ...filiados.map((f) => ({ ...f, tipo: 'FILIADO' as const, idade: idade(f.nascimento) })),
      ...colaboradores.map((c) => ({ ...c, tipo: 'COLABORADOR' as const, idade: idade(c.nascimento) })),
    ].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }

  /**
   * TEMPO MÉDIO DE RESOLUÇÃO da triagem, nos últimos 30 dias.
   *
   * Mede da abertura (`createdAt`) até o registro do desfecho (`desfechoEm`).
   * Só entra o que foi RESOLVIDO no período — incluir o que ainda está aberto
   * puxaria a média para baixo e esconderia justamente a demanda que trava.
   *
   * Devolve `null` quando não houve resolução no período: exibir "0h" seria
   * mentir sobre uma amostra que não existe.
   */
  private async tempoMedioTriagem(agora: Date) {
    const desde = new Date(agora.getTime() - 30 * DIA_MS);
    const resolvidos = await this.prisma.atendimento.findMany({
      where: { desfechoEm: { gte: desde, lte: agora } },
      select: { createdAt: true, desfechoEm: true },
    });
    if (!resolvidos.length) return { horas: null, amostra: 0 };

    const somaMs = resolvidos.reduce(
      (s, a) => s + (a.desfechoEm!.getTime() - a.createdAt.getTime()),
      0,
    );
    return {
      horas: Math.round((somaMs / resolvidos.length / 3_600_000) * 10) / 10,
      amostra: resolvidos.length,
    };
  }

  /**
   * Movimentação do quadro associativo mês a mês: entradas × saídas × saldo.
   *
   * Os meses SEM movimento entram zerados de propósito — um gráfico que pula de
   * março para junho dá a impressão de que nada aconteceu no meio, quando na
   * verdade a resposta é "zero", que é uma informação diferente.
   */
  private movimentacaoQuadro(
    entradas: Date[],
    saidas: Date[],
    meses: number,
  ): { mes: string; entradas: number; saidas: number; saldo: number }[] {
    const chave = (d: Date) => {
      const br = new Date(d.getTime() - OFFSET_BR);
      return `${br.getUTCFullYear()}-${String(br.getUTCMonth() + 1).padStart(2, '0')}`;
    };
    const contar = (l: Date[]) => {
      const m = new Map<string, number>();
      for (const d of l) m.set(chave(d), (m.get(chave(d)) ?? 0) + 1);
      return m;
    };
    const mapaE = contar(entradas);
    const mapaS = contar(saidas);

    const hoje = new Date(Date.now() - OFFSET_BR);
    const linhas: { mes: string; entradas: number; saidas: number; saldo: number }[] = [];
    for (let i = meses - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - i, 1));
      const k = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      const e = mapaE.get(k) ?? 0;
      const s = mapaS.get(k) ?? 0;
      linhas.push({ mes: k, entradas: e, saidas: s, saldo: e - s });
    }
    return linhas;
  }

  /** Volume diário dos últimos `dias`, rotulado dd/MM (fuso de Brasília). */
  private bucketDiario(datas: Date[], dias: number): { dia: string; total: number }[] {
    const hoje = dateOnlyBR(new Date()).getTime();
    const mapa = new Map<number, number>();
    for (let i = dias - 1; i >= 0; i--) mapa.set(hoje - i * DIA_MS, 0);
    for (const d of datas) {
      const k = dateOnlyBR(d).getTime();
      if (mapa.has(k)) mapa.set(k, (mapa.get(k) ?? 0) + 1);
    }
    return Array.from(mapa, ([k, total]) => {
      const dt = new Date(k);
      const dia = `${String(dt.getUTCDate()).padStart(2, '0')}/${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
      return { dia, total };
    });
  }
}

@ApiTags('dashboard')
@ApiBearerAuth()
@ModuloTenant('dashboard')
@Modulo('dashboard')
@Controller('dashboard')
class DashboardController {
  constructor(private readonly service: DashboardService) {}

  /** Home consolidada e personalizada pela role do usuário logado. */
  @Get('resumo')
  resumo(@CurrentUser() user: AuthUser) {
    return this.service.resumo(user);
  }

  @Get('indicadores') indicadores() {
    return this.service.indicadores();
  }
  @Get('crescimento-filiados') crescimento() {
    return this.service.crescimentoFiliados();
  }
  @Get('presencas-por-evento') presencasPorEvento() {
    return this.service.presencasPorEvento();
  }
}

@Module({
  // ProcessosModule exporta o AudienciasService (radar de audiências), usado
  // no resumo da home.
  imports: [ProcessosModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}

/** Só a data, sem hora — o DJEN disponibiliza por dia. */
function diaDaPublicacao(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Jaccard sobre o conjunto de palavras, igual ao `semelhanca` da web. */
function semelhancaDeTexto(a: string, b: string): number {
  const conj = (t: string) =>
    new Set(
      (t || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toUpperCase()
        .split(/[^A-Z0-9]+/)
        .filter((w) => w.length > 2),
    );
  const A = conj(a);
  const B = conj(b);
  if (!A.size && !B.size) return 1;
  let comuns = 0;
  for (const w of A) if (B.has(w)) comuns++;
  return comuns / (A.size + B.size - comuns);
}

/**
 * Duas publicações são CÓPIAS do mesmo ato?
 *
 * Espelho de `ehCopia` em `web/src/lib/publicacoes-irmas.ts` — ver lá a
 * medição que justifica cada linha. Mesmo dia é obrigatório; link igual é
 * atalho barato; senão, o texto decide com corte de 0,9.
 */
function ehCopiaDePublicacao(a: PublicacaoBruta, b: PublicacaoBruta): boolean {
  if (diaDaPublicacao(a.dataDisponibilizacao) !== diaDaPublicacao(b.dataDisponibilizacao)) {
    return false;
  }
  if (a.link && b.link && a.link === b.link) return true;
  return semelhancaDeTexto(a.texto ?? '', b.texto ?? '') >= 0.9;
}
