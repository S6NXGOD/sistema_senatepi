import 'dotenv/config'; // carrega apps/api/.env quando executado standalone
import {
  PrismaClient,
  StatusTemporada,
  ClimatizacaoQuarto,
  ModoReservaQuarto,
} from '@prisma/client';

/**
 * Seed do módulo Colônia (Gerenciador de Campanhas).
 * - Campanha "Colônia de Julho 2026" (slug: julho-2026), ATIVA.
 * - 5 lotes de 48h (10–20/07/2026).
 * - Inventário fixo de 6 quartos POR LOTE:
 *     1,2,3 Ar-condicionado / Reserva Direta
 *     4,5   Ventilador / Reserva Direta
 *     6     Ventilador / Exclusivo Sorteio ou Alocação Manual
 *
 * Idempotente (upserts). Espelha src/modules/colonia/colonia-seed.service.ts,
 * que roda automaticamente no boot da API — manter as duas em sincronia.
 *
 * Execução direta: ts-node prisma/seed-colonia.ts
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

export async function seedColonia(prisma: PrismaClient) {
  const temporada = await prisma.coloniaTemporada.upsert({
    where: { id: CAMPANHA_ID },
    // update sem status: não reativa uma campanha desativada pela diretoria.
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
    const lote = await prisma.coloniaLote.upsert({
      where: { temporadaId_numero: { temporadaId: temporada.id, numero: i + 1 } },
      update: { dataInicio, dataFim },
      create: { temporadaId: temporada.id, numero: i + 1, dataInicio, dataFim },
    });

    for (const q of INVENTARIO_QUARTOS) {
      await prisma.coloniaQuarto.upsert({
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

  console.log(`✓ Colônia: campanha "${CAMPANHA_NOME}" (/${CAMPANHA_SLUG}) — ${TOTAL_LOTES} lotes × 6 quartos.`);
}

// Execução direta (standalone)
if (require.main === module) {
  const prisma = new PrismaClient();
  seedColonia(prisma)
    .then(() => console.log('✅ Seed da Colônia concluído.'))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
