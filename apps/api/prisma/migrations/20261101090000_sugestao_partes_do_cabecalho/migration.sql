-- O que o CABECALHO do ato diz sobre o polo que os destinatarios nao cobrem.
--
-- Aditiva e idempotente: na janela de troca do deploy o container ANTIGO
-- atende contra o banco ja migrado, e uma coluna nova que ele ignora nao o
-- derruba. `IF NOT EXISTS` porque a migracao pode ser reaplicada.
ALTER TABLE "sugestoes_processo" ADD COLUMN IF NOT EXISTS "partes_do_cabecalho" JSONB;
