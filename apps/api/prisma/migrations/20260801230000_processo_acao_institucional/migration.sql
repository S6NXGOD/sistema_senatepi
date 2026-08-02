-- Ação coletiva/institucional no módulo de Processos.
--
-- O modal de importação passou a perguntar QUEM está no polo ativo, com três
-- caminhos: o próprio SENATEPI (ação coletiva), um ou mais filiados, ou uma
-- parte avulsa/indefinida. Só o primeiro precisava de estrutura nova.
--
-- NADA aqui é destrutivo: processos existentes continuam INDIVIDUAL, que é o
-- comportamento que sempre tiveram.

-- ---------------------------------------------------------------------------
-- 1) Natureza da ação
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TipoAcaoProcesso') THEN
    CREATE TYPE "TipoAcaoProcesso" AS ENUM ('INDIVIDUAL', 'INSTITUCIONAL');
  END IF;
END $$;

-- Sem índice de propósito: a coluna tem dois valores, e um índice de
-- cardinalidade tão baixa não seria usado pelo planejador.
ALTER TABLE "processos"
  ADD COLUMN IF NOT EXISTS "tipo_acao" "TipoAcaoProcesso" NOT NULL DEFAULT 'INDIVIDUAL';

-- ---------------------------------------------------------------------------
-- 2) A parte que é o PRÓPRIO sindicato
--
-- O polo ativo institucional é uma ParteProcesso normal, ligada a uma
-- ParteExterna — e não um caso especial espalhado pelo código. Assim ela aparece
-- na aba Partes, conta participações e é editável como qualquer outra.
--
-- A flag (em vez de um UUID chumbado no código) permite corrigir razão social e
-- CNPJ pela tela sem quebrar a importação.
-- ---------------------------------------------------------------------------
ALTER TABLE "partes_externas"
  ADD COLUMN IF NOT EXISTS "institucional" BOOLEAN NOT NULL DEFAULT false;

-- Só pode haver UMA parte institucional.
CREATE UNIQUE INDEX IF NOT EXISTS "partes_externas_institucional_key"
  ON "partes_externas"("institucional") WHERE "institucional" = true;

-- Semeia o SENATEPI. O CNPJ fica NULO de propósito: preenchê-lo com um número
-- inventado seria pior do que deixar em branco — a secretaria completa pela
-- tela de Partes, e o índice único de documento não é violado por NULL.
INSERT INTO "partes_externas" ("id", "tipo", "nome", "nome_fantasia", "institucional", "ativo", "created_at", "updated_at")
SELECT gen_random_uuid()::text,
       'JURIDICA',
       'SINDICATO DOS ENFERMEIROS E TÉCNICOS DE ENFERMAGEM DO ESTADO DO PIAUÍ',
       'SENATEPI',
       true,
       true,
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP
 WHERE NOT EXISTS (SELECT 1 FROM "partes_externas" WHERE "institucional" = true);
