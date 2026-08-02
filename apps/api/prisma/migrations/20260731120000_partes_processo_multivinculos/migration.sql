-- PARTES DO PROCESSO (polo ativo × polo passivo) + MULTIVINCULAÇÃO de filiados
-- e advogados + DATA DO FATO na movimentação interna.
--
-- CONTEXTO: a API Pública do DataJud (CNJ) NÃO devolve as partes do processo —
-- verificado nos índices de TJPI, TRT22, TJSP e TRF1, cujo `_source` só traz
-- classe, assunto, órgão julgador, assuntos e movimentos. É decisão do CNJ por
-- LGPD. Portanto "quem processou quem" é dado NOSSO, preenchido pela equipe.
--
-- NÃO-DESTRUTIVA: só cria tabelas/colunas novas e faz BACKFILL dos vínculos
-- 1:1 que já existiam (`processos.filiado_id` e `processos.advogado_id`), que
-- passam a ser atalhos denormalizados para a linha `principal` das novas
-- tabelas. Nenhuma coluna é removida e nada existente é reescrito.

-- ---------------------------------------------------------------------------
-- 1) Enums
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE "PoloProcesso" AS ENUM ('ATIVO', 'PASSIVO', 'TERCEIRO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "TipoParteExterna" AS ENUM ('FISICA', 'JURIDICA', 'ORGAO_PUBLICO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 2) Cadastro de partes externas (empresa ré, município, pessoa física, o
--    próprio sindicato quando é autor). Opcional: a parte pode viver só com o
--    nome digitado e ser promovida a cadastro depois.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "partes_externas" (
    "id" TEXT NOT NULL,
    "tipo" "TipoParteExterna" NOT NULL,
    "nome" TEXT NOT NULL,
    "nome_fantasia" TEXT,
    "documento" TEXT,
    "email" TEXT,
    "telefone" TEXT,
    "cidade" TEXT,
    "uf" TEXT,
    "observacoes" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "partes_externas_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "partes_externas_tipo_idx" ON "partes_externas"("tipo");
CREATE INDEX IF NOT EXISTS "partes_externas_ativo_idx" ON "partes_externas"("ativo");

-- CPF/CNPJ é único QUANDO informado. Índice parcial: vários cadastros sem
-- documento continuam permitidos (parte conhecida só pelo nome).
CREATE UNIQUE INDEX IF NOT EXISTS "partes_externas_documento_key"
  ON "partes_externas"("documento") WHERE "documento" IS NOT NULL;

-- Busca por nome sem diferenciar maiúsculas ("prontocare" acha "PRONTOCARE").
CREATE INDEX IF NOT EXISTS "partes_externas_nome_lower_idx"
  ON "partes_externas"(LOWER("nome"));

-- ---------------------------------------------------------------------------
-- 3) Partes do processo (uma linha por parte, em um polo)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "partes_processo" (
    "id" TEXT NOT NULL,
    "processo_id" TEXT NOT NULL,
    "polo" "PoloProcesso" NOT NULL,
    "papel" TEXT,
    "principal" BOOLEAN NOT NULL DEFAULT false,
    -- Snapshot de como a parte consta nos autos: sempre preenchido, para que
    -- excluir um filiado/cadastro não apague a história do processo.
    "nome" TEXT NOT NULL,
    "documento" TEXT,
    -- Enriquecimentos opcionais e mutuamente exclusivos.
    "filiado_id" TEXT,
    "parte_externa_id" TEXT,
    "advogados" JSONB,
    "observacao" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "partes_processo_pkey" PRIMARY KEY ("id"),
    -- Uma parte é um filiado OU um cadastro externo OU nenhum dos dois (texto
    -- livre) — nunca os dois ao mesmo tempo.
    CONSTRAINT "partes_processo_vinculo_exclusivo_check"
      CHECK ("filiado_id" IS NULL OR "parte_externa_id" IS NULL)
);

CREATE INDEX IF NOT EXISTS "partes_processo_processo_id_polo_idx"
  ON "partes_processo"("processo_id", "polo");
CREATE INDEX IF NOT EXISTS "partes_processo_filiado_id_idx" ON "partes_processo"("filiado_id");
CREATE INDEX IF NOT EXISTS "partes_processo_parte_externa_id_idx"
  ON "partes_processo"("parte_externa_id");

-- O mesmo filiado / a mesma parte externa não entram duas vezes no processo.
CREATE UNIQUE INDEX IF NOT EXISTS "partes_processo_processo_filiado_key"
  ON "partes_processo"("processo_id", "filiado_id") WHERE "filiado_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "partes_processo_processo_externa_key"
  ON "partes_processo"("processo_id", "parte_externa_id") WHERE "parte_externa_id" IS NOT NULL;

-- No máximo UMA parte principal por polo — é ela que forma o "Autor × Réu".
CREATE UNIQUE INDEX IF NOT EXISTS "partes_processo_principal_por_polo_key"
  ON "partes_processo"("processo_id", "polo") WHERE "principal";

ALTER TABLE "partes_processo"
  DROP CONSTRAINT IF EXISTS "partes_processo_processo_id_fkey";
ALTER TABLE "partes_processo"
  ADD CONSTRAINT "partes_processo_processo_id_fkey"
  FOREIGN KEY ("processo_id") REFERENCES "processos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SetNull nos vínculos: apagar o filiado ou o cadastro externo NÃO apaga a
-- parte — o nome dos autos permanece.
ALTER TABLE "partes_processo"
  DROP CONSTRAINT IF EXISTS "partes_processo_filiado_id_fkey";
ALTER TABLE "partes_processo"
  ADD CONSTRAINT "partes_processo_filiado_id_fkey"
  FOREIGN KEY ("filiado_id") REFERENCES "filiados"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "partes_processo"
  DROP CONSTRAINT IF EXISTS "partes_processo_parte_externa_id_fkey";
ALTER TABLE "partes_processo"
  ADD CONSTRAINT "partes_processo_parte_externa_id_fkey"
  FOREIGN KEY ("parte_externa_id") REFERENCES "partes_externas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 4) Advogados da casa que atuam no processo (N:N)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "processos_advogados" (
    "processo_id" TEXT NOT NULL,
    "advogado_id" TEXT NOT NULL,
    "principal" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "processos_advogados_pkey" PRIMARY KEY ("processo_id", "advogado_id")
);

CREATE INDEX IF NOT EXISTS "processos_advogados_advogado_id_idx"
  ON "processos_advogados"("advogado_id");

-- No máximo um responsável por processo.
CREATE UNIQUE INDEX IF NOT EXISTS "processos_advogados_principal_key"
  ON "processos_advogados"("processo_id") WHERE "principal";

ALTER TABLE "processos_advogados"
  DROP CONSTRAINT IF EXISTS "processos_advogados_processo_id_fkey";
ALTER TABLE "processos_advogados"
  ADD CONSTRAINT "processos_advogados_processo_id_fkey"
  FOREIGN KEY ("processo_id") REFERENCES "processos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "processos_advogados"
  DROP CONSTRAINT IF EXISTS "processos_advogados_advogado_id_fkey";
ALTER TABLE "processos_advogados"
  ADD CONSTRAINT "processos_advogados_advogado_id_fkey"
  FOREIGN KEY ("advogado_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 5) BACKFILL — os vínculos 1:1 que já existiam viram a linha `principal`
--    das tabelas novas. Idempotente (ON CONFLICT / NOT EXISTS).
-- ---------------------------------------------------------------------------

-- 5a) Filiado vinculado → parte principal do POLO ATIVO.
--     Premissa: quando o sindicato cadastrou um filiado no processo, ele é o
--     autor/reclamante. Se em algum caso for o contrário, a equipe corrige o
--     polo na tela — o dado não se perde.
INSERT INTO "partes_processo"
  ("id", "processo_id", "polo", "papel", "principal", "nome", "documento", "filiado_id", "updated_at")
SELECT
  gen_random_uuid()::TEXT,
  p."id",
  'ATIVO'::"PoloProcesso",
  'Autor',
  true,
  f."nome_completo",
  f."cpf",
  f."id",
  CURRENT_TIMESTAMP
FROM "processos" p
JOIN "filiados" f ON f."id" = p."filiado_id"
WHERE p."filiado_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "partes_processo" pp
    WHERE pp."processo_id" = p."id" AND pp."filiado_id" = p."filiado_id"
  );

-- 5b) Advogado responsável → linha principal em processos_advogados.
INSERT INTO "processos_advogados" ("processo_id", "advogado_id", "principal")
SELECT p."id", p."advogado_id", true
FROM "processos" p
WHERE p."advogado_id" IS NOT NULL
ON CONFLICT ("processo_id", "advogado_id") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6) DATA DO FATO na movimentação interna
--
--    A data da movimentação era sempre a do REGISTRO: o advogado que lançasse
--    na sexta uma audiência ocorrida na quarta via a data errada na timeline.
--    `created_at` continua intocado (carimbo de auditoria, "registrado em") e a
--    ordenação passa a usar COALESCE(data_fato, created_at).
-- ---------------------------------------------------------------------------

ALTER TABLE "movimentacoes_internas"
  ADD COLUMN IF NOT EXISTS "data_fato" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "movimentacoes_internas_processo_id_data_fato_idx"
  ON "movimentacoes_internas"("processo_id", "data_fato");
