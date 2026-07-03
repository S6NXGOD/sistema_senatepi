import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  SituacaoFiliado,
  StatusEvento,
  StatusFuncionario,
  StatusGenerico,
  TipoDependente,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

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

  /** Filiados criados por mês nos últimos 6 meses (para gráfico). */
  async crescimentoFiliados() {
    const seisMesesAtras = new Date();
    seisMesesAtras.setMonth(seisMesesAtras.getMonth() - 5);
    seisMesesAtras.setDate(1);
    const filiados = await this.prisma.filiado.findMany({
      where: { createdAt: { gte: seisMesesAtras } },
      select: { createdAt: true },
    });
    const mapa = new Map<string, number>();
    for (const f of filiados) {
      const chave = `${f.createdAt.getFullYear()}-${String(f.createdAt.getMonth() + 1).padStart(2, '0')}`;
      mapa.set(chave, (mapa.get(chave) ?? 0) + 1);
    }
    return Array.from(mapa, ([mes, total]) => ({ mes, total })).sort((a, b) =>
      a.mes.localeCompare(b.mes),
    );
  }

  /** Presenças por evento (para gráfico de barras). */
  async presencasPorEvento() {
    const eventos = await this.prisma.evento.findMany({
      orderBy: { dataInicio: 'desc' },
      take: 10,
      include: { _count: { select: { presencas: true } } },
    });
    return eventos.map((e) => ({ evento: e.nome, presencas: e._count.presencas }));
  }
}

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
class DashboardController {
  constructor(private readonly service: DashboardService) {}

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
