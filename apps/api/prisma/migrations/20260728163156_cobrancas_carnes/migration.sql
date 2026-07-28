-- CreateEnum
CREATE TYPE "TipoCobranca" AS ENUM ('MENSALIDADE', 'ANUIDADE', 'ACORDO', 'TAXA', 'CONTRIBUICAO', 'OUTRO');

-- CreateEnum
CREATE TYPE "StatusParcela" AS ENUM ('PENDENTE', 'PAGO', 'VENCIDO', 'CANCELADO');

-- CreateTable
CREATE TABLE "configuracao_sindicato" (
    "id" TEXT NOT NULL,
    "logo_url" TEXT,
    "assinatura_presidente_url" TEXT,
    "texto_rodape_carne" TEXT,
    "pix_chave" TEXT,
    "pix_nome_recebedor" TEXT,
    "pix_cidade" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuracao_sindicato_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cobrancas" (
    "id" TEXT NOT NULL,
    "filiado_id" TEXT NOT NULL,
    "tipo" "TipoCobranca" NOT NULL DEFAULT 'MENSALIDADE',
    "descricao" TEXT,
    "valor_total" DECIMAL(10,2) NOT NULL,
    "criada_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cobrancas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parcelas_cobranca" (
    "id" TEXT NOT NULL,
    "cobranca_id" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "data_competencia" DATE NOT NULL,
    "data_vencimento" DATE NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "status" "StatusParcela" NOT NULL DEFAULT 'PENDENTE',
    "data_pagamento" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parcelas_cobranca_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cobrancas_filiado_id_idx" ON "cobrancas"("filiado_id");

-- CreateIndex
CREATE INDEX "parcelas_cobranca_cobranca_id_idx" ON "parcelas_cobranca"("cobranca_id");

-- CreateIndex
CREATE INDEX "parcelas_cobranca_status_idx" ON "parcelas_cobranca"("status");

-- AddForeignKey
ALTER TABLE "cobrancas" ADD CONSTRAINT "cobrancas_filiado_id_fkey" FOREIGN KEY ("filiado_id") REFERENCES "filiados"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcelas_cobranca" ADD CONSTRAINT "parcelas_cobranca_cobranca_id_fkey" FOREIGN KEY ("cobranca_id") REFERENCES "cobrancas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
