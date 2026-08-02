-- AGENDA: desfecho da conclusão, motivo obrigatório no cancelamento, contagem de
-- remarcações e FK do criador (para exibir a FOTO de quem registrou a demanda).
-- PROCESSOS: status RASCUNHO e NPU opcional, para a consulta virar processo antes
-- de estar distribuída.
--
-- NÃO-DESTRUTIVA: só adiciona enums/colunas e relaxa uma restrição (numero_cnj
-- deixa de ser NOT NULL). Nenhuma coluna é removida e nenhum dado é reescrito,
-- exceto a limpeza de `criado_por` órfão descrita no passo 3 — necessária para a
-- FK poder existir.

-- ---------------------------------------------------------------------------
-- 1) Desfecho da atividade
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE "DesfechoCompromisso" AS ENUM (
    'DUVIDA_ESCLARECIDA', 'REALIZADO', 'VINCULADO_PROCESSO',
    'PROCESSO_CRIADO', 'NAO_COMPARECEU', 'OUTRO'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "compromissos"
  ADD COLUMN IF NOT EXISTS "desfecho" "DesfechoCompromisso",
  ADD COLUMN IF NOT EXISTS "desfecho_obs" TEXT,
  ADD COLUMN IF NOT EXISTS "concluido_em" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "concluido_por" TEXT,
  ADD COLUMN IF NOT EXISTS "cancelado_motivo" TEXT,
  ADD COLUMN IF NOT EXISTS "cancelado_em" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancelado_por" TEXT,
  ADD COLUMN IF NOT EXISTS "remarcacoes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "remarcado_motivo" TEXT;

-- 1a) Eventos JÁ concluídos antes desta migração não têm desfecho registrado.
--     Carimbamos `concluido_em` com o `updated_at` (a melhor aproximação que
--     existe) e deixamos `desfecho` NULO de propósito: inventar um resultado
--     seria pior que admitir que ele não foi informado. A tela mostra
--     "desfecho não informado" nesses casos.
UPDATE "compromissos"
   SET "concluido_em" = "updated_at"
 WHERE "status" = 'CONCLUIDO' AND "concluido_em" IS NULL;

-- 1b) Mesma ideia para os cancelados: sabemos QUANDO, não sabemos POR QUÊ.
UPDATE "compromissos"
   SET "cancelado_em" = "updated_at"
 WHERE "status" = 'CANCELADO' AND "cancelado_em" IS NULL;

-- 1c) Remarcações antigas: quem tem `data_original` foi remarcado ao menos 1 vez.
UPDATE "compromissos"
   SET "remarcacoes" = 1
 WHERE "data_original" IS NOT NULL AND "remarcacoes" = 0;

-- ---------------------------------------------------------------------------
-- 2) Índice do criador
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS "compromissos_criado_por_idx" ON "compromissos"("criado_por");

-- ---------------------------------------------------------------------------
-- 3) FK de `criado_por` → users
--
--    A coluna já guardava o id do usuário, mas sem FK: nada garantia que o id
--    ainda existisse. Antes de criar a restrição, anulamos as referências
--    órfãs (usuários excluídos) — sem isso o ALTER falharia. É a única escrita
--    destrutiva da migração, e ela apaga apenas ponteiros já quebrados.
-- ---------------------------------------------------------------------------

UPDATE "compromissos"
   SET "criado_por" = NULL
 WHERE "criado_por" IS NOT NULL
   AND "criado_por" NOT IN (SELECT "id" FROM "users");

ALTER TABLE "compromissos" DROP CONSTRAINT IF EXISTS "compromissos_criado_por_fkey";
ALTER TABLE "compromissos"
  ADD CONSTRAINT "compromissos_criado_por_fkey"
  FOREIGN KEY ("criado_por") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 4) PROCESSOS: NPU opcional (o valor de enum RASCUNHO veio na migração anterior,
--    porque o Postgres não permite usá-lo na transação em que é criado)
-- ---------------------------------------------------------------------------

-- O NPU passa a aceitar NULL (só rascunhos). O índice UNIQUE já existente
-- continua valendo: no Postgres, vários NULLs não colidem entre si, então dois
-- rascunhos coexistem e dois processos formalizados seguem impedidos de repetir
-- o mesmo número.
ALTER TABLE "processos" ALTER COLUMN "numero_cnj" DROP NOT NULL;

-- Rótulo do rascunho enquanto não há classe processual vinda do CNJ.
ALTER TABLE "processos" ADD COLUMN IF NOT EXISTS "titulo" TEXT;

-- Rastreabilidade "esta consulta virou este processo" (1:1).
ALTER TABLE "processos" ADD COLUMN IF NOT EXISTS "origem_compromisso_id" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "processos_origem_compromisso_id_key"
  ON "processos"("origem_compromisso_id");

ALTER TABLE "processos" DROP CONSTRAINT IF EXISTS "processos_origem_compromisso_id_fkey";
ALTER TABLE "processos"
  ADD CONSTRAINT "processos_origem_compromisso_id_fkey"
  FOREIGN KEY ("origem_compromisso_id") REFERENCES "compromissos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Um processo COM número tem de ter os 20 dígitos; sem número, só se for
-- rascunho. A regra vive no banco porque é a garantia de que nenhum caminho
-- (importação, desfecho, formalização) crie um processo formalizado sem NPU.
ALTER TABLE "processos" DROP CONSTRAINT IF EXISTS "processos_npu_obrigatorio_check";
ALTER TABLE "processos"
  ADD CONSTRAINT "processos_npu_obrigatorio_check"
  CHECK ("numero_cnj" IS NOT NULL OR "status_interno" = 'RASCUNHO');
