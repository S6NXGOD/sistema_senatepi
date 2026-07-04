-- Remapeia os estados removidos para os 3 permitidos (produção pode ter dados legados).
UPDATE "filiados" SET "situacao" = 'INATIVO' WHERE "situacao" = 'SUSPENSO';
UPDATE "filiados" SET "situacao" = 'ATIVO' WHERE "situacao" = 'PENDENTE';

-- AlterEnum: SituacaoFiliado passa a ter apenas ATIVO, INATIVO, DESFILIADO.
BEGIN;
CREATE TYPE "SituacaoFiliado_new" AS ENUM ('ATIVO', 'INATIVO', 'DESFILIADO');
ALTER TABLE "filiados" ALTER COLUMN "situacao" DROP DEFAULT;
ALTER TABLE "filiados" ALTER COLUMN "situacao" TYPE "SituacaoFiliado_new" USING ("situacao"::text::"SituacaoFiliado_new");
ALTER TYPE "SituacaoFiliado" RENAME TO "SituacaoFiliado_old";
ALTER TYPE "SituacaoFiliado_new" RENAME TO "SituacaoFiliado";
DROP TYPE "SituacaoFiliado_old";
ALTER TABLE "filiados" ALTER COLUMN "situacao" SET DEFAULT 'ATIVO';
COMMIT;

-- AlterTable
ALTER TABLE "colaboradores" ADD COLUMN     "ferias_inicio" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "documentos" ADD COLUMN     "colaborador_id" TEXT;

-- CreateIndex
CREATE INDEX "documentos_colaborador_id_idx" ON "documentos"("colaborador_id");

-- AddForeignKey
ALTER TABLE "documentos" ADD CONSTRAINT "documentos_colaborador_id_fkey" FOREIGN KEY ("colaborador_id") REFERENCES "colaboradores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
