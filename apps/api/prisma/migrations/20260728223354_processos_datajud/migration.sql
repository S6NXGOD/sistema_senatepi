-- CreateEnum
CREATE TYPE "StatusProcesso" AS ENUM ('ATIVO', 'ARQUIVADO', 'SUSPENSO');

-- CreateTable
CREATE TABLE "processos" (
    "id" TEXT NOT NULL,
    "numero_cnj" TEXT NOT NULL,
    "filiado_id" TEXT,
    "advogado_id" TEXT,
    "classe_processual" TEXT,
    "assunto_principal" TEXT,
    "orgao_julgador" TEXT,
    "tribunal" TEXT,
    "data_distribuicao" TIMESTAMP(3),
    "valor_causa" DECIMAL(14,2),
    "grau" TEXT,
    "status_interno" "StatusProcesso" NOT NULL DEFAULT 'ATIVO',
    "ultima_sincronizacao" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "processos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimentacoes_processuais" (
    "id" TEXT NOT NULL,
    "processo_id" TEXT NOT NULL,
    "data_movimento" TIMESTAMP(3) NOT NULL,
    "descricao" TEXT NOT NULL,
    "codigo_movimento" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimentacoes_processuais_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "processos_numero_cnj_key" ON "processos"("numero_cnj");

-- CreateIndex
CREATE INDEX "processos_filiado_id_idx" ON "processos"("filiado_id");

-- CreateIndex
CREATE INDEX "processos_advogado_id_idx" ON "processos"("advogado_id");

-- CreateIndex
CREATE INDEX "processos_status_interno_idx" ON "processos"("status_interno");

-- CreateIndex
CREATE INDEX "processos_tribunal_idx" ON "processos"("tribunal");

-- CreateIndex
CREATE INDEX "movimentacoes_processuais_processo_id_idx" ON "movimentacoes_processuais"("processo_id");

-- CreateIndex
CREATE INDEX "movimentacoes_processuais_data_movimento_idx" ON "movimentacoes_processuais"("data_movimento");

-- AddForeignKey
ALTER TABLE "processos" ADD CONSTRAINT "processos_filiado_id_fkey" FOREIGN KEY ("filiado_id") REFERENCES "filiados"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processos" ADD CONSTRAINT "processos_advogado_id_fkey" FOREIGN KEY ("advogado_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes_processuais" ADD CONSTRAINT "movimentacoes_processuais_processo_id_fkey" FOREIGN KEY ("processo_id") REFERENCES "processos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
