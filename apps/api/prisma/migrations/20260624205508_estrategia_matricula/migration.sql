-- CreateEnum
CREATE TYPE "EstrategiaMatricula" AS ENUM ('REGENERAR', 'DISPENSAR');

-- AlterTable
ALTER TABLE "importacoes" ADD COLUMN     "dispensados" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "estrategia_matricula" "EstrategiaMatricula" NOT NULL DEFAULT 'REGENERAR';
