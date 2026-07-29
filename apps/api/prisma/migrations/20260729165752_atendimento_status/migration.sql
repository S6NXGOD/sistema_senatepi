-- CreateEnum
CREATE TYPE "StatusAtendimento" AS ENUM ('PENDENTE', 'CONCLUIDO', 'CANCELADO');

-- AlterTable
ALTER TABLE "atendimentos" ADD COLUMN     "status" "StatusAtendimento" NOT NULL DEFAULT 'PENDENTE';

-- CreateIndex
CREATE INDEX "atendimentos_status_idx" ON "atendimentos"("status");

