-- QUANDO ESTE PROCESSO ANDOU PELA ÚLTIMA VEZ.
--
-- POR QUE A COLUNA EXISTE
-- A listagem ordenava por `ultima_sincronizacao`, que é o carimbo de quando o
-- ROBÔ falou com o CNJ — não de quando o processo se moveu. Como a varredura
-- noturna reescreve esse carimbo em TODO o acervo na mesma madrugada, os
-- valores se agrupam na janela de execução do cron e a "ordem por mais
-- recente" acabava sendo a ordem em que o robô terminou cada um. Ou seja:
-- ruído. O processo que recebeu sentença ontem podia aparecer na página 3.
--
-- POR QUE UMA COLUNA, E NÃO UM `max()` NA CONSULTA
-- A ordenação tem de acontecer no banco, ANTES da paginação — senão a página 1
-- traz dez linhas quaisquer e as ordena entre si. O Prisma sabe ordenar por
-- `_count` de uma relação, mas não por `max()` de um campo dela, e reescrever a
-- listagem inteira em SQL cru trocaria um problema por outro: os filtros dela
-- são montados dinamicamente e são muitos.
--
-- POR QUE GATILHO, E NÃO CÓDIGO NO SERVIÇO
-- Coluna derivada mantida à mão é coluna que desincroniza. Este arquivo escreve
-- em `movimentacoes_processuais` a partir de três caminhos (importação,
-- sincronização manual, varredura noturna) e em `movimentacoes_internas` a
-- partir do registro de andamento — cinco lugares para lembrar, e basta um
-- esquecer para a lista mentir de novo. O gatilho vale para qualquer origem,
-- inclusive um UPDATE feito à mão no banco.
--
-- A REGRA DA DATA acompanha a da linha do tempo: movimentação interna vale por
-- `data_fato` quando ela existe, e por `created_at` quando não — é o que faz um
-- andamento registrado hoje sobre um fato de semana passada contar como fato de
-- semana passada, e não como novidade de hoje.
--
-- SEGURANÇA NA JANELA DE TROCA: puramente aditivo. O contêiner antigo não
-- conhece a coluna e o Prisma lista as colunas explicitamente em todo SELECT,
-- então ele não a vê e não quebra; os INSERTs dele disparam o gatilho e
-- alimentam a coluna que só o contêiner novo vai ler.

-- ---------------------------------------------------------------- coluna
ALTER TABLE "processos"
  ADD COLUMN IF NOT EXISTS "ultimo_movimento_em" TIMESTAMP(3);

-- Índice com a MESMA direção da consulta (DESC NULLS LAST). Um índice ASC
-- serviria para ordenar, mas o planejador precisaria varrer ao contrário para
-- os NULLs caírem no fim; declarar igual à cláusula deixa o índice utilizável
-- direto.
--
-- SEM `CONCURRENTLY`, e não por descuido: o Prisma envolve cada migração numa
-- transação, e `CREATE INDEX CONCURRENTLY` é proibido dentro de uma. O custo
-- disso é um bloqueio de ESCRITA em `processos` enquanto o índice é construído
-- — com 41 processos, tempo imperceptível. Se um dia o acervo passar da casa
-- das dezenas de milhares, um índice novo aqui terá de sair da migração e ser
-- criado à mão, fora de transação, antes do deploy.
CREATE INDEX IF NOT EXISTS "processos_ultimo_movimento_em_idx"
  ON "processos" ("ultimo_movimento_em" DESC NULLS LAST);

-- ---------------------------------------------------------------- backfill
-- Uma vez, para o acervo que já existe. Sem isto toda a lista nasceria com a
-- coluna nula e a ordenação cairia no critério de desempate até que cada
-- processo recebesse um andamento novo — o que, para um processo dormente,
-- pode levar meses.
UPDATE "processos" p
SET "ultimo_movimento_em" = sub.quando
FROM (
  SELECT "processo_id", MAX(quando) AS quando
  FROM (
    SELECT "processo_id", "data_movimento" AS quando
      FROM "movimentacoes_processuais"
    UNION ALL
    SELECT "processo_id", COALESCE("data_fato", "created_at") AS quando
      FROM "movimentacoes_internas"
  ) t
  GROUP BY "processo_id"
) sub
WHERE p."id" = sub."processo_id"
  AND p."ultimo_movimento_em" IS DISTINCT FROM sub.quando;

-- ---------------------------------------------------------------- gatilhos
-- SÓ AVANÇA. `GREATEST` com o valor atual impede que a chegada de um andamento
-- ANTIGO (o backfill de uma instância recém-descoberta, que traz a história
-- inteira de um grau novo) puxe o processo para trás e o faça parecer parado.
-- Em 25/08/2026 isso aconteceu de verdade: 51 instâncias novas despejaram 2.033
-- movimentos históricos de uma vez.
CREATE OR REPLACE FUNCTION senatepi_ultimo_movimento_do_processo()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $trg$
DECLARE
  quando TIMESTAMP(3);
BEGIN
  IF TG_TABLE_NAME = 'movimentacoes_internas' THEN
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

DROP TRIGGER IF EXISTS "trg_ultimo_movimento_datajud" ON "movimentacoes_processuais";
CREATE TRIGGER "trg_ultimo_movimento_datajud"
  AFTER INSERT ON "movimentacoes_processuais"
  FOR EACH ROW
  EXECUTE FUNCTION senatepi_ultimo_movimento_do_processo();

DROP TRIGGER IF EXISTS "trg_ultimo_movimento_interno" ON "movimentacoes_internas";
CREATE TRIGGER "trg_ultimo_movimento_interno"
  AFTER INSERT ON "movimentacoes_internas"
  FOR EACH ROW
  EXECUTE FUNCTION senatepi_ultimo_movimento_do_processo();
