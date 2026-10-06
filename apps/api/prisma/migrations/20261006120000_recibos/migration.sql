-- O RECIBO. 06/10/2026.
--
-- "Quero criar um gerador de recibos para o sistema. Tem que ser pensado para
-- resolver todos os problemas do sindicato com recibos." — o dono.
--
-- MEDIDO NA PRODUÇÃO ANTES DE ESCREVER: 5 cobranças, 49 parcelas, 4 pagas
-- (R$ 396,60), 2 lançamentos no caixa e ZERO recibos — porque não havia onde
-- guardar um. O que existe hoje é o comprovante de parcela, que é outra coisa:
-- comprovante é o que o FILIADO manda para provar que pagou; recibo é o que o
-- SINDICATO entrega para provar que recebeu.
--
-- POR QUE UMA TABELA, E NÃO UM PDF MONTADO NA HORA:
--
--   · o NÚMERO não pode mudar entre a 1ª e a 2ª via, e número calculado na
--     impressão muda;
--   · os dados do pagador ficam CONGELADOS — se a filiada corrigir o nome
--     amanhã, o papel que ela levou continua dizendo o que dizia;
--   · cancelar precisa QUEIMAR o número, com motivo e autor, e não sumir com
--     a linha.
--
-- ADITIVA E IDEMPOTENTE: cria tabela nova e não toca em nenhuma existente —
-- as FKs apontam para fora, e nenhuma coluna é alterada ou removida. O
-- contêiner antigo da API, que atende durante a janela de troca contra este
-- mesmo banco, simplesmente não enxerga a tabela.
CREATE TABLE IF NOT EXISTS "recibos" (
  "id"               TEXT NOT NULL,
  "exercicio"        INTEGER NOT NULL,
  "numero"           INTEGER NOT NULL,
  "valor"            DECIMAL(12,2) NOT NULL,
  "referente"        TEXT NOT NULL,
  "forma_pagamento"  TEXT NOT NULL,
  "recebido_em"      TIMESTAMP(3) NOT NULL,
  "pagador_nome"     TEXT NOT NULL,
  "pagador_documento" TEXT,
  "movimentacao_id"  TEXT,
  "parcela_id"       TEXT,
  "filiado_id"       TEXT,
  "empresa_id"       TEXT,
  "emitido_por"      TEXT NOT NULL,
  "emitido_em"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cancelado_em"     TIMESTAMP(3),
  "cancelado_por"    TEXT,
  "cancelado_motivo" TEXT,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "recibos_pkey" PRIMARY KEY ("id")
);

-- O NÚMERO NÃO SE REPETE DENTRO DO EXERCÍCIO. Esta é a trava de verdade: a
-- numeração é tirada com `MAX+1` sob trava de transação, e se duas emissões
-- simultâneas escaparem da trava, o banco recusa a segunda em vez de deixar
-- dois recibos nº 7/2026 circularem.
CREATE UNIQUE INDEX IF NOT EXISTS "recibos_exercicio_numero_key"
  ON "recibos" ("exercicio", "numero");

-- UM recibo VIVO por lançamento, e um por parcela.
--
-- ÍNDICE PARCIAL, e o "parcial" é o ponto. Emitir dois recibos do mesmo
-- dinheiro é o erro que mais confunde prestação de contas — mas cancelar um
-- recibo PRECISA liberar a reemissão, que é a razão número um de cancelar
-- (saiu errado, refaz). Um único simples barrava a reemissão com erro de banco;
-- o parcial conta só o que está vivo.
--
-- O Prisma não declara índice parcial no schema; por isso ele mora aqui, como
-- o de `numero_coren`. A coluna NÃO é `@unique` no modelo, de propósito.
CREATE UNIQUE INDEX IF NOT EXISTS "recibo_vivo_por_movimentacao"
  ON "recibos" ("movimentacao_id")
  WHERE "cancelado_em" IS NULL AND "movimentacao_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "recibo_vivo_por_parcela"
  ON "recibos" ("parcela_id")
  WHERE "cancelado_em" IS NULL AND "parcela_id" IS NOT NULL;

-- Busca pelo lastro (a ficha do filiado, a fila de pendentes).
CREATE INDEX IF NOT EXISTS "recibos_movimentacao_id_idx" ON "recibos" ("movimentacao_id");
CREATE INDEX IF NOT EXISTS "recibos_parcela_id_idx" ON "recibos" ("parcela_id");

CREATE INDEX IF NOT EXISTS "recibos_emitido_em_idx" ON "recibos" ("emitido_em");
CREATE INDEX IF NOT EXISTS "recibos_filiado_id_idx" ON "recibos" ("filiado_id");
CREATE INDEX IF NOT EXISTS "recibos_empresa_id_idx" ON "recibos" ("empresa_id");

-- SET NULL, e não CASCADE: apagar a cobrança não pode apagar o recibo que o
-- sindicato já entregou. O papel continua existindo no mundo.
DO $$ BEGIN
  ALTER TABLE "recibos" ADD CONSTRAINT "recibos_movimentacao_id_fkey"
    FOREIGN KEY ("movimentacao_id") REFERENCES "movimentacoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "recibos" ADD CONSTRAINT "recibos_parcela_id_fkey"
    FOREIGN KEY ("parcela_id") REFERENCES "parcelas_cobranca"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "recibos" ADD CONSTRAINT "recibos_filiado_id_fkey"
    FOREIGN KEY ("filiado_id") REFERENCES "filiados"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "recibos" ADD CONSTRAINT "recibos_empresa_id_fkey"
    FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
