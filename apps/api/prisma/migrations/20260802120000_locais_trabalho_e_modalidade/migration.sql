-- Locais de trabalho ricos + modalidade de contribuição.
--
-- O vínculo já era uma LISTA (um filiado podia ter vários locais), mas era
-- pobre: empregador em texto livre, sem cargo padronizado e sem dizer em qual
-- folha a mensalidade é descontada. Faltava o dado que o financeiro precisa.
--
-- Tudo ADITIVO. Nenhuma coluna sai, nenhum registro é reescrito.

-- ---------------------------------------------------------------------------
-- 1) Modalidade de contribuição (no filiado)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ModalidadeContribuicao') THEN
    CREATE TYPE "ModalidadeContribuicao" AS ENUM ('DESCONTO_FOLHA', 'AVULSO', 'PENSIONISTA');
  END IF;
END $$;

-- NULO nos 7 mil cadastros históricos, de propósito: o dado nunca foi coletado,
-- e chutar "AVULSO" para todo mundo seria inventar informação financeira.
ALTER TABLE "filiados"
  ADD COLUMN IF NOT EXISTS "modalidade_contribuicao" "ModalidadeContribuicao";

-- ---------------------------------------------------------------------------
-- 2) Local de trabalho: vínculo com o cadastro de organizações + desconto
--
-- O empregador aponta para `partes_externas` — a MESMA tabela das partes de
-- processo. Não é economia de tabela: a FMS que emprega o filiado é a mesma FMS
-- que figura como ré, e separá-las em dois cadastros criaria o problema que
-- "Cadastros Base" já tinha (a mesma entidade em dois lugares, divergindo).
-- ---------------------------------------------------------------------------
ALTER TABLE "vinculos_profissionais"
  ADD COLUMN IF NOT EXISTS "parte_externa_id"  TEXT,
  ADD COLUMN IF NOT EXISTS "desconto_em_folha" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "vinculos_profissionais_parte_externa_idx"
  ON "vinculos_profissionais"("parte_externa_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vinculos_profissionais_parte_externa_id_fkey') THEN
    ALTER TABLE "vinculos_profissionais"
      ADD CONSTRAINT "vinculos_profissionais_parte_externa_id_fkey"
      FOREIGN KEY ("parte_externa_id") REFERENCES "partes_externas"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3) Empregadores mais comuns da categoria, para o combobox já nascer útil
--
-- Sem CNPJ: preenchê-lo com número inventado seria pior do que deixar em
-- branco. A secretaria completa pela tela de Partes quando precisar.
-- ---------------------------------------------------------------------------
INSERT INTO "partes_externas" ("id", "tipo", "nome", "nome_fantasia", "cidade", "uf", "ativo", "institucional", "created_at", "updated_at")
SELECT gen_random_uuid()::text, v.tipo::"TipoParteExterna", v.nome, v.fantasia, 'Teresina', 'PI', true, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM (VALUES
    ('ORGAO_PUBLICO', 'FUNDAÇÃO MUNICIPAL DE SAÚDE DE TERESINA',            'FMS Teresina'),
    ('ORGAO_PUBLICO', 'SECRETARIA DE ESTADO DA SAÚDE DO PIAUÍ',             'SESAPI'),
    ('ORGAO_PUBLICO', 'HOSPITAL UNIVERSITÁRIO DA UFPI',                     'HU-UFPI'),
    ('ORGAO_PUBLICO', 'MATERNIDADE DONA EVANGELINA ROSA',                   'Maternidade Evangelina Rosa'),
    ('ORGAO_PUBLICO', 'HOSPITAL GETÚLIO VARGAS',                            'HGV'),
    ('ORGAO_PUBLICO', 'HOSPITAL DE URGÊNCIA DE TERESINA',                   'HUT'),
    ('ORGAO_PUBLICO', 'INSTITUTO DE DOENÇAS TROPICAIS NATAN PORTELLA',      'Natan Portella'),
    ('JURIDICA',      'PRONTOCARE',                                         'PRONTOCARE')
  ) AS v(tipo, nome, fantasia)
 WHERE NOT EXISTS (
   SELECT 1 FROM "partes_externas" pe WHERE upper(pe."nome") = upper(v.nome)
 );

-- ---------------------------------------------------------------------------
-- 4) NÃO tocamos nos 245 vínculos existentes.
--
-- 244 deles têm o empregador gravado como NÚMERO ('24', '14', '15'…), sem cargo
-- e sem matrícula — resíduo de uma importação em que a coluna errada da
-- planilha foi mapeada para `empresa`. Apagar sem saber o que aquele número
-- significa seria destruir um dado que talvez ainda dê para reconciliar.
--
-- Para limpar depois de confirmar que é lixo:
--   DELETE FROM "vinculos_profissionais" WHERE "empresa" ~ '^[0-9]+$';
-- ---------------------------------------------------------------------------
