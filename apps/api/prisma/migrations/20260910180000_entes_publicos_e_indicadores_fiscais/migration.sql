-- ============================================================================
-- ENTES PÚBLICOS (IBGE + SICONFI) E SEUS INDICADORES FISCAIS
--
-- ADITIVA. Nada é removido, renomeado ou muda de tipo. Durante a janela de
-- troca do deploy o contêiner ANTIGO atende contra este banco já migrado:
--  · as três tabelas novas ele simplesmente não conhece;
--  · as colunas novas em `filiados` e `partes_externas` são NULÁVEIS, e ele
--    continua inserindo sem citá-las;
--  · `cidade`, `uf` e `estado` continuam exatamente como estavam. O código do
--    ente fica AO LADO do texto livre, nunca no lugar dele.
--
-- Idempotente do começo ao fim (IF NOT EXISTS / DO $$): esta migração roda em
-- um banco por sindicato, e já houve uma migração que derrubou a API por 1h30
-- porque um ADD CONSTRAINT seco encontrou a constraint já existente.
-- ============================================================================

-- --------------------------------------------------------------- o catálogo --
-- Município, Estado e União na MESMA tabela porque é assim que o SICONFI os
-- trata: a chave dele é este código — 1 para a União, 22 para o Piauí, 2211001
-- para Teresina —, e a mesma consulta serve aos três. Separá-los em tabelas
-- exigiria três caminhos de código para buscar o mesmo relatório.
--
-- Para o sindicato isso não é abstração: o Estado do Piauí é o segundo maior
-- empregador do cadastro (42 vínculos — Hospital Getúlio Vargas 19, SESAPI 16)
-- e figura em 10 processos. Um catálogo só de municípios o deixaria de fora.
CREATE TABLE IF NOT EXISTS "entes" (
  "codigo"               INTEGER NOT NULL,
  "nome"                 TEXT NOT NULL,
  "uf"                   CHAR(2) NOT NULL,
  "esfera"               CHAR(1) NOT NULL,
  "nome_normalizado"     TEXT NOT NULL,
  "regiao_imediata"      TEXT,
  "regiao_intermediaria" TEXT,
  "populacao"            INTEGER,
  "populacao_ano"        INTEGER,
  "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMP(3) NOT NULL,
  CONSTRAINT "entes_pkey" PRIMARY KEY ("codigo")
);

-- O ÚNICO É PARCIAL, e o recorte não é zelo: QUATRO estados têm o mesmo nome de
-- um município da própria UF — Amapá, Rio de Janeiro, São Paulo e Goiás. Um
-- índice único sobre (uf, nome) sem o filtro recusaria a carga do catálogo.
CREATE UNIQUE INDEX IF NOT EXISTS "entes_uf_nome_normalizado_key"
  ON "entes" ("uf", "nome_normalizado") WHERE "esfera" = 'M';
CREATE INDEX IF NOT EXISTS "entes_uf_nome_normalizado_idx" ON "entes" ("uf", "nome_normalizado");
CREATE INDEX IF NOT EXISTS "entes_esfera_uf_nome_idx" ON "entes" ("esfera", "uf", "nome");
CREATE INDEX IF NOT EXISTS "entes_nome_normalizado_idx" ON "entes" ("nome_normalizado");

-- A esfera só admite três valores. CHECK e não enum: o Prisma não declara CHECK,
-- e um enum aqui exigiria migração para cada valor novo sem ganhar nada.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'entes_esfera_check') THEN
    ALTER TABLE "entes" ADD CONSTRAINT "entes_esfera_check" CHECK ("esfera" IN ('U', 'E', 'M'));
  END IF;
END $$;

-- ------------------------------------------------------------- indicadores --
CREATE TABLE IF NOT EXISTS "indicadores_pessoal_ente" (
  "id"                       TEXT NOT NULL,
  "ente_codigo"              INTEGER NOT NULL,
  "exercicio"                INTEGER NOT NULL,
  "quadrimestre"             INTEGER NOT NULL,
  "percentual_rcl"           DECIMAL(6,2),
  "limite_maximo"            DECIMAL(6,2),
  "limite_prudencial"        DECIMAL(6,2),
  "limite_alerta"            DECIMAL(6,2),
  "despesa_pessoal"          DECIMAL(18,2),
  "receita_corrente_liquida" DECIMAL(18,2),
  "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"               TIMESTAMP(3) NOT NULL,
  CONSTRAINT "indicadores_pessoal_ente_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "indicadores_pessoal_ente_ente_codigo_exercicio_quadrimestr_key"
  ON "indicadores_pessoal_ente" ("ente_codigo", "exercicio", "quadrimestre");
CREATE INDEX IF NOT EXISTS "indicadores_pessoal_ente_ente_codigo_idx"
  ON "indicadores_pessoal_ente" ("ente_codigo");

CREATE TABLE IF NOT EXISTS "indicadores_saude_ente" (
  "id"                 TEXT NOT NULL,
  "ente_codigo"        INTEGER NOT NULL,
  "exercicio"          INTEGER NOT NULL,
  "bimestre"           INTEGER NOT NULL,
  "percentual_despesa" DECIMAL(6,2),
  "despesa_liquidada"  DECIMAL(18,2),
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "indicadores_saude_ente_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "indicadores_saude_ente_ente_codigo_exercicio_bimestre_key"
  ON "indicadores_saude_ente" ("ente_codigo", "exercicio", "bimestre");
CREATE INDEX IF NOT EXISTS "indicadores_saude_ente_ente_codigo_idx"
  ON "indicadores_saude_ente" ("ente_codigo");

-- ------------------------------------------------------- origem da ligação --
-- Registra COMO cada ligação foi feita. Sem isto, a varredura automática
-- reescreveria por cima da correção feita à mão e ninguém saberia distinguir o
-- que o robô deduziu do que uma pessoa conferiu.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OrigemDaLigacao') THEN
    CREATE TYPE "OrigemDaLigacao" AS ENUM (
      'MANUAL', 'CODIGO_IBGE', 'NOME_DE_ENTE', 'UF_E_NOME', 'NOME_UNICO', 'PREFERENCIA_UF'
    );
  END IF;
END $$;

-- FILIADO guarda MUNICÍPIO — é onde a pessoa mora, e pessoa não mora em Estado
-- nem na União. O nome da coluna diz isso, e o CHECK impede que um código de
-- esfera estadual entre aqui por engano de código.
ALTER TABLE "filiados" ADD COLUMN IF NOT EXISTS "municipio_codigo" INTEGER;
ALTER TABLE "filiados" ADD COLUMN IF NOT EXISTS "municipio_origem" "OrigemDaLigacao";

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'filiados_municipio_codigo_check') THEN
    ALTER TABLE "filiados" ADD CONSTRAINT "filiados_municipio_codigo_check"
      CHECK ("municipio_codigo" IS NULL OR "municipio_codigo" >= 1100000);
  END IF;
END $$;

-- ORGANIZAÇÃO guarda ENTE, e a diferença é o ponto: a Secretaria de Estado da
-- Saúde não é "de Teresina" — quem responde pelo orçamento dela é o Estado do
-- Piauí. Chamar esta coluna de `municipio_codigo` seria gravar uma informação
-- com o nome de outra.
ALTER TABLE "partes_externas" ADD COLUMN IF NOT EXISTS "ente_codigo" INTEGER;
ALTER TABLE "partes_externas" ADD COLUMN IF NOT EXISTS "ente_origem" "OrigemDaLigacao";

CREATE INDEX IF NOT EXISTS "filiados_municipio_codigo_idx"   ON "filiados" ("municipio_codigo");
CREATE INDEX IF NOT EXISTS "partes_externas_ente_codigo_idx" ON "partes_externas" ("ente_codigo");

-- ---------------------------------------------------------------------- FK --
-- ON DELETE SET NULL nas duas pontas do cadastro: apagar um ente do catálogo
-- (uma fusão, um desmembramento) não pode levar junto o filiado.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'filiados_municipio_codigo_fkey') THEN
    ALTER TABLE "filiados" ADD CONSTRAINT "filiados_municipio_codigo_fkey"
      FOREIGN KEY ("municipio_codigo") REFERENCES "entes"("codigo") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'partes_externas_ente_codigo_fkey') THEN
    ALTER TABLE "partes_externas" ADD CONSTRAINT "partes_externas_ente_codigo_fkey"
      FOREIGN KEY ("ente_codigo") REFERENCES "entes"("codigo") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'indicadores_pessoal_ente_ente_codigo_fkey') THEN
    ALTER TABLE "indicadores_pessoal_ente" ADD CONSTRAINT "indicadores_pessoal_ente_ente_codigo_fkey"
      FOREIGN KEY ("ente_codigo") REFERENCES "entes"("codigo") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'indicadores_saude_ente_ente_codigo_fkey') THEN
    ALTER TABLE "indicadores_saude_ente" ADD CONSTRAINT "indicadores_saude_ente_ente_codigo_fkey"
      FOREIGN KEY ("ente_codigo") REFERENCES "entes"("codigo") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- NÃO existe FK de `processos.municipio_ibge` para `entes`, e não é esquecimento.
-- Duas razões, ambas medidas na produção em 10/09/2026:
--  · o campo tem 24 códigos distintos e UM deles (`5149`, em 2 processos) não é
--    código do IBGE — é código interno de serventia devolvido pelo DataJud. Um
--    ADD CONSTRAINT seco falharia, e migração que falha é API que não sobe;
--  · o significado é OUTRO: ali está o município do ÓRGÃO JULGADOR, ou seja a
--    COMARCA. A ação contra o Município de Ilha Grande tramita em Parnaíba, e a
--    contra Coronel José Dias em São Raimundo Nonato. Tratar isso como endereço
--    da parte seria errar em silêncio exatamente nos casos que interessam.

-- O catálogo em si NÃO é semeado aqui: são 5.599 linhas que viriam como um
-- INSERT gigante e ilegível no diff. Quem carrega é `EnteSeedService`, no boot,
-- a partir de apps/api/assets/entes-ibge.json.
