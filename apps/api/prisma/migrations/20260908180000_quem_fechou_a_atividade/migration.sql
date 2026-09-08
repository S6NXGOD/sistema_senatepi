-- QUEM FECHOU A ATIVIDADE — a coluna existia, a relação não.
--
-- `concluido_por` e `cancelado_por` guardam o id do usuário desde sempre, mas
-- sem chave estrangeira a API não tinha como trazer o NOME junto — e o desfecho
-- aparecia na tela sem autor: "Peça protocolada às 16:52", por quem ninguém sabe.
--
-- ADITIVA: só acrescenta as duas restrições. Nenhuma coluna nova, nenhuma
-- reescrita de dado. O contêiner ANTIGO continua gravando os mesmos ids e as
-- restrições aceitam — conferido antes: ZERO ids órfãos nas 44 linhas que têm
-- valor (40 concluídas, 4 canceladas).
--
-- ON DELETE SET NULL, como no criador: apagar um usuário não pode apagar a
-- atividade que ele fechou; perde-se o nome, não o histórico.
ALTER TABLE "compromissos"
  ADD CONSTRAINT "compromissos_concluido_por_fkey"
  FOREIGN KEY ("concluido_por") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "compromissos"
  ADD CONSTRAINT "compromissos_cancelado_por_fkey"
  FOREIGN KEY ("cancelado_por") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Índices: a busca "o que fulano fechou" ainda não existe na tela, mas a chave
-- estrangeira sem índice torna a EXCLUSÃO de usuário uma varredura da tabela.
CREATE INDEX IF NOT EXISTS "compromissos_concluido_por_idx" ON "compromissos"("concluido_por");
CREATE INDEX IF NOT EXISTS "compromissos_cancelado_por_idx" ON "compromissos"("cancelado_por");
