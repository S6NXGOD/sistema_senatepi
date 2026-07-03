-- Novos enums do módulo de funcionários
CREATE TYPE "TipoFuncionario" AS ENUM ('FUNCIONARIO', 'PRESTADOR_SERVICO', 'ESTAGIARIO', 'TERCEIRIZADO');
CREATE TYPE "StatusFuncionario" AS ENUM ('ATIVO', 'INATIVO', 'AFASTADO', 'FERIAS', 'DESLIGADO');
CREATE TYPE "TipoHistoricoFuncionario" AS ENUM ('CADASTRO', 'ALTERACAO', 'MUDANCA_STATUS', 'UPLOAD_DOCUMENTO', 'GERACAO_CARTEIRINHA', 'GERACAO_QRCODE');

-- Novo campo tipo
ALTER TABLE "funcionarios" ADD COLUMN "tipo" "TipoFuncionario" NOT NULL DEFAULT 'FUNCIONARIO';

-- Converte a coluna status de StatusGenerico para StatusFuncionario (preservando os dados existentes)
ALTER TABLE "funcionarios" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "funcionarios" ALTER COLUMN "status" TYPE "StatusFuncionario" USING ("status"::text::"StatusFuncionario");
ALTER TABLE "funcionarios" ALTER COLUMN "status" SET DEFAULT 'ATIVO';

-- Índice do novo campo tipo
CREATE INDEX "funcionarios_tipo_idx" ON "funcionarios"("tipo");

-- Tabela de histórico (timeline) do funcionário
CREATE TABLE "funcionario_historico" (
    "id" TEXT NOT NULL,
    "funcionario_id" TEXT NOT NULL,
    "tipo" "TipoHistoricoFuncionario" NOT NULL,
    "descricao" TEXT NOT NULL,
    "autor" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "funcionario_historico_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "funcionario_historico_funcionario_id_idx" ON "funcionario_historico"("funcionario_id");

ALTER TABLE "funcionario_historico" ADD CONSTRAINT "funcionario_historico_funcionario_id_fkey" FOREIGN KEY ("funcionario_id") REFERENCES "funcionarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
