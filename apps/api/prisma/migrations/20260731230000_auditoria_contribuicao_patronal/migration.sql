-- Conferência das contribuições patronais pelo sindicato.
-- NÃO-DESTRUTIVA: só acrescenta colunas opcionais e as chaves estrangeiras.

ALTER TABLE "contribuicoes_patronais" ADD COLUMN IF NOT EXISTS "motivo_rejeicao"  TEXT;
ALTER TABLE "contribuicoes_patronais" ADD COLUMN IF NOT EXISTS "analisado_em"     TIMESTAMP(3);
ALTER TABLE "contribuicoes_patronais" ADD COLUMN IF NOT EXISTS "analisado_por"    TEXT;
ALTER TABLE "contribuicoes_patronais" ADD COLUMN IF NOT EXISTS "movimentacao_id"  TEXT;

-- Uma movimentação de caixa pertence a UMA contribuição: a unicidade é o que
-- impede lançar o mesmo valor duas vezes se a homologação for repetida.
CREATE UNIQUE INDEX IF NOT EXISTS "contribuicoes_patronais_movimentacao_id_key"
  ON "contribuicoes_patronais" ("movimentacao_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contribuicoes_patronais_analisado_por_fkey'
  ) THEN
    ALTER TABLE "contribuicoes_patronais"
      ADD CONSTRAINT "contribuicoes_patronais_analisado_por_fkey"
      FOREIGN KEY ("analisado_por") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contribuicoes_patronais_movimentacao_id_fkey'
  ) THEN
    ALTER TABLE "contribuicoes_patronais"
      ADD CONSTRAINT "contribuicoes_patronais_movimentacao_id_fkey"
      FOREIGN KEY ("movimentacao_id") REFERENCES "movimentacoes"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
