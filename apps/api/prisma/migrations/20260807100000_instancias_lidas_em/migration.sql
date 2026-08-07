-- CARIMBO DO PARSER MULTI-INSTÂNCIA.
--
-- O QUE ELE RESPONDE
-- "Este processo já foi lido pelo parser que enxerga TODOS os graus?" Nulo =
-- não. É o que permite reavaliar o acervo sob demanda, ao abrir a tela, sem
-- reconsultar o CNJ para sempre.
--
-- POR QUE NÃO DAVA PARA DEDUZIR
-- Tentei três caminhos antes de acrescentar coluna, e nenhum distingue:
--   · `processos_instancias.doc_id` — o backfill REMONTOU o `_id` do CNJ
--     (`<TRIBUNAL>_<GRAU>_<NPU>`) justamente para a sincronização reconhecer a
--     linha como a mesma. Fica idêntico ao que o CNJ devolve.
--   · `ultima_sincronizacao` da instância — o backfill copiou a do processo.
--   · `updated_at` — o backfill gravou CURRENT_TIMESTAMP em todas.
-- Ou seja: o backfill foi desenhado para ser indistinguível de uma leitura
-- real, e essa era a decisão certa naquele momento. O carimbo é o preço.
--
-- Nulo em todas as linhas existentes de propósito: é exatamente a fila de
-- reavaliação do acervo já cadastrado.

ALTER TABLE "processos"
  ADD COLUMN IF NOT EXISTS "instancias_lidas_em" TIMESTAMP(3);

-- Sustenta a busca da fila ("os que ainda não foram lidos, mais antigos
-- primeiro") sem varrer a tabela.
CREATE INDEX IF NOT EXISTS "processos_instancias_lidas_em_idx"
  ON "processos"("instancias_lidas_em" ASC NULLS FIRST);
