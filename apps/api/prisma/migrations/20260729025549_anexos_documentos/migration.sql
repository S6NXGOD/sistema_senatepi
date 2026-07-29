-- CreateTable
CREATE TABLE "anexos_documentos" (
    "id" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "nome_arquivo" TEXT NOT NULL,
    "tipo_mime" TEXT NOT NULL,
    "tamanho_bytes" INTEGER,
    "atendimento_id" TEXT,
    "processo_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "anexos_documentos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "anexos_documentos_atendimento_id_idx" ON "anexos_documentos"("atendimento_id");

-- CreateIndex
CREATE INDEX "anexos_documentos_processo_id_idx" ON "anexos_documentos"("processo_id");

-- AddForeignKey
ALTER TABLE "anexos_documentos" ADD CONSTRAINT "anexos_documentos_atendimento_id_fkey" FOREIGN KEY ("atendimento_id") REFERENCES "atendimentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anexos_documentos" ADD CONSTRAINT "anexos_documentos_processo_id_fkey" FOREIGN KEY ("processo_id") REFERENCES "processos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
