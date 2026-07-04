-- CreateEnum
CREATE TYPE "TipoHistoricoColaborador" AS ENUM ('CADASTRO', 'ALTERACAO', 'MUDANCA_STATUS', 'UPLOAD_FOTO');

-- AlterTable
ALTER TABLE "colaboradores" ADD COLUMN     "data_desligamento" TIMESTAMP(3),
ADD COLUMN     "ferias_retorno_em" TIMESTAMP(3),
ADD COLUMN     "foto_key" TEXT,
ADD COLUMN     "status_motivo" TEXT;

-- CreateTable
CREATE TABLE "colaborador_historico" (
    "id" TEXT NOT NULL,
    "colaborador_id" TEXT NOT NULL,
    "tipo" "TipoHistoricoColaborador" NOT NULL,
    "descricao" TEXT NOT NULL,
    "autor" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "colaborador_historico_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "colaborador_historico_colaborador_id_idx" ON "colaborador_historico"("colaborador_id");

-- AddForeignKey
ALTER TABLE "colaborador_historico" ADD CONSTRAINT "colaborador_historico_colaborador_id_fkey" FOREIGN KEY ("colaborador_id") REFERENCES "colaboradores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
