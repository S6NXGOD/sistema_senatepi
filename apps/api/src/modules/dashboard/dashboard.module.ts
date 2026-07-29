import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  SituacaoFiliado,
  StatusCompromisso,
  StatusEvento,
  StatusFuncionario,
  StatusGenerico,
  StatusProcesso,
  TipoCompromisso,
  TipoDependente,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

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
  constructor(private readonly prisma: PrismaService) {}

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
    ] = await Promise.all([
      this.prisma.processo.count({ where: { statusInterno: StatusProcesso.ATIVO } }),
      this.prisma.atendimento.count({ where: { status: 'PENDENTE' } }),
      this.prisma.filiado.count({ where: { situacao: SituacaoFiliado.ATIVO } }),
      this.prisma.filiado.count(),
      this.prisma.filiado.count({ where: { createdAt: { gte: inicioMes, lte: agora } } }),
      this.prisma.compromisso.count({
        where: {
          ...meu,
          status: ABERTOS,
          tipo: { in: [TipoCompromisso.PRAZO, TipoCompromisso.AUDIENCIA] },
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
        where: { ...meu, tipo: TipoCompromisso.AUDIENCIA, status: ABERTOS, inicio: { gte: hojeIni, lt: em7dias } },
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
      // Gráfico: crescimento de filiados (6 meses) — limite superior evita
      // datas futuras vindas de importações com timestamp inválido.
      this.prisma.filiado.findMany({
        where: { createdAt: { gte: this.seisMesesAtras(), lte: agora } },
        select: { createdAt: true },
      }),
    ]);

    // "Próximo plantão": advogados da primeira data futura com escala.
    let proximoPlantao: { data: Date; advogados: typeof proximasEscalas[number]['advogado'][] } | null = null;
    if (proximasEscalas.length) {
      const primeira = dateOnlyBR(proximasEscalas[0].data).getTime();
      const doDia = proximasEscalas.filter((e) => dateOnlyBR(e.data).getTime() === primeira);
      proximoPlantao = { data: doDia[0].data, advogados: doDia.map((e) => e.advogado) };
    }

    const minhaCarteira = souAdvogado
      ? await (async () => {
          const [meusProcessos, minhasAudiencias] = await Promise.all([
            this.prisma.processo.count({ where: { advogadoId: user.id, statusInterno: StatusProcesso.ATIVO } }),
            this.prisma.compromisso.count({
              where: {
                responsavelId: user.id,
                tipo: TipoCompromisso.AUDIENCIA,
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
      },
      minhaCarteira,
      alertas: { atrasadas: atrasadasCount, semMovimentacao: semMovimentacaoCount, urgentes: urgentesSemanaCount },
      atividadesHoje,
      audienciasSemana,
      pendenciasAtivas,
      atendimentosPendentes,
      movimentacoesRecentes,
      equipeHoje: { plantaoHoje, proximoPlantao },
      graficos: {
        atendimentosPorCanal: canalGroup.map((c) => ({ canal: c.canal, total: c._count._all })),
        atendimentos14dias: this.bucketDiario(atendimentos14Raw.map((a) => a.createdAt), 14),
        crescimentoFiliados: this.agruparPorMes(crescimentoRaw.map((f) => f.createdAt)),
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
      funcionariosTotal,
      prestadoresTotal,
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
      this.prisma.funcionario.count({ where: { status: StatusFuncionario.ATIVO } }),
      this.prisma.prestador.count({ where: { status: StatusGenerico.ATIVO } }),
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
      funcionarios: { total: funcionariosTotal },
      prestadores: { total: prestadoresTotal },
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
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
