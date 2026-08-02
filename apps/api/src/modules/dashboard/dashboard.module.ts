import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
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
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { AudienciasService } from '../processos/audiencias.service';
import { ProcessosModule } from '../processos/processos.module';

// Brasil não adota horário de verão desde 2019 → offset fixo UTC-3. Usamos isto
// para calcular "hoje/esta semana" pelo relógio de Teresina, e não pelo do
// servidor (Railway roda em UTC), evitando que um compromisso das 22h "vaze"
// para o dia seguinte.
const OFFSET_BR = 3 * 3_600_000;
const DIA_MS = 24 * 3_600_000;

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
  iniciadoEm: true,
  responsavel: { select: { id: true, nome: true, nomeExibicao: true, avatarUrl: true } },
  filiado: { select: { id: true, nomeCompleto: true } },
  processo: { select: { id: true, numeroCNJ: true } },
} as const;

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audiencias: AudienciasService,
  ) {}

  // =========================================================================
  // HOME consolidada e ciente do perfil (1 request → tudo que a tela precisa)
  // =========================================================================

  async resumo(user: AuthUser) {
    const agora = new Date();
    const hojeIni = inicioDoDiaBR(agora);
    const hojeFim = new Date(hojeIni.getTime() + DIA_MS);
    const em7dias = new Date(agora.getTime() + 7 * DIA_MS);
    const menos7dias = new Date(agora.getTime() - 7 * DIA_MS);
    const inicioMes = (() => {
      const br = new Date(agora.getTime() - OFFSET_BR);
      return new Date(Date.UTC(br.getUTCFullYear(), br.getUTCMonth(), 1) + OFFSET_BR);
    })();
    const hojeData = dateOnlyBR(agora);
    const amanhaData = new Date(hojeData.getTime() + DIA_MS);

    const souAdvogado = user.role === 'ADVOGADO';
    // Escopo pessoal do advogado: suas atividades e sua carteira. Demais perfis
    // enxergam a operação inteira.
    const meu = souAdvogado ? { responsavelId: user.id } : {};

    const [
      // KPIs globais
      processosAtivos,
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
      falhasSync24h,
      processosMonitorados,
      // Qualidade do dado e painéis por perfil
      filiadosSemDataFiliacao,
      cargaPorAdvogadoRaw,
      atrasadasPorAdvogadoRaw,
      contatosHoje,
      aniversariantes,
      tempoMedioTriagem,
    ] = await Promise.all([
      this.prisma.processo.count({ where: { statusInterno: StatusProcesso.ATIVO } }),
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
          advogado: { select: { id: true, nome: true, nomeExibicao: true, avatarUrl: true } },
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
          advogado: { select: { id: true, nome: true, nomeExibicao: true, avatarUrl: true } },
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
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, sucesso: true },
      }),
      this.prisma.logSincronizacaoDatajud.count({
        where: { sucesso: false, createdAt: { gte: new Date(agora.getTime() - DIA_MS) } },
      }),
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
    ]);

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
            select: { id: true, nome: true, nomeExibicao: true, avatarUrl: true },
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

    const minhaCarteira = souAdvogado
      ? await (async () => {
          const [meusProcessos, minhasAudiencias] = await Promise.all([
            this.prisma.processo.count({ where: { advogadoId: user.id, statusInterno: StatusProcesso.ATIVO } }),
            this.prisma.compromisso.count({
              where: {
                responsavelId: user.id,
                tipo: TIPO_AUDIENCIA,
                status: ABERTOS,
                inicio: { gte: hojeIni, lt: em7dias },
              },
            }),
          ]);
          return { meusProcessos, minhasAudiencias, atrasadas: atrasadasCount, urgentes: urgentesSemanaCount };
        })()
      : null;

    return {
      papel: user.role,
      escopo: souAdvogado ? 'PESSOAL' : 'GLOBAL',
      kpis: {
        processosAtivos,
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
      robo: this.situacaoRobo(ultimaSync, falhasSync24h, processosMonitorados, agora),
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
      this.prisma.dependente.count({ where: { tipo: TipoDependente.CONJUGE } }),
      this.prisma.dependente.count({ where: { tipo: TipoDependente.FILHO } }),
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
  private situacaoRobo(
    ultimaSync: { createdAt: Date; sucesso: boolean } | null,
    falhas24h: number,
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

    return {
      situacao,
      processosMonitorados,
      ultimaSincronizacao: ultimaSync?.createdAt ?? null,
      ultimaComSucesso: ultimaSync?.sucesso ?? null,
      // Falha só é notícia se houve varredura para falhar.
      falhas24h: situacao === 'SEM_OBJETO' ? 0 : falhas24h,
    };
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
