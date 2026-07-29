-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TipoCompromisso" ADD VALUE 'DESPACHO';
ALTER TYPE "TipoCompromisso" ADD VALUE 'PERICIA';
ALTER TYPE "TipoCompromisso" ADD VALUE 'COMPROMISSO';

-- AlterTable
ALTER TABLE "compromissos" ADD COLUMN     "iniciado_em" TIMESTAMP(3),
ADD COLUMN     "local" TEXT,
ADD COLUMN     "observacoes_internas" TEXT,
ADD COLUMN     "processo_id" TEXT,
ADD COLUMN     "urgente" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "compromissos_processo_id_idx" ON "compromissos"("processo_id");

-- AddForeignKey
ALTER TABLE "compromissos" ADD CONSTRAINT "compromissos_processo_id_fkey" FOREIGN KEY ("processo_id") REFERENCES "processos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
