-- CreateEnum
CREATE TYPE "StatusTemporada" AS ENUM ('ATIVA', 'INATIVA');

-- CreateEnum
CREATE TYPE "ClimatizacaoQuarto" AS ENUM ('AR_CONDICIONADO', 'VENTILADOR');

-- CreateEnum
CREATE TYPE "ModoReservaQuarto" AS ENUM ('RESERVA_DIRETA', 'SORTEIO_OU_MANUAL');

-- CreateEnum
CREATE TYPE "FormacaoColonia" AS ENUM ('ENFERMEIRO', 'TECNICO', 'AUXILIAR');

-- CreateEnum
CREATE TYPE "OrigemReserva" AS ENUM ('RESERVA_DIRETA', 'SORTEIO', 'ALOCACAO_MANUAL');

-- CreateEnum
CREATE TYPE "StatusReserva" AS ENUM ('CONFIRMADA', 'CANCELADA');

-- CreateTable
CREATE TABLE "colonia_temporadas" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "status" "StatusTemporada" NOT NULL DEFAULT 'INATIVA',
    "descricao" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "colonia_temporadas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "colonia_lotes" (
    "id" TEXT NOT NULL,
    "temporada_id" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "data_inicio" TIMESTAMP(3) NOT NULL,
    "data_fim" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "colonia_lotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "colonia_quartos" (
    "id" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "climatizacao" "ClimatizacaoQuarto" NOT NULL,
    "modo_reserva" "ModoReservaQuarto" NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "colonia_quartos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "colonia_reservas" (
    "id" TEXT NOT NULL,
    "temporada_id" TEXT NOT NULL,
    "lote_id" TEXT NOT NULL,
    "quarto_id" TEXT NOT NULL,
    "origem" "OrigemReserva" NOT NULL DEFAULT 'RESERVA_DIRETA',
    "status" "StatusReserva" NOT NULL DEFAULT 'CONFIRMADA',
    "alocacao_manual" BOOLEAN NOT NULL DEFAULT false,
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
    "termo_versao" TEXT,
    "consentimento_lgpd" BOOLEAN NOT NULL DEFAULT false,
    "consentimento_em" TIMESTAMP(3),
    "ip_consentimento" TEXT,
    "anonimizada_em" TIMESTAMP(3),
    "cancelada_em" TIMESTAMP(3),
    "cancelada_por" TEXT,
    "motivo_cancelamento" TEXT,
    "criada_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "colonia_reservas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "colonia_temporadas_status_idx" ON "colonia_temporadas"("status");

-- CreateIndex
CREATE INDEX "colonia_lotes_temporada_id_idx" ON "colonia_lotes"("temporada_id");

-- CreateIndex
CREATE UNIQUE INDEX "colonia_lotes_temporada_id_numero_key" ON "colonia_lotes"("temporada_id", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "colonia_quartos_numero_key" ON "colonia_quartos"("numero");

-- CreateIndex
CREATE INDEX "colonia_reservas_temporada_id_idx" ON "colonia_reservas"("temporada_id");

-- CreateIndex
CREATE INDEX "colonia_reservas_lote_id_idx" ON "colonia_reservas"("lote_id");

-- CreateIndex
CREATE INDEX "colonia_reservas_quarto_id_idx" ON "colonia_reservas"("quarto_id");

-- CreateIndex
CREATE INDEX "colonia_reservas_status_idx" ON "colonia_reservas"("status");

-- CreateIndex
CREATE INDEX "colonia_reservas_temporada_id_cpf_idx" ON "colonia_reservas"("temporada_id", "cpf");

-- AddForeignKey
ALTER TABLE "colonia_lotes" ADD CONSTRAINT "colonia_lotes_temporada_id_fkey" FOREIGN KEY ("temporada_id") REFERENCES "colonia_temporadas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "colonia_reservas" ADD CONSTRAINT "colonia_reservas_temporada_id_fkey" FOREIGN KEY ("temporada_id") REFERENCES "colonia_temporadas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "colonia_reservas" ADD CONSTRAINT "colonia_reservas_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "colonia_lotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "colonia_reservas" ADD CONSTRAINT "colonia_reservas_quarto_id_fkey" FOREIGN KEY ("quarto_id") REFERENCES "colonia_quartos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
