import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import {
  ClimatizacaoQuarto,
  ModoReservaQuarto,
  StatusTemporada,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Inventário fixo de 6 quartos POR LOTE (regra do módulo):
 *  - 1,2,3: Ar-condicionado / Reserva Direta
 *  - 4,5:   Ventilador / Reserva Direta
 *  - 6:     Ventilador / Exclusivo Sorteio ou Alocação Manual
 *
 * OBS.: a versão standalone (CLI) vive em prisma/seed-colonia.ts — manter as
 * duas em sincronia caso as regras da campanha mudem.
 */
const INVENTARIO_QUARTOS = [
  { numero: 1, climatizacao: ClimatizacaoQuarto.AR_CONDICIONADO, modoReserva: ModoReservaQuarto.RESERVA_DIRETA },
  { numero: 2, climatizacao: ClimatizacaoQuarto.AR_CONDICIONADO, modoReserva: ModoReservaQuarto.RESERVA_DIRETA },
  { numero: 3, climatizacao: ClimatizacaoQuarto.AR_CONDICIONADO, modoReserva: ModoReservaQuarto.RESERVA_DIRETA },
  { numero: 4, climatizacao: ClimatizacaoQuarto.VENTILADOR, modoReserva: ModoReservaQuarto.RESERVA_DIRETA },
  { numero: 5, climatizacao: ClimatizacaoQuarto.VENTILADOR, modoReserva: ModoReservaQuarto.RESERVA_DIRETA },
  { numero: 6, climatizacao: ClimatizacaoQuarto.VENTILADOR, modoReserva: ModoReservaQuarto.SORTEIO_OU_MANUAL },
] as const;

const CAMPANHA_ID = 'colonia-julho-2026';
const CAMPANHA_SLUG = 'julho-2026';
const CAMPANHA_NOME = 'Colônia de Julho 2026';

// Horários exatos de check-in/check-out por lote (Teresina, UTC-3). Cada lote = 2 noites.
const LOTES_HORARIOS: { inicio: string; fim: string }[] = [
  { inicio: '2026-07-10T10:00:00-03:00', fim: '2026-07-12T12:00:00-03:00' },
  { inicio: '2026-07-12T14:00:00-03:00', fim: '2026-07-14T12:00:00-03:00' },
  { inicio: '2026-07-14T14:00:00-03:00', fim: '2026-07-16T12:00:00-03:00' },
  { inicio: '2026-07-16T14:00:00-03:00', fim: '2026-07-18T12:00:00-03:00' },
  { inicio: '2026-07-18T14:00:00-03:00', fim: '2026-07-20T12:00:00-03:00' },
];
const TOTAL_LOTES = LOTES_HORARIOS.length;

/**
 * Seed automático de "primeira execução": garante que o sistema funcione
 * out-of-the-box com a campanha padrão já pronta (link público + inventário).
 *
 * Idempotente e não-destrutivo:
 *  - cria a campanha ATIVA na 1ª execução;
 *  - garante os 5 lotes e os 6 quartos por lote em execuções seguintes;
 *  - NUNCA reativa uma campanha que a diretoria tenha desativado (não mexe no status
 *    no caminho de update) nem apaga reservas existentes.
 */
@Injectable()
export class ColoniaSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ColoniaSeedService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      // Seed de PRIMEIRA EXECUÇÃO: se a campanha já existe, não re-roda a lógica
      // (não sobrescreve datas/nome que a diretoria possa ter ajustado).
      const existe = await this.prisma.coloniaTemporada.findUnique({
        where: { id: CAMPANHA_ID },
        select: { id: true },
      });
      if (existe) {
        this.logger.log('Campanha da Colônia já existe — seed de primeira execução ignorado.');
        return;
      }
      const t = await this.semear();
      this.logger.log(
        `Campanha "${t.nome}" criada no primeiro deploy (/${t.slug}) — ${TOTAL_LOTES} lotes × 6 quartos.`,
      );
    } catch (e) {
      // Uma falha de seed não deve derrubar o boot da API.
      this.logger.error('Falha ao semear a campanha padrão da Colônia.', e as Error);
    }
  }

  private async semear() {
    const temporada = await this.prisma.coloniaTemporada.upsert({
      where: { id: CAMPANHA_ID },
      // update sem status: respeita o que a diretoria configurou.
      update: { nome: CAMPANHA_NOME, slug: CAMPANHA_SLUG },
      create: {
        id: CAMPANHA_ID,
        nome: CAMPANHA_NOME,
        slug: CAMPANHA_SLUG,
        ano: 2026,
        status: StatusTemporada.ATIVA,
        descricao: 'Temporada de férias de julho de 2026 na Colônia do SENATEPI.',
      },
    });

    for (let i = 0; i < TOTAL_LOTES; i++) {
      const dataInicio = new Date(LOTES_HORARIOS[i].inicio);
      const dataFim = new Date(LOTES_HORARIOS[i].fim);
      const lote = await this.prisma.coloniaLote.upsert({
        where: { temporadaId_numero: { temporadaId: temporada.id, numero: i + 1 } },
        update: { dataInicio, dataFim },
        create: { temporadaId: temporada.id, numero: i + 1, dataInicio, dataFim },
      });

      for (const q of INVENTARIO_QUARTOS) {
        await this.prisma.coloniaQuarto.upsert({
          where: { loteId_numero: { loteId: lote.id, numero: q.numero } },
          update: { climatizacao: q.climatizacao, modoReserva: q.modoReserva },
          create: {
            loteId: lote.id,
            numero: q.numero,
            climatizacao: q.climatizacao,
            modoReserva: q.modoReserva,
          },
        });
      }
    }

    return temporada;
  }
}
