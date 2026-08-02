-- Automação de prazos: marca os compromissos criados pelo robô a partir das
-- movimentações do DataJud, para a interface exibir o selo "Criado pelo Sistema".
--
-- NÃO-DESTRUTIVA: uma coluna booleana com default false, então todo compromisso
-- existente continua sendo "criado por humano" sem precisar de backfill.

ALTER TABLE "compromissos"
  ADD COLUMN IF NOT EXISTS "origem_automatica" BOOLEAN NOT NULL DEFAULT false;

-- Suporta a listagem "o que o robô criou" sem varrer a tabela inteira.
CREATE INDEX IF NOT EXISTS "compromissos_origem_automatica_idx"
  ON "compromissos"("origem_automatica");
