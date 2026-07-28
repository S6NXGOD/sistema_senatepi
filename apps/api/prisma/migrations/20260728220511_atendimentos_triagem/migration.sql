-- CreateEnum
CREATE TYPE "CanalAtendimento" AS ENUM ('PRESENCIAL', 'WHATSAPP', 'TELEFONE', 'EMAIL', 'SITE');

-- CreateEnum
CREATE TYPE "DesfechoAtendimento" AS ENUM ('RESOLVIDO_ATO', 'ENCAMINHADO');

-- CreateEnum
CREATE TYPE "SetorAtendimento" AS ENUM ('JURIDICO', 'FINANCEIRO', 'SECRETARIA', 'DIRETORIA', 'COLONIA', 'OUTRO');

-- CreateTable
CREATE TABLE "atendimentos" (
    "id" TEXT NOT NULL,
    "filiado_id" TEXT NOT NULL,
    "atendente_por_id" TEXT NOT NULL,
    "canal" "CanalAtendimento" NOT NULL,
    "descricao" TEXT NOT NULL,
    "desfecho" "DesfechoAtendimento" NOT NULL,
    "setor" "SetorAtendimento",
    "responsavel" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "atendimentos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "atendimentos_filiado_id_idx" ON "atendimentos"("filiado_id");

-- CreateIndex
CREATE INDEX "atendimentos_desfecho_idx" ON "atendimentos"("desfecho");

-- CreateIndex
CREATE INDEX "atendimentos_canal_idx" ON "atendimentos"("canal");

-- CreateIndex
CREATE INDEX "atendimentos_created_at_idx" ON "atendimentos"("created_at");

-- AddForeignKey
ALTER TABLE "atendimentos" ADD CONSTRAINT "atendimentos_filiado_id_fkey" FOREIGN KEY ("filiado_id") REFERENCES "filiados"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atendimentos" ADD CONSTRAINT "atendimentos_atendente_por_id_fkey" FOREIGN KEY ("atendente_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
