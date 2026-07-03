-- AlterTable
ALTER TABLE "importacao_linhas" ADD COLUMN     "avisos" JSONB,
ADD COLUMN     "codigos" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "importacoes" ADD COLUMN     "permitir_cpf_invalido" BOOLEAN NOT NULL DEFAULT false;
