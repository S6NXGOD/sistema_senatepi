-- CreateEnum
CREATE TYPE "StatusSorteioInscricao" AS ENUM ('INSCRITO', 'SORTEADO', 'NAO_SORTEADO', 'CANCELADO');

-- CreateTable
CREATE TABLE "colonia_sorteio_inscricoes" (
    "id" TEXT NOT NULL,
    "temporada_id" TEXT NOT NULL,
    "lote_id" TEXT NOT NULL,
    "status" "StatusSorteioInscricao" NOT NULL DEFAULT 'INSCRITO',
    "nome_completo" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "coren" TEXT,
    "email" TEXT,
    "formacao" "FormacaoColonia" NOT NULL,
    "local_trabalho_1" TEXT NOT NULL,
    "local_trabalho_2" TEXT,
    "cidade" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "aceite_termo_no_show" BOOLEAN NOT NULL DEFAULT false,
    "consentimento_lgpd" BOOLEAN NOT NULL DEFAULT false,
    "consentimento_em" TIMESTAMP(3),
    "ip_inscricao" TEXT,
    "reserva_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "colonia_sorteio_inscricoes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "colonia_sorteio_inscricoes_temporada_id_idx" ON "colonia_sorteio_inscricoes"("temporada_id");

-- CreateIndex
CREATE INDEX "colonia_sorteio_inscricoes_lote_id_idx" ON "colonia_sorteio_inscricoes"("lote_id");

-- CreateIndex
CREATE INDEX "colonia_sorteio_inscricoes_status_idx" ON "colonia_sorteio_inscricoes"("status");

-- CreateIndex
CREATE INDEX "colonia_sorteio_inscricoes_temporada_id_cpf_idx" ON "colonia_sorteio_inscricoes"("temporada_id", "cpf");

-- AddForeignKey
ALTER TABLE "colonia_sorteio_inscricoes" ADD CONSTRAINT "colonia_sorteio_inscricoes_temporada_id_fkey" FOREIGN KEY ("temporada_id") REFERENCES "colonia_temporadas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "colonia_sorteio_inscricoes" ADD CONSTRAINT "colonia_sorteio_inscricoes_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "colonia_lotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
