import { Controller, Get, Injectable, Module } from '@nestjs/common';
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

// Slugs dos tipos de evento usados nos KPIs (correspondem aos tipos "sistema").
const TIPO_PRAZO = 'PRAZO';
const TIPO_AUDIENCIA = 'AUDIENCIA';
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
    advogado: { id: string; nome: string; nomeExibicao: string | null } | null;
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
  partes: { nome: string; polo: string; principal: boolean; parteExternaId: string | null }[],
  idDoSindicato: string | null,
): string | null {
  const nosso = partes.find((p) => ehONossoSindicato(p, idDoSindicato));

  // Em qual polo estamos? Autor na esmagadora maioria, réu em alguns — e aí o
  // adversário está do outro lado. Sem nos achar, sobra tudo.
  const candidatos = nosso ? partes.filter((p) => p.polo !== nosso.polo) : partes;
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

/** Meia-noite (instante real) do dia de `base` no fuso de Brasília. */
function inicioDoDiaBR(base: Date): Date {
  const br = new Date(base.getTime() - OFFSET_BR);
  return new Date(Date.UTC(br.getUTCFullYear(), br.getUTCMonth(), br.getUTCDate()) + OFFSET_BR);
}

/** Data-only (UTC 00:00) do dia de `base` em Brasília — casa com colunas @db.Date. */
function dateOnlyBR(base: Date): Date {
  const br = new Date(base.getTime() - OFFSET_BR);
  return new Date(Date.UTC(br.getUTCFullYear(), br.getUTCMonth(), br.getUTCDate()));
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
    const hojeIni = inicioDoDiaBR(agora);
    const hojeFim = new Date(hojeIni.getTime() + DIA_MS);
    const em7dias = new Date(agora.getTime() + 7 * DIA_MS);
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
     * Escopo pessoal do advogado: suas atividades e sua carteira. Demais perfis
     * enxergam a operação inteira.
     *
     * INCLUI O QUE ELE ACOMPANHA SEM RESPONDER. Desde que a atividade passou a
     * ter equipe, filtrar só por `responsavelId` deixaria o segundo advogado de
     * uma audiência sem ela no próprio painel — ele veria "0 audiências esta
     * semana" no dia em que tem uma. O atalho fica no OR junto com a tabela
     * pelo mesmo motivo documentado em `AgendaService.listar`.
     */
    const meu: Prisma.CompromissoWhereInput = souAdvogado
      ? { OR: [{ responsavelId: user.id }, { equipe: { some: { usuarioId: user.id } } }] }
      : {};

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
      semMovimentacaoCount,
      urgentesSemanaCount,
      // Listas
      atividadesHoje,
      audienciasSemana,
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
      processosMonitorados,
      // Qualidade do dado e painéis por perfil
      filiadosSemDataFiliacao,
      cargaPorAdvogadoRaw,
      atrasadasPorAdvogadoRaw,
      contatosHoje,
      aniversariantes,
      tempoMedioTriagem,
      // Saúde e conteúdo do robô do DJEN (publicações)
      djenPublicacoes7d,
      djenUltimaPublicacao,
      djenRecentes,
      organizacaoDoSindicato,
      adversariosRaw,
    ] = await Promise.all([
      this.prisma.processo.count({ where: { statusInterno: StatusProcesso.ATIVO } }),
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
      this.prisma.processo.count({ where: { statusInterno: { notIn: PRE_PROCESSUAIS } } }),
      this.prisma.processo.count({ where: { statusInterno: { in: PRE_PROCESSUAIS } } }),
      this.prisma.atendimento.count({ where: { status: 'PENDENTE' } }),
      this.prisma.filiado.count({ where: { situacao: SituacaoFiliado.ATIVO } }),
      this.prisma.filiado.count(),
      this.prisma.filiado.count({ where: { dataFiliacao: { gte: inicioMes, lte: agora } } }),
      this.prisma.compromisso.count({
        where: {
          ...meu,
          status: ABERTOS,
          tipo: { in: [TIPO_PRAZO, TIPO_AUDIENCIA] },
          inicio: { gte: hojeIni, lt: em7dias },
        },
      }),
      this.prisma.compromisso.count({ where: { ...meu, status: ABERTOS, inicio: { lt: agora } } }),
      this.prisma.compromisso.count({ where: { ...meu, status: ABERTOS, updatedAt: { lt: menos7dias } } }),
      this.prisma.compromisso.count({
        where: { ...meu, status: ABERTOS, urgente: true, inicio: { gte: hojeIni, lt: em7dias } },
      }),
      // Atividades de hoje
      this.prisma.compromisso.findMany({
        where: { ...meu, inicio: { gte: hojeIni, lt: hojeFim } },
        orderBy: { inicio: 'asc' },
        take: 12,
        select: compSelect,
      }),
      // Audiências da semana (próximos 7 dias)
      this.prisma.compromisso.findMany({
        where: { ...meu, tipo: TIPO_AUDIENCIA, status: ABERTOS, inicio: { gte: hojeIni, lt: em7dias } },
        orderBy: { inicio: 'asc' },
        take: 8,
        select: compSelect,
      }),
      // Pendências ativas: abertas e já vencidas (horário passou)
      this.prisma.compromisso.findMany({
        where: { ...meu, status: ABERTOS, inicio: { lt: agora } },
        orderBy: { inicio: 'asc' },
        take: 8,
        select: compSelect,
      }),
      // Atendimentos de triagem pendentes de resolução
      this.prisma.atendimento.findMany({
        where: { status: 'PENDENTE' },
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: {
          id: true,
          numero: true,
          canal: true,
          desfecho: true,
          createdAt: true,
          filiado: { select: { id: true, nomeCompleto: true } },
        },
      }),
      // Movimentações processuais recentes (DataJud, 7 dias)
      this.prisma.movimentacaoProcessual.findMany({
        where: { dataMovimento: { gte: menos7dias } },
        orderBy: { dataMovimento: 'desc' },
        take: 8,
        select: {
          id: true,
          descricao: true,
          dataMovimento: true,
          processo: { select: { id: true, numeroCNJ: true, filiado: { select: { nomeCompleto: true } } } },
        },
      }),
      // Plantão de hoje
      this.prisma.escalaAdvogado.findMany({
        where: { data: { gte: hojeData, lt: amanhaData } },
        orderBy: { horaInicio: 'asc' },
        select: {
          id: true,
          horaInicio: true,
          horaFim: true,
          advogado: { select: { id: true, nome: true, nomeExibicao: true, avatarUrl: true, avatarKey: true } },
        },
      }),
      // Próximas escalas (para "próximo plantão")
      this.prisma.escalaAdvogado.findMany({
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
      }),
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
        where: { fonte: 'DATAJUD' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, sucesso: true },
      }),
      this.falhasDatajud24h(new Date(agora.getTime() - DIA_MS)),
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

      // CARGA POR ADVOGADO — atividades em aberto de cada responsável.
      // É o que responde "quem está sobrecarregado?", pergunta da Coordenação
      // que o painel não respondia: os alertas eram sempre o total da casa.
      this.prisma.compromisso.groupBy({
        by: ['responsavelId'],
        where: { status: ABERTOS },
        _count: { _all: true },
      }),
      // Recorte das atrasadas, para separar volume de problema.
      this.prisma.compromisso.groupBy({
        by: ['responsavelId'],
        where: { status: ABERTOS, inicio: { lt: agora } },
        _count: { _all: true },
      }),

      // FILA DA TRIAGEM — tarefas de contato do dia (as que o robô cria antes
      // das audiências). Sem isto, a secretaria não tinha o próprio trabalho na
      // home: via o painel do jurídico com buracos.
      this.prisma.compromisso.findMany({
        where: { tipo: 'CONTATO', status: ABERTOS, inicio: { lt: hojeFim } },
        orderBy: { inicio: 'asc' },
        take: 8,
        select: compSelect,
      }),

      // Aniversariantes do dia — filiados e equipe na mesma lista.
      this.aniversariantesDeHoje(agora),
      // Tempo médio de resolução da triagem (30 dias).
      this.tempoMedioTriagem(agora),

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
              ...(souAdvogado ? { processo: meuAcervo } : {}),
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
              ...(souAdvogado ? { processo: meuAcervo } : {}),
            },
            orderBy: { dataDisponibilizacao: 'desc' },
            take: 40,
            select: {
              id: true, link: true, tipoComunicacao: true, nomeOrgao: true, providencia: true,
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
                    select: { nome: true, polo: true, principal: true, parteExternaId: true },
                  },
                  advogado: { select: { id: true, nome: true, nomeExibicao: true } },
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

    // "Próximo plantão": advogados da primeira data futura com escala.
    let proximoPlantao: { data: Date; advogados: typeof proximasEscalas[number]['advogado'][] } | null = null;
    if (proximasEscalas.length) {
      const primeira = dateOnlyBR(proximasEscalas[0].data).getTime();
      const doDia = proximasEscalas.filter((e) => dateOnlyBR(e.data).getTime() === primeira);
      proximoPlantao = { data: doDia[0].data, advogados: doDia.map((e) => e.advogado) };
    }

    /**
     * Carga da equipe — só para quem GERE (Coordenação/Administrador).
     *
     * O corte é no BACKEND, não só na tela: a lista expõe nome e volume de
     * trabalho de cada advogado, e esconder no front deixaria o dado viajando
     * para quem não deve vê-lo. Advogado e Triagem recebem `null`.
     */
    const ehGestao = user.role === 'ADMINISTRADOR' || user.role === 'COORDENACAO';
    const cargaEquipe = !ehGestao
      ? null
      : await (async () => {
          const ids = [...new Set(cargaPorAdvogadoRaw.map((c) => c.responsavelId))].filter(Boolean);
          if (!ids.length) return [];
          const pessoas = await this.prisma.user.findMany({
            where: { id: { in: ids as string[] }, ativo: true },
            select: { id: true, nome: true, nomeExibicao: true, avatarUrl: true, avatarKey: true },
          });
          const atrasoPorId = new Map(
            atrasadasPorAdvogadoRaw.map((a) => [a.responsavelId, a._count._all]),
          );
          return cargaPorAdvogadoRaw
            .map((c) => {
              const p = pessoas.find((u) => u.id === c.responsavelId);
              if (!p) return null; // usuário inativo/removido não entra no painel
              return {
                advogado: p,
                abertas: c._count._all,
                atrasadas: atrasoPorId.get(c.responsavelId) ?? 0,
              };
            })
            .filter(Boolean)
            // Mais atrasadas primeiro: é o gargalo, não o volume, que exige ação.
            .sort((a, b) => b!.atrasadas - a!.atrasadas || b!.abertas - a!.abertas) as {
            advogado: { id: string; nome: string; nomeExibicao: string | null; avatarUrl: string | null };
            abertas: number;
            atrasadas: number;
          }[];
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
              this.prisma.compromisso.count({
                where: {
                  ...meu,
                  tipo: TIPO_AUDIENCIA,
                  status: ABERTOS,
                  inicio: { gte: hojeIni, lt: em7dias },
                },
              }),
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
            urgentes: urgentesSemanaCount,
            preProcessuais,
            semMovimentacao: semMovimentacaoMinha,
          };
        })()
      : null;

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
            const [registradosHoje, semDesfecho, filiadosHoje] = await Promise.all([
              this.prisma.atendimento.count({
                where: { atendentePorId: user.id, createdAt: { gte: hojeIni, lt: amanhaData } },
              }),
              this.prisma.atendimento.count({
                where: { atendentePorId: user.id, status: StatusAtendimento.PENDENTE },
              }),
              this.prisma.filiado.count({
                where: { createdAt: { gte: hojeIni, lt: amanhaData } },
              }),
            ]);
            return { registradosHoje, semDesfecho, filiadosHoje };
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
        atendimentosPendentes: atendimentosPendentesCount,
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
        semMovimentacao: semMovimentacaoCount,
        urgentes: urgentesSemanaCount,
        audienciasAAgendar: audienciasAAgendar.total,
      },
      audienciasAAgendar: audienciasAAgendar.items,
      /** Carga da equipe (nulo para o advogado — é instrumento de gestão). */
      cargaEquipe,
      /** Tarefas de contato com o filiado — a fila própria da Triagem. */
      contatosHoje,
      /** Aniversariantes de hoje: filiados e equipe, na mesma lista. */
      aniversariantes,
      /**
       * Tempo médio da triagem (30 dias). `horas: null` quando não houve
       * resolução no período — melhor que exibir "0h" sobre amostra vazia.
       */
      tempoMedioTriagem,
      atividadesHoje,
      audienciasSemana,
      pendenciasAtivas,
      atendimentosPendentes,
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
      ),
      /**
       * Contra quem o sindicato mais litiga hoje. Vazio quando ninguém
       * aparece três vezes — e aí a tela não desenha o bloco.
       */
      adversarios,
      equipeHoje: { plantaoHoje, proximoPlantao },
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
      robo: this.situacaoRobo(ultimaSync, falhasSync, processosMonitorados, agora),
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
    const inicioMes = new Date();
    inicioMes.setDate(1);
    inicioMes.setHours(0, 0, 0, 0);

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
  ) {
    const HORA = 3_600_000;
    const horasSemNada = ultimaEm ? (agora.getTime() - ultimaEm.getTime()) / HORA : null;

    const situacao = !ativa
      ? 'DESLIGADA'
      : !ultimaEm
        ? 'PRIMEIRA'
        : horasSemNada! <= 48
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
      /** ATOS disponibilizados nos últimos 7 dias, já sem as cópias. */
      publicacoes7d: atos.size,
      ultimaEm,
      /** GLOBAL para gestão e triagem; PESSOAL para o advogado. */
      escopo,
      /**
       * As que pedem providência — e só elas. Ver a consulta: edital e lista de
       * distribuição chegam às dezenas e afogariam a intimação com prazo.
       */
      recentes: ativa ? this.resumirPublicacoes(recentesBrutas, idDoSindicato) : [],
    };
  }

  /**
   * Agrupa as cópias e resolve, para cada ato, a informação que a linha do
   * painel precisa: contra quem é, de quem é, e se já virou trabalho.
   */
  private resumirPublicacoes(brutas: PublicacaoBruta[], idDoSindicato: string | null) {
    const porAto = new Map<string, PublicacaoBruta[]>();
    for (const pub of brutas) {
      const chave = pub.link ?? `id:${pub.id}`;
      const grupo = porAto.get(chave);
      if (grupo) grupo.push(pub);
      else porAto.set(chave, [pub]);
    }

    return [...porAto.values()].slice(0, 6).map((grupo) => {
      const pub = grupo[0];
      return {
        id: pub.id,
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
        /** Quantos destinatários receberam a MESMA comunicação. */
        copias: grupo.length,
        processo: pub.processo && {
          id: pub.processo.id,
          numeroCNJ: pub.processo.numeroCNJ,
          adversario: adversarioDoProcesso(pub.processo.partes, idDoSindicato),
          advogado: pub.processo.advogado,
        },
      };
    });
  }

  private situacaoRobo(
    ultimaSync: { createdAt: Date; sucesso: boolean } | null,
    falhas: FalhaDatajud[],
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

    return {
      situacao,
      processosMonitorados,
      ultimaSincronizacao: ultimaSync?.createdAt ?? null,
      ultimaComSucesso: ultimaSync?.sucesso ?? null,
      falhas24h: lista.length,
      /**
       * QUAIS processos o CNJ recusou. O número sozinho não era acionável: a
       * barra dizia "2 processos" e mandava para a lista inteira, onde nada
       * distinguia os dois do resto. Com a lista, o aviso vira trabalho —
       * cada item abre o processo que falhou.
       */
      falhasProcessos: lista,
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
   */
  private falhasDatajud24h(desde: Date) {
    return this.prisma.$queryRaw<FalhaDatajud[]>`
      WITH ultima AS (
        SELECT DISTINCT ON (COALESCE(l.processo_id, l.numero_cnj))
               l.processo_id, l.numero_cnj, l.tribunal, l.sucesso,
               l.http_status, l.mensagem_erro, l.created_at
          FROM logs_sincronizacao_datajud l
         WHERE l.created_at >= ${desde}
           AND l.fonte = 'DATAJUD'
           AND l.origem <> 'IMPORTACAO'::"OrigemSincronizacao"
         ORDER BY COALESCE(l.processo_id, l.numero_cnj), l.created_at DESC
      )
      SELECT u.processo_id   AS "processoId",
             u.numero_cnj    AS "numeroCNJ",
             u.tribunal      AS "tribunal",
             u.http_status   AS "httpStatus",
             u.mensagem_erro AS "mensagemErro",
             u.created_at    AS "createdAt",
             f.nome_completo AS "filiado"
        FROM ultima u
        LEFT JOIN processos p ON p.id = u.processo_id
        LEFT JOIN filiados  f ON f.id = p.filiado_id
       WHERE u.sucesso = false
       ORDER BY u.created_at DESC
       LIMIT 25
    `;
  }

  private seisMesesAtras(): Date {
    const d = new Date();
    d.setMonth(d.getMonth() - 5);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /** Agrupa datas por mês (YYYY-MM) para o gráfico de área. */
  private agruparPorMes(datas: Date[]): { mes: string; total: number }[] {
    const mapa = new Map<string, number>();
    for (const d of datas) {
      const chave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
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
  private async aniversariantesDeHoje(agora: Date) {
    const br = new Date(agora.getTime() - OFFSET_BR);
    const mes = br.getUTCMonth() + 1;
    const dia = br.getUTCDate();

    const [filiados, colaboradores] = await Promise.all([
      this.prisma.$queryRaw<
        { id: string; nome: string; telefone: string | null; nascimento: Date }[]
      >`
        SELECT id, nome_completo AS nome, telefone_principal AS telefone, data_nascimento AS nascimento
          FROM filiados
         WHERE data_nascimento IS NOT NULL
           AND EXTRACT(MONTH FROM data_nascimento) = ${mes}
           AND EXTRACT(DAY   FROM data_nascimento) = ${dia}
           AND situacao = 'ATIVO'
         ORDER BY nome_completo
         LIMIT 30
      `,
      this.prisma.$queryRaw<
        { id: string; nome: string; telefone: string | null; nascimento: Date }[]
      >`
        SELECT id, nome, telefone, data_nascimento AS nascimento
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
