-- CreateEnum
CREATE TYPE "TipoMovimentacao" AS ENUM ('ENTRADA', 'SAIDA');

-- AlterTable
ALTER TABLE "parcelas_cobranca" ADD COLUMN     "movimentacao_id" TEXT,
ADD COLUMN     "valor_pago" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "contas_bancarias" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "instituicao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contas_bancarias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimentacoes" (
    "id" TEXT NOT NULL,
    "conta_bancaria_id" TEXT NOT NULL,
    "tipo" "TipoMovimentacao" NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "descricao" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "origem" TEXT,
    "criada_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimentacoes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "movimentacoes_conta_bancaria_id_idx" ON "movimentacoes"("conta_bancaria_id");

-- CreateIndex
CREATE INDEX "movimentacoes_tipo_idx" ON "movimentacoes"("tipo");

-- CreateIndex
CREATE INDEX "movimentacoes_data_idx" ON "movimentacoes"("data");

-- CreateIndex
CREATE UNIQUE INDEX "parcelas_cobranca_movimentacao_id_key" ON "parcelas_cobranca"("movimentacao_id");

-- AddForeignKey
ALTER TABLE "parcelas_cobranca" ADD CONSTRAINT "parcelas_cobranca_movimentacao_id_fkey" FOREIGN KEY ("movimentacao_id") REFERENCES "movimentacoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes" ADD CONSTRAINT "movimentacoes_conta_bancaria_id_fkey" FOREIGN KEY ("conta_bancaria_id") REFERENCES "contas_bancarias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

