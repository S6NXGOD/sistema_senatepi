-- CreateEnum
CREATE TYPE "StatusImportacao" AS ENUM ('VALIDANDO', 'VALIDADO', 'IMPORTANDO', 'CONCLUIDO', 'ERRO');

-- CreateEnum
CREATE TYPE "EstrategiaDuplicado" AS ENUM ('IGNORAR', 'ATUALIZAR');

-- AlterEnum
ALTER TYPE "AcaoAuditoria" ADD VALUE 'IMPORT';

-- AlterTable
ALTER TABLE "filiados" ALTER COLUMN "data_nascimento" DROP NOT NULL;

-- CreateTable
CREATE TABLE "importacoes" (
    "id" TEXT NOT NULL,
    "nome_arquivo" TEXT NOT NULL,
    "tamanho_bytes" INTEGER NOT NULL,
    "status" "StatusImportacao" NOT NULL DEFAULT 'VALIDANDO',
    "estrategia" "EstrategiaDuplicado" NOT NULL DEFAULT 'IGNORAR',
    "total" INTEGER NOT NULL DEFAULT 0,
    "validos" INTEGER NOT NULL DEFAULT 0,
    "comErro" INTEGER NOT NULL DEFAULT 0,
    "duplicados" INTEGER NOT NULL DEFAULT 0,
    "processados" INTEGER NOT NULL DEFAULT 0,
    "importados" INTEGER NOT NULL DEFAULT 0,
    "atualizados" INTEGER NOT NULL DEFAULT 0,
    "ignorados" INTEGER NOT NULL DEFAULT 0,
    "mapeamento" JSONB,
    "iniciado_em" TIMESTAMP(3),
    "finalizado_em" TIMESTAMP(3),
    "duracao_ms" INTEGER,
    "erro_mensagem" TEXT,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "importacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "importacao_linhas" (
    "id" TEXT NOT NULL,
    "importacao_id" TEXT NOT NULL,
    "linha" INTEGER NOT NULL,
    "dados" JSONB NOT NULL,
    "nome" TEXT,
    "cpf" TEXT,
    "matricula" TEXT,
    "telefone" TEXT,
    "empresa" TEXT,
    "situacao" TEXT,
    "valido" BOOLEAN NOT NULL DEFAULT true,
    "duplicado_no_sistema" BOOLEAN NOT NULL DEFAULT false,
    "erros" JSONB,
    "resultado" TEXT,
    "filiado_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "importacao_linhas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "importacoes_status_idx" ON "importacoes"("status");

-- CreateIndex
CREATE INDEX "importacoes_created_at_idx" ON "importacoes"("created_at");

-- CreateIndex
CREATE INDEX "importacao_linhas_importacao_id_idx" ON "importacao_linhas"("importacao_id");

-- CreateIndex
CREATE INDEX "importacao_linhas_importacao_id_valido_idx" ON "importacao_linhas"("importacao_id", "valido");

-- CreateIndex
CREATE INDEX "importacao_linhas_cpf_idx" ON "importacao_linhas"("cpf");

-- AddForeignKey
ALTER TABLE "importacao_linhas" ADD CONSTRAINT "importacao_linhas_importacao_id_fkey" FOREIGN KEY ("importacao_id") REFERENCES "importacoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
