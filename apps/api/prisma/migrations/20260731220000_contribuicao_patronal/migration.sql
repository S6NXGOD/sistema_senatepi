-- Contribuição patronal declarada pela empresa no Portal.
-- NÃO-DESTRUTIVA: cria um enum e uma tabela novos; nada existente é alterado.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StatusContribuicaoPatronal') THEN
    CREATE TYPE "StatusContribuicaoPatronal" AS ENUM (
      'AGUARDANDO', 'EM_ANALISE', 'HOMOLOGADA', 'REJEITADA'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "contribuicoes_patronais" (
  "id"                        TEXT                         NOT NULL,
  "empresa_id"                TEXT                         NOT NULL,
  "mes_referencia"            TEXT                         NOT NULL,
  "valor_declarado"           DECIMAL(12,2)                NOT NULL,
  "status"                    "StatusContribuicaoPatronal" NOT NULL DEFAULT 'AGUARDANDO',
  -- Guardam a CHAVE no storage, não uma URL pública: a relação de
  -- trabalhadores tem dados pessoais de terceiros e só é servida por URL
  -- assinada de curta duração (LGPD, Lei nº 13.709/2018).
  "url_comprovante_pix"       TEXT,
  "url_relacao_trabalhadores" TEXT,
  "enviado_em"                TIMESTAMP(3),
  "created_at"                TIMESTAMP(3)                 NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                TIMESTAMP(3)                 NOT NULL,

  CONSTRAINT "contribuicoes_patronais_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "contribuicoes_patronais_empresa_mes_idx"
  ON "contribuicoes_patronais" ("empresa_id", "mes_referencia");
CREATE INDEX IF NOT EXISTS "contribuicoes_patronais_status_idx"
  ON "contribuicoes_patronais" ("status");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contribuicoes_patronais_empresa_id_fkey'
  ) THEN
    ALTER TABLE "contribuicoes_patronais"
      ADD CONSTRAINT "contribuicoes_patronais_empresa_id_fkey"
      FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
