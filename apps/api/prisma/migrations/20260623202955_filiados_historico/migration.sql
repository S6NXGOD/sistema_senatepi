-- CreateEnum
CREATE TYPE "TipoHistoricoFiliado" AS ENUM ('FILIACAO', 'ALTERACAO', 'RECADASTRAMENTO', 'MUDANCA_STATUS', 'INCLUSAO_DEPENDENTE', 'EXCLUSAO_DEPENDENTE', 'UPLOAD_DOCUMENTO', 'GERACAO_CARTEIRINHA', 'GERACAO_TERMO');

-- CreateTable
CREATE TABLE "filiado_historico" (
    "id" TEXT NOT NULL,
    "filiado_id" TEXT NOT NULL,
    "tipo" "TipoHistoricoFiliado" NOT NULL,
    "descricao" TEXT NOT NULL,
    "autor" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "filiado_historico_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "filiado_historico_filiado_id_idx" ON "filiado_historico"("filiado_id");

-- AddForeignKey
ALTER TABLE "filiado_historico" ADD CONSTRAINT "filiado_historico_filiado_id_fkey" FOREIGN KEY ("filiado_id") REFERENCES "filiados"("id") ON DELETE CASCADE ON UPDATE CASCADE;
