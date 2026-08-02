-- Conclusão da atividade guiada pelo TIPO + linha do tempo da atividade.
--
-- Três mudanças, todas NÃO-DESTRUTIVAS:
--   1) `desfecho` deixa de ser enum e passa a slug em texto — os desfechos
--      variam por tipo de atividade e mudam com o uso. Mesma escolha já feita
--      para `tipo` quando os tipos de evento viraram cadastráveis.
--   2) o cancelamento ganha CATEGORIA. "Não compareceu" era desfecho, o que
--      contava como atividade realizada; passa a ser motivo de cancelamento.
--   3) nova tabela com o histórico de cada atividade.

-- 1) enum -> texto (preserva os valores já gravados: REALIZADO, OUTRO, etc.)
ALTER TABLE "compromissos"
  ALTER COLUMN "desfecho" TYPE TEXT USING "desfecho"::TEXT;

-- O enum antigo fica no banco: derrubá-lo é irreversível e ele não atrapalha.
-- Pode ser removido numa limpeza futura, depois que ninguém mais o referencie.

-- 2) categoria do cancelamento
ALTER TABLE "compromissos"
  ADD COLUMN IF NOT EXISTS "cancelado_categoria" TEXT;

-- Atividades já concluídas como "não compareceu" viram CANCELADAS: elas não
-- aconteceram, e mantê-las no bolo de "concluídas" distorce qualquer contagem.
UPDATE "compromissos"
   SET "status" = 'CANCELADO',
       "cancelado_categoria" = 'NAO_COMPARECEU',
       "cancelado_motivo" = COALESCE(
         NULLIF("cancelado_motivo", ''),
         CASE WHEN COALESCE("desfecho_obs", '') <> ''
              THEN 'Filiado não compareceu. ' || "desfecho_obs"
              ELSE 'Filiado não compareceu.' END
       ),
       "cancelado_em" = COALESCE("cancelado_em", "updated_at"),
       "desfecho" = NULL,
       "concluido_em" = NULL
 WHERE "desfecho" = 'NAO_COMPARECEU';

-- "Outro" não dizia nada além do que já estava na observação. Vira o desfecho
-- genérico (CONCLUIDA); a observação escrita continua intacta.
UPDATE "compromissos" SET "desfecho" = 'CONCLUIDA' WHERE "desfecho" = 'OUTRO';
-- "Realizado" é o mesmo desfecho genérico, com outro nome.
UPDATE "compromissos" SET "desfecho" = 'CONCLUIDA' WHERE "desfecho" = 'REALIZADO';

-- 3) histórico da atividade
CREATE TABLE IF NOT EXISTS "compromissos_historico" (
  "id"             TEXT         NOT NULL,
  "compromisso_id" TEXT         NOT NULL,
  "acao"           TEXT         NOT NULL,
  "descricao"      TEXT         NOT NULL,
  "autor_nome"     TEXT,
  "autor_id"       TEXT,
  "metadata"       JSONB,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "compromissos_historico_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "compromissos_historico_compromisso_idx"
  ON "compromissos_historico" ("compromisso_id", "created_at");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compromissos_historico_compromisso_id_fkey') THEN
    ALTER TABLE "compromissos_historico"
      ADD CONSTRAINT "compromissos_historico_compromisso_id_fkey"
      FOREIGN KEY ("compromisso_id") REFERENCES "compromissos"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compromissos_historico_autor_id_fkey') THEN
    ALTER TABLE "compromissos_historico"
      ADD CONSTRAINT "compromissos_historico_autor_id_fkey"
      FOREIGN KEY ("autor_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Semeia a linha do tempo do que já existe, para o detalhe não abrir vazio.
INSERT INTO "compromissos_historico" ("id", "compromisso_id", "acao", "descricao", "autor_nome", "autor_id", "created_at")
SELECT gen_random_uuid(), c."id", 'CRIADO', 'Atividade criada.', u."nome", c."criado_por", c."created_at"
  FROM "compromissos" c
  LEFT JOIN "users" u ON u."id" = c."criado_por"
 WHERE NOT EXISTS (
   SELECT 1 FROM "compromissos_historico" h WHERE h."compromisso_id" = c."id"
 );
