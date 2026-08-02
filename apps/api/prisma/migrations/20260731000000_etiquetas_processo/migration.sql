-- Etiquetas internas do processo (Urgente, Fase de Execução, Coletiva…).
--
-- NÃO-DESTRUTIVA: coluna nova com default de array vazio, então todo processo
-- existente passa a ter `{}` sem precisar de backfill.

ALTER TABLE "processos"
  ADD COLUMN IF NOT EXISTS "etiquetas" TEXT[] NOT NULL DEFAULT '{}';

-- GIN acelera "processos que têm a etiqueta X" (operador @>).
CREATE INDEX IF NOT EXISTS "processos_etiquetas_idx" ON "processos" USING GIN ("etiquetas");
