-- CreateTable
CREATE TABLE "escalas_advogados" (
    "id" TEXT NOT NULL,
    "advogado_id" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "hora_inicio" TEXT NOT NULL,
    "hora_fim" TEXT NOT NULL,
    "observacao" TEXT,
    "criado_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escalas_advogados_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "escalas_advogados_advogado_id_idx" ON "escalas_advogados"("advogado_id");

-- CreateIndex
CREATE INDEX "escalas_advogados_data_idx" ON "escalas_advogados"("data");

-- AddForeignKey
ALTER TABLE "escalas_advogados" ADD CONSTRAINT "escalas_advogados_advogado_id_fkey" FOREIGN KEY ("advogado_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
