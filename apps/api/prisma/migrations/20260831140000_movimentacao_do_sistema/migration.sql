-- A NOTA FOI ESCRITA POR UMA PESSOA OU PELO ROBÔ?
--
-- O DEFEITO, visto na tela e medido em 31/08/2026. O chip "Com movimentação
-- recente · 7 dias" devolvia SEIS processos — e a coluna "Última movimentação"
-- mostrava "há 5 meses", "há 3 meses", "há 1 ano". Dois deles apareciam como
-- ARQUIVADO. Um filtro de sete dias trazendo processo parado há um ano parece,
-- com razão, quebrado.
--
-- A CAUSA: o filtro casava `movimentacoes_internas.created_at`, e QUATRO das
-- notas recentes eram do próprio sistema — "Processo encerrado automaticamente:
-- todas as instâncias receberam baixa". Ou seja: o chip de ATIVIDADE acendia
-- justamente quando o robô ARQUIVAVA o processo. O oposto exato do que promete.
--
-- E CONTAMINOU A ORDENAÇÃO TAMBÉM. `processos.ultimo_movimento_em` é mantida
-- por gatilho a cada nota interna inserida, sem distinguir origem — então esses
-- mesmos quatro processos subiam ao TOPO de "Movimentação recente" no dia em
-- que o robô os encerrou. Medido: 4 dos 47 estavam no topo por isso.
--
-- POR QUE UMA COLUNA, E NÃO `autor_id IS NULL`
-- Hoje o sinal coincide (as quatro notas sem autor são todas do robô, conferido
-- uma a uma), mas ele é ACIDENTE: qualquer caminho humano que chegue sem
-- `ctx.userId` grava autor nulo e passaria a contar como sistema. Uma coluna
-- explícita diz o que é, em vez de deixar a intenção depender de um campo que
-- existe para outra coisa.
--
-- SEGURANÇA NA JANELA DE TROCA: `NOT NULL` COM DEFAULT — o contêiner antigo não
-- conhece a coluna e seus INSERTs continuam válidos, porque o banco preenche o
-- default. A ordem importa: a coluna nasce com default ANTES de qualquer outra
-- coisa, então não há instante em que uma escrita antiga falharia.

-- ------------------------------------------------------------------- coluna
ALTER TABLE "movimentacoes_internas"
  ADD COLUMN IF NOT EXISTS "origem_sistema" BOOLEAN NOT NULL DEFAULT false;

-- ----------------------------------------------------------------- backfill
-- As que já existem: sem autor E declarando mudança de status é exatamente o
-- que `reavaliarStatusPorInstancias` grava (encerramento e reabertura
-- automáticos). Conferido na produção: quatro linhas, todas
-- "Processo encerrado automaticamente…".
UPDATE "movimentacoes_internas"
SET "origem_sistema" = true
WHERE "autor_id" IS NULL AND "status_novo" IS NOT NULL;

-- Consulta do filtro: "houve nota HUMANA na janela?" — sem índice ela varre a
-- tabela a cada clique no chip.
CREATE INDEX IF NOT EXISTS "movimentacoes_internas_origem_sistema_idx"
  ON "movimentacoes_internas" ("processo_id", "origem_sistema", "created_at");

-- ------------------------------------------------------------------ gatilho
-- O gatilho de `ultimo_movimento_em` passa a IGNORAR a nota do sistema.
--
-- "Quando este processo andou pela última vez" não pode ser respondido pelo dia
-- em que o robô o arquivou: arquivar não é andar. A função é substituída
-- inteira (CREATE OR REPLACE) e os gatilhos continuam apontando para ela — não
-- é preciso recriá-los.
CREATE OR REPLACE FUNCTION senatepi_ultimo_movimento_do_processo()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $trg$
DECLARE
  quando TIMESTAMP(3);
BEGIN
  IF TG_TABLE_NAME = 'movimentacoes_internas' THEN
    -- Papelada do robô não conta como andamento do processo.
    IF NEW."origem_sistema" THEN
      RETURN NEW;
    END IF;
    quando := COALESCE(NEW."data_fato", NEW."created_at");
  ELSE
    quando := NEW."data_movimento";
  END IF;

  UPDATE "processos"
  SET "ultimo_movimento_em" = GREATEST(COALESCE("ultimo_movimento_em", quando), quando)
  WHERE "id" = NEW."processo_id"
    AND ("ultimo_movimento_em" IS NULL OR "ultimo_movimento_em" < quando);

  RETURN NEW;
END;
$trg$;

-- --------------------------------------------------------------- recalculo
-- A coluna já está contaminada pelas notas do robô, e o gatilho só avança —
-- ele nunca corrigiria sozinho um valor alto demais. Aqui ela é REESCRITA do
-- zero, com a regra nova, para todo o acervo.
--
-- `ultimo_movimento_em` pode virar NULL num processo que só tinha nota do
-- sistema: é o certo. A ordenação usa NULLS LAST e ele cai para o fim, que é
-- onde um processo sem andamento nenhum deve estar.
UPDATE "processos" p
SET "ultimo_movimento_em" = sub.quando
FROM (
  SELECT pr."id", (
    SELECT MAX(quando) FROM (
      SELECT "data_movimento" AS quando
        FROM "movimentacoes_processuais" WHERE "processo_id" = pr."id"
      UNION ALL
      SELECT COALESCE("data_fato", "created_at") AS quando
        FROM "movimentacoes_internas"
        WHERE "processo_id" = pr."id" AND "origem_sistema" = false
    ) t
  ) AS quando
  FROM "processos" pr
) sub
WHERE p."id" = sub."id"
  AND p."ultimo_movimento_em" IS DISTINCT FROM sub.quando;
