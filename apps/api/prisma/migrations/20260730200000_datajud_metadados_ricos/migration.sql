-- Enriquecimento da integração com o DataJud (CNJ).
--
-- 100% NÃO-DESTRUTIVA: só adiciona colunas OPCIONAIS (nullable) e uma tabela
-- nova. Nenhuma coluna é removida/renomeada e nenhum dado existente é tocado —
-- processos já importados seguem funcionando com os campos novos vazios até a
-- próxima sincronização preenchê-los.

-- 1) Metadados ricos do processo
ALTER TABLE "processos"
  ADD COLUMN IF NOT EXISTS "classe_codigo"           INTEGER,
  ADD COLUMN IF NOT EXISTS "assuntos"                JSONB,
  ADD COLUMN IF NOT EXISTS "orgao_julgador_codigo"   TEXT,
  ADD COLUMN IF NOT EXISTS "municipio_ibge"          INTEGER,
  ADD COLUMN IF NOT EXISTS "formato"                 TEXT,
  ADD COLUMN IF NOT EXISTS "sistema"                 TEXT,
  ADD COLUMN IF NOT EXISTS "nivel_sigilo"            INTEGER,
  ADD COLUMN IF NOT EXISTS "segredo_justica"         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "prioridades"             JSONB,
  ADD COLUMN IF NOT EXISTS "atualizado_no_cnj_em"    TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "partes_brutas"           JSONB;

-- 2) Detalhamento do ato na movimentação (evita abrir o PJe)
ALTER TABLE "movimentacoes_processuais"
  ADD COLUMN IF NOT EXISTS "complementos"   JSONB,
  ADD COLUMN IF NOT EXISTS "detalhe"        TEXT,
  ADD COLUMN IF NOT EXISTS "conteudo"       TEXT,
  ADD COLUMN IF NOT EXISTS "orgao_julgador" TEXT;

-- 3) Log das chamadas ao DataJud
DO $$ BEGIN
  CREATE TYPE "OrigemSincronizacao" AS ENUM ('IMPORTACAO', 'MANUAL', 'CRON');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "logs_sincronizacao_datajud" (
    "id" TEXT NOT NULL,
    "processo_id" TEXT,
    "numero_cnj" TEXT NOT NULL,
    "tribunal" TEXT,
    "origem" "OrigemSincronizacao" NOT NULL,
    "sucesso" BOOLEAN NOT NULL,
    "http_status" INTEGER,
    "mensagem_erro" TEXT,
    "novas_movimentacoes" INTEGER NOT NULL DEFAULT 0,
    "duracao_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "logs_sincronizacao_datajud_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "logs_sincronizacao_datajud_processo_id_idx"
  ON "logs_sincronizacao_datajud"("processo_id");
CREATE INDEX IF NOT EXISTS "logs_sincronizacao_datajud_created_at_idx"
  ON "logs_sincronizacao_datajud"("created_at");
CREATE INDEX IF NOT EXISTS "logs_sincronizacao_datajud_sucesso_created_at_idx"
  ON "logs_sincronizacao_datajud"("sucesso", "created_at");

-- SetNull: apagar o processo não apaga a trilha de sincronização.
ALTER TABLE "logs_sincronizacao_datajud"
  DROP CONSTRAINT IF EXISTS "logs_sincronizacao_datajud_processo_id_fkey";
ALTER TABLE "logs_sincronizacao_datajud"
  ADD CONSTRAINT "logs_sincronizacao_datajud_processo_id_fkey"
  FOREIGN KEY ("processo_id") REFERENCES "processos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
