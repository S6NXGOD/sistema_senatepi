-- CreateEnum
CREATE TYPE "TipoCompromisso" AS ENUM ('CONSULTA_JURIDICA', 'AUDIENCIA', 'PRAZO', 'REUNIAO', 'DILIGENCIA');

-- CreateEnum
CREATE TYPE "StatusCompromisso" AS ENUM ('PENDENTE', 'EM_ANDAMENTO', 'CONCLUIDO', 'CANCELADO');

-- CreateTable
CREATE TABLE "compromissos" (
    "id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "tipo" "TipoCompromisso" NOT NULL,
    "status" "StatusCompromisso" NOT NULL DEFAULT 'PENDENTE',
    "inicio" TIMESTAMP(3) NOT NULL,
    "fim" TIMESTAMP(3) NOT NULL,
    "descricao" TEXT,
    "responsavel_id" TEXT NOT NULL,
    "filiado_id" TEXT,
    "atendimento_id" TEXT,
    "data_original" TIMESTAMP(3),
    "criado_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compromissos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "compromissos_status_idx" ON "compromissos"("status");

-- CreateIndex
CREATE INDEX "compromissos_tipo_idx" ON "compromissos"("tipo");

-- CreateIndex
CREATE INDEX "compromissos_inicio_idx" ON "compromissos"("inicio");

-- CreateIndex
CREATE INDEX "compromissos_responsavel_id_idx" ON "compromissos"("responsavel_id");

-- CreateIndex
CREATE INDEX "compromissos_filiado_id_idx" ON "compromissos"("filiado_id");

-- AddForeignKey
ALTER TABLE "compromissos" ADD CONSTRAINT "compromissos_responsavel_id_fkey" FOREIGN KEY ("responsavel_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compromissos" ADD CONSTRAINT "compromissos_filiado_id_fkey" FOREIGN KEY ("filiado_id") REFERENCES "filiados"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compromissos" ADD CONSTRAINT "compromissos_atendimento_id_fkey" FOREIGN KEY ("atendimento_id") REFERENCES "atendimentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
