-- Link de recadastramento ONLINE (o filiado atualiza o próprio cadastro).
--
-- NÃO-DESTRUTIVA: enum e tabela novos. Nada existente é alterado — o
-- recadastramento presencial continua funcionando como está.

DO $$ BEGIN
  CREATE TYPE "DesafioRecadastramento" AS ENUM ('CPF_NASCIMENTO', 'COREN', 'NENHUM');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "links_recadastramento" (
    "id" TEXT NOT NULL,
    "filiado_id" TEXT NOT NULL,
    -- Só o HASH do token: quem lê o banco não consegue abrir o link de ninguém.
    "token_hash" TEXT NOT NULL,
    "desafio" "DesafioRecadastramento" NOT NULL,
    "expira_em" TIMESTAMP(3) NOT NULL,
    "usado_em" TIMESTAMP(3),
    "revogado_em" TIMESTAMP(3),
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "criado_por" TEXT,
    "ip_ultimo_acesso" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "links_recadastramento_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "links_recadastramento_token_hash_key"
  ON "links_recadastramento"("token_hash");
CREATE INDEX IF NOT EXISTS "links_recadastramento_filiado_id_idx"
  ON "links_recadastramento"("filiado_id");
CREATE INDEX IF NOT EXISTS "links_recadastramento_expira_em_idx"
  ON "links_recadastramento"("expira_em");

ALTER TABLE "links_recadastramento"
  DROP CONSTRAINT IF EXISTS "links_recadastramento_filiado_id_fkey";
ALTER TABLE "links_recadastramento"
  ADD CONSTRAINT "links_recadastramento_filiado_id_fkey"
  FOREIGN KEY ("filiado_id") REFERENCES "filiados"("id") ON DELETE CASCADE ON UPDATE CASCADE;
