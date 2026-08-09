-- Importação da FOLHA DA PREFEITURA no módulo de filiados.
--
-- CONTEXTO: a Prefeitura de Teresina manda periodicamente uma planilha com
-- ~4.000 filiados (Órgão, Matrícula, Nome, Quadro, Lotação, Cargo, Valor). Ela
-- NÃO TRAZ CPF — então o CPF, que é a âncora de identidade do importador
-- legado, simplesmente não existe aqui. Quem identifica a pessoa é a MATRÍCULA,
-- que é única no município inteiro (confirmado pelo sindicato).
--
-- POR QUE NÃO NASCE UMA TABELA NOVA DE "VÍNCULO FUNCIONAL"
-- Porque ela já existe: `vinculos_profissionais` é 1:N com o filiado desde a
-- migration de locais de trabalho, e já tem empresa (órgão), cargo, lotação e
-- matrícula. Criar uma segunda tabela para os mesmos fatos daria o problema que
-- "Cadastros Base" já deu — a mesma entidade em dois lugares, divergindo. O que
-- faltava era `quadro` e uma matrícula em forma comparável.
--
-- TUDO ADITIVO. Nenhuma coluna sai, nenhuma vira NOT NULL, nenhum registro
-- existente é reescrito. O sistema em produção continua subindo com o binário
-- antigo depois desta migration (backward-compatible nos dois sentidos).

-- ---------------------------------------------------------------------------
-- 1) Tipos novos
--
-- Todos em DO/IF NOT EXISTS: `CREATE TYPE` não aceita IF NOT EXISTS, e uma
-- migration que explode no segundo deploy trava o `prisma migrate deploy` que
-- roda no start da API.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PerfilImportacao') THEN
    CREATE TYPE "PerfilImportacao" AS ENUM ('LEGADO_CSV', 'FOLHA_PREFEITURA');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ClassificacaoLinha') THEN
    CREATE TYPE "ClassificacaoLinha" AS ENUM ('NOVO', 'ATUALIZACAO', 'CONFLITO', 'DUPLICIDADE', 'ERRO');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MotivoConflito') THEN
    CREATE TYPE "MotivoConflito" AS ENUM ('NOME_SEMELHANTE', 'NOME_DIVERGENTE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DecisaoConflito') THEN
    CREATE TYPE "DecisaoConflito" AS ENUM ('PENDENTE', 'MESMA_PESSOA', 'PESSOA_DIFERENTE', 'IGNORAR');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Vínculo profissional: quadro + matrícula comparável + updated_at
-- ---------------------------------------------------------------------------
ALTER TABLE "vinculos_profissionais"
  ADD COLUMN IF NOT EXISTS "quadro"                TEXT,
  ADD COLUMN IF NOT EXISTS "matricula_normalizada" TEXT;

-- `updated_at` entra com DEFAULT para não travar em tabela com dados: sem o
-- default, uma coluna NOT NULL exigiria reescrever todas as linhas. Com ele, o
-- Postgres 11+ resolve por metadado, sem rewrite.
ALTER TABLE "vinculos_profissionais"
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ---------------------------------------------------------------------------
-- 3) Preenche a matrícula comparável dos vínculos QUE JÁ EXISTEM
--
-- A normalização aqui é a MESMA de `normalizarMatricula()` no TypeScript:
-- maiúsculas, sem espaço algum, sem zeros à esquerda. Se as duas divergirem, a
-- importação deixa de reconhecer o que já está no banco e passa a criar
-- duplicata — por isso o util tem teste fechado e esta expressão foi conferida
-- caso a caso contra ele, em banco.
--
-- `[[:space:]]` e NÃO `\s`: com `standard_conforming_strings = on` (o padrão),
-- o `\s` chega ao motor de regex como barra invertida + "s" e não casa espaço
-- nenhum. Medido: com `\s` a expressão devolvia "98 765" em vez de "98765".
--
-- O `(?=.)` preserva o último caractere: '000' vira '0', e não string vazia —
-- matrícula degenerada continua sendo uma matrícula, não "sem matrícula".
-- ---------------------------------------------------------------------------
UPDATE "vinculos_profissionais"
   SET "matricula_normalizada" =
         regexp_replace(
           regexp_replace(upper("matricula"), '[[:space:]]', '', 'g'),
           '^0+(?=.)', '')
 WHERE "matricula_normalizada" IS NULL
   AND "matricula" IS NOT NULL
   AND btrim("matricula") <> '';

CREATE INDEX IF NOT EXISTS "vinculos_profissionais_matricula_normalizada_idx"
  ON "vinculos_profissionais"("matricula_normalizada");

-- ---------------------------------------------------------------------------
-- 4) Unicidade da matrícula — CONDICIONAL, e por dois motivos distintos
--
-- (a) POR CLIENTE. Na Prefeitura de Teresina a matrícula é única no município,
--     então ali o índice único é a trava certa: impede que o mesmo servidor
--     entre duas vezes. Num sindicato com muitos empregadores — o SENATEPI tem
--     hospitais que reaproveitam numeração — dois vínculos podem legitimamente
--     ter a matrícula '123', e o índice seria FALSO. Não dá para declarar isso
--     no schema, que é um só para todos os clientes; dá para deixar o DADO
--     decidir, que é o que este bloco faz.
--
-- (b) POR SEGURANÇA DE DEPLOY. Este código roda em bases já em produção que
--     este commit não conhece. Se houver matrícula repetida, o
--     CREATE UNIQUE INDEX falha, a migration falha, e a API NÃO SOBE (o `start`
--     roda `prisma migrate deploy`). Um deploy travado de madrugada por causa
--     de dado histórico é caro demais por uma garantia que a aplicação também
--     oferece — o importador confere a matrícula antes de inserir, dentro da
--     mesma transação.
--
-- Onde a base permite, ganha a trava do banco. Onde não permite, a migration
-- avisa no log e segue. Reaplicar depois de higienizar cria o índice, porque
-- esta migration é idempotente.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  colisoes INTEGER;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'vinculos_profissionais_matricula_normalizada_key') THEN
    RETURN;
  END IF;

  SELECT count(*) INTO colisoes FROM (
    SELECT "matricula_normalizada"
      FROM "vinculos_profissionais"
     WHERE "matricula_normalizada" IS NOT NULL
     GROUP BY "matricula_normalizada"
    HAVING count(*) > 1
  ) AS d;

  IF colisoes = 0 THEN
    CREATE UNIQUE INDEX "vinculos_profissionais_matricula_normalizada_key"
      ON "vinculos_profissionais"("matricula_normalizada")
      WHERE "matricula_normalizada" IS NOT NULL;
    RAISE NOTICE 'matricula_normalizada: indice UNICO criado.';
  ELSE
    RAISE WARNING 'matricula_normalizada: % matricula(s) repetida(s) — indice unico NAO criado (esperado onde a matricula nao e unica por cliente). A unicidade fica na aplicacao. Conferir com: SELECT matricula_normalizada, count(*) FROM vinculos_profissionais WHERE matricula_normalizada IS NOT NULL GROUP BY 1 HAVING count(*) > 1;', colisoes;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5) Importação: perfil, hash do arquivo e contadores próprios
--
-- `perfil` entra com DEFAULT 'LEGADO_CSV' para que as importações já gravadas
-- continuem significando o que significavam — nenhuma delas era folha.
-- ---------------------------------------------------------------------------
ALTER TABLE "importacoes"
  ADD COLUMN IF NOT EXISTS "perfil"               "PerfilImportacao" NOT NULL DEFAULT 'LEGADO_CSV',
  ADD COLUMN IF NOT EXISTS "hash_arquivo"         TEXT,
  ADD COLUMN IF NOT EXISTS "conflitos"            INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "vinculos_criados"     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "vinculos_atualizados" INTEGER NOT NULL DEFAULT 0;

-- Índice COMUM, não único: as importações antigas têm hash NULO e uma base
-- pode legitimamente ter reimportado o mesmo arquivo antes desta trava existir.
-- O bloqueio de reenvio é da aplicação, que sabe perguntar "quer mesmo?".
CREATE INDEX IF NOT EXISTS "importacoes_hash_arquivo_idx"
  ON "importacoes"("hash_arquivo");

-- ---------------------------------------------------------------------------
-- 6) Linha da importação: veredito da prévia, decisão humana e diff
-- ---------------------------------------------------------------------------
ALTER TABLE "importacao_linhas"
  ADD COLUMN IF NOT EXISTS "lotacao"         TEXT,
  ADD COLUMN IF NOT EXISTS "cargo"           TEXT,
  ADD COLUMN IF NOT EXISTS "quadro"          TEXT,
  ADD COLUMN IF NOT EXISTS "classificacao"   "ClassificacaoLinha",
  ADD COLUMN IF NOT EXISTS "motivo_conflito" "MotivoConflito",
  ADD COLUMN IF NOT EXISTS "candidato_id"    TEXT,
  ADD COLUMN IF NOT EXISTS "decisao"         "DecisaoConflito" NOT NULL DEFAULT 'PENDENTE',
  ADD COLUMN IF NOT EXISTS "decidido_por"    TEXT,
  ADD COLUMN IF NOT EXISTS "decidido_em"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "alteracoes"      JSONB,
  ADD COLUMN IF NOT EXISTS "vinculo_id"      TEXT;

CREATE INDEX IF NOT EXISTS "importacao_linhas_importacao_classificacao_idx"
  ON "importacao_linhas"("importacao_id", "classificacao");

-- ---------------------------------------------------------------------------
-- 7) SEM chave estrangeira em `candidato_id`, `filiado_id` e `vinculo_id`
--
-- Mesmo raciocínio de `duplicata_decisao`: a linha da importação é RASTRO. Se o
-- filiado for apagado (fusão de duplicata, LGPD), a linha precisa sobreviver
-- dizendo "em 08/08/2026 esta planilha criou este id" — com CASCADE o rastro
-- sumiria justamente quando passa a ser a única prova, e com RESTRICT a exclusão
-- do filiado ficaria impossível.
-- ---------------------------------------------------------------------------
