-- Refatoração do módulo Colônia → Gerenciador de Campanhas/Links.
-- Renames preservam os dados existentes; quartos passam a ser POR LOTE.

-- 1) Status admin de cancelamento (soft-delete) — renomeia preservando dados.
ALTER TYPE "StatusReserva" RENAME VALUE 'CANCELADA' TO 'CANCELADA_ADMIN';

-- 2) Flag administrativa: alocacao_manual -> alocacao_manual_diretoria
ALTER TABLE "colonia_reservas" RENAME COLUMN "alocacao_manual" TO "alocacao_manual_diretoria";

-- 3) Campanha (slug público). Backfill dos registros existentes e trava NOT NULL + UNIQUE.
ALTER TABLE "colonia_temporadas" ADD COLUMN "slug" TEXT;
UPDATE "colonia_temporadas" SET "slug" = 'julho-2026' WHERE "slug" IS NULL AND "nome" = 'Julho 2026';
UPDATE "colonia_temporadas" SET "slug" = "id" WHERE "slug" IS NULL; -- fallback seguro
ALTER TABLE "colonia_temporadas" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "colonia_temporadas_slug_key" ON "colonia_temporadas"("slug");

-- 4) Inventário: 6 quartos POR LOTE (antes eram globais).
-- Sem reservas referenciando (0 linhas), então recriamos a estrutura com segurança.
DELETE FROM "colonia_quartos";
DROP INDEX "colonia_quartos_numero_key";
ALTER TABLE "colonia_quartos" ADD COLUMN "lote_id" TEXT NOT NULL;
CREATE INDEX "colonia_quartos_lote_id_idx" ON "colonia_quartos"("lote_id");
CREATE UNIQUE INDEX "colonia_quartos_lote_id_numero_key" ON "colonia_quartos"("lote_id", "numero");
ALTER TABLE "colonia_quartos"
  ADD CONSTRAINT "colonia_quartos_lote_id_fkey"
  FOREIGN KEY ("lote_id") REFERENCES "colonia_lotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
