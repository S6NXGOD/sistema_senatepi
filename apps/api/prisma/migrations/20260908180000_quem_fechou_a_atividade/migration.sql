-- QUEM FECHOU A ATIVIDADE — a coluna existia, a relação não.
--
-- `concluido_por` e `cancelado_por` guardam o id do usuário desde sempre, mas
-- sem chave estrangeira a API não tinha como trazer o NOME junto — e o desfecho
-- aparecia na tela sem autor: "Peça protocolada às 16:52", por quem ninguém sabe.
--
-- IDEMPOTENTE, E ISSO NÃO É ZELO — É CICATRIZ.
-- A primeira versão usava `ADD CONSTRAINT` seco. Eu já tinha aplicado as duas
-- constraints à mão na produção (para conferir que não havia id órfão antes de
-- confiar na FK), então no deploy o `migrate deploy` encontrou-as prontas,
-- falhou, e o Prisma passou a RECUSAR qualquer migração seguinte: a API ficou
-- em 502 até eu marcar esta como aplicada.
--
-- Postgres não tem `ADD CONSTRAINT IF NOT EXISTS`, então a checagem é explícita.
-- Vale para o outro cliente (SINDSERM), cujo banco ainda vai receber isto sem
-- nenhuma aplicação manual antes.
--
-- ADITIVA: nenhuma coluna nova, nenhuma reescrita. Conferido antes de criar:
-- ZERO ids órfãos nas 44 linhas com valor (40 concluídas, 4 canceladas).
-- ON DELETE SET NULL como no criador: apagar um usuário não pode apagar a
-- atividade que ele fechou; perde-se o nome, não o histórico.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'compromissos_concluido_por_fkey'
  ) THEN
    ALTER TABLE "compromissos"
      ADD CONSTRAINT "compromissos_concluido_por_fkey"
      FOREIGN KEY ("concluido_por") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'compromissos_cancelado_por_fkey'
  ) THEN
    ALTER TABLE "compromissos"
      ADD CONSTRAINT "compromissos_cancelado_por_fkey"
      FOREIGN KEY ("cancelado_por") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Chave estrangeira sem índice torna a EXCLUSÃO de um usuário uma varredura da
-- tabela inteira de compromissos.
CREATE INDEX IF NOT EXISTS "compromissos_concluido_por_idx" ON "compromissos"("concluido_por");
CREATE INDEX IF NOT EXISTS "compromissos_cancelado_por_idx" ON "compromissos"("cancelado_por");
