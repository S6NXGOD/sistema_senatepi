-- CreateEnum
CREATE TYPE "TipoEncaminhamento" AS ENUM ('CONSULTA_NOVA', 'ANDAMENTO_PROCESSO');

-- AlterTable
ALTER TABLE "atendimentos" ADD COLUMN     "desfecho_em" TIMESTAMP(3),
ADD COLUMN     "desfecho_obs" TEXT,
ADD COLUMN     "numero" SERIAL NOT NULL,
ADD COLUMN     "processo_id" TEXT,
ADD COLUMN     "tipo_encaminhamento" "TipoEncaminhamento",
ALTER COLUMN "desfecho" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "atendimentos_numero_key" ON "atendimentos"("numero");

-- AddForeignKey
ALTER TABLE "atendimentos" ADD CONSTRAINT "atendimentos_processo_id_fkey" FOREIGN KEY ("processo_id") REFERENCES "processos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

