-- Busca de filiados que ignora acento, caixa e ordem das palavras.
--
-- O PROBLEMA
-- A busca era `ILIKE '%termo%'` sobre o nome. Caixa e trecho parcial já
-- funcionavam ("mirela", "MIRELA" e "Mire" achavam), mas duas coisas não:
--
--   1. ACENTO. 1.785 dos 7.179 nomes têm acento, e a base guarda a MESMA
--      pessoa grafada das duas formas: "ana celia" devolve 6 resultados e
--      "ana célia" devolve 16 — conjuntos diferentes. Quem digita de um jeito
--      nunca vê quem foi cadastrado do outro.
--
--   2. ORDEM DAS PALAVRAS. "mirela jesus" devolvia ZERO, mesmo existindo
--      MIRELA CARVALHO DE JESUS, porque o ILIKE procura a sequência literal.
--      Buscar por nome e sobrenome é o gesto mais natural que existe, e era
--      justamente o que não funcionava.
--
-- A SOLUÇÃO
-- Uma coluna com o texto já normalizado (minúsculo, sem acento, pontuação
-- virando espaço), mantida por gatilho, e a consulta exigindo que CADA palavra
-- digitada apareça nela. Assim "jesus mirela" acha, "MIRELA" acha, "mire" acha.

-- ---------------------------------------------------------------------------
-- 1) Normalizador
--
-- Usa translate() em vez da extensão `unaccent` de propósito: unaccent() é
-- STABLE (depende de um dicionário em disco), e função STABLE não pode ser
-- usada em índice nem em coluna gerada. translate() é IMMUTABLE, não exige
-- extensão nenhuma e cobre com folga o conjunto de acentos do português.
--
-- A pontuação vira ESPAÇO em vez de sumir: assim "SEN-2026-000129" produz
-- "sen 2026 000129", e tanto a matrícula inteira quanto o pedaço "000129"
-- encontram a pessoa.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION senatepi_normalizar_busca(txt TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT btrim(regexp_replace(
    regexp_replace(
      lower(translate(
        coalesce(txt, ''),
        'áàâãäÁÀÂÃÄéèêëÉÈÊËíìîïÍÌÎÏóòôõöÓÒÔÕÖúùûüÚÙÛÜçÇñÑýÿÝ',
        'aaaaaAAAAAeeeeEEEEiiiiIIIIoooooOOOOOuuuuUUUUcCnNyyY'
      )),
      '[^a-z0-9]+', ' ', 'g'
    ),
    '\s+', ' ', 'g'
  ));
$$;

-- ---------------------------------------------------------------------------
-- 2) Colunas normalizadas
--
-- São colunas COMUNS mantidas por gatilho, e não GENERATED ALWAYS, porque o
-- Prisma não conhece colunas geradas: um INSERT que as mencionasse quebraria
-- com "cannot insert into generated column". Com gatilho, mesmo que algum
-- caminho do código escreva um valor qualquer, o banco sobrescreve com o
-- correto — o dado não tem como ficar dessincronizado do nome.
-- ---------------------------------------------------------------------------
ALTER TABLE "filiados" ADD COLUMN IF NOT EXISTS "busca_normalizada"  TEXT;
ALTER TABLE "filiados" ADD COLUMN IF NOT EXISTS "cidade_normalizada" TEXT;

CREATE OR REPLACE FUNCTION filiados_sincronizar_busca()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Tudo que identifica a pessoa num campo só: nome, matrícula, COREN e CPF.
  -- Como a comparação é por "contém", o CPF cru (11 dígitos) também responde a
  -- pedaços digitados com máscara — "005.636" vira as palavras "005" e "636",
  -- e ambas estão contidas na sequência de dígitos.
  NEW."busca_normalizada" := senatepi_normalizar_busca(
    coalesce(NEW."nome_completo", '') || ' ' ||
    coalesce(NEW."matricula",     '') || ' ' ||
    coalesce(NEW."numero_coren",  '') || ' ' ||
    coalesce(NEW."cpf",           '')
  );
  NEW."cidade_normalizada" := senatepi_normalizar_busca(coalesce(NEW."cidade", ''));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_filiados_busca ON "filiados";
CREATE TRIGGER trg_filiados_busca
  BEFORE INSERT OR UPDATE OF "nome_completo", "matricula", "numero_coren", "cpf", "cidade"
  ON "filiados"
  FOR EACH ROW
  EXECUTE FUNCTION filiados_sincronizar_busca();

-- Backfill dos que já existem.
UPDATE "filiados" SET
  "busca_normalizada" = senatepi_normalizar_busca(
    coalesce("nome_completo", '') || ' ' ||
    coalesce("matricula",     '') || ' ' ||
    coalesce("numero_coren",  '') || ' ' ||
    coalesce("cpf",           '')
  ),
  "cidade_normalizada" = senatepi_normalizar_busca(coalesce("cidade", ''));

-- ---------------------------------------------------------------------------
-- 3) Índice de trigrama
--
-- `contains` vira LIKE '%palavra%', que nenhum índice B-tree acelera. O GIN de
-- trigrama resolve isso. É otimização, não requisito: se a extensão não
-- estiver disponível no servidor, a busca continua correta — apenas varre a
-- tabela. Por isso o CREATE EXTENSION está protegido: falta de índice não pode
-- derrubar o deploy, já que a API só sobe depois de `prisma migrate deploy`.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm indisponivel; a busca funciona sem o indice de trigrama.';
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS "filiados_busca_trgm"
      ON "filiados" USING gin ("busca_normalizada" gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS "filiados_cidade_trgm"
      ON "filiados" USING gin ("cidade_normalizada" gin_trgm_ops);
  END IF;
END $$;
