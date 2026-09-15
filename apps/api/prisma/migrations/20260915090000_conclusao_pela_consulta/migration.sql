-- O ATENDIMENTO FECHA SOZINHO QUANDO O ADVOGADO CONCLUI A CONSULTA.
--
-- Medido na produção em 14/09/2026: 4 de 4 consultas concluídas exigiram
-- fechar o atendimento à mão depois, logo em seguida. A triagem respondia pelo
-- que o advogado já tinha registrado, e a lista mostrava "falta concluir" para
-- um caso resolvido.
--
-- A partir desta rodada, concluir a consulta nascida do atendimento conclui o
-- atendimento na mesma transação e carimba de onde veio o fechamento:
--   conclusao_origem       'TRIAGEM' | 'CONSULTA' (texto, como os slugs da
--                          agenda; valor novo não pede migração de enum)
--   conclusao_consulta_id  a consulta que fechou. É o CARIMBO: desfazer ou
--                          reabrir a consulta só devolve o atendimento se ele
--                          bater.
--
-- SEM BACKFILL, de propósito: os atendimentos fechados antes de 15/09/2026 não
-- dizem por qual caminho foram fechados; preencher seria inventar a origem.
-- Nulo = anterior à regra.
--
-- CHAVE ESTRANGEIRA EM BLOCO DO (cicatriz de
-- `20260908180000_quem_fechou_a_atividade`): Postgres não tem
-- `ADD CONSTRAINT IF NOT EXISTS`, e um ADD CONSTRAINT seco que encontrasse a
-- constraint pronta faria o `migrate deploy` falhar e recusar as migrações
-- seguintes. O nome conferido é exatamente o que o Prisma daria à relação.
-- ON DELETE SET NULL: apagar a consulta não pode apagar o atendimento que ela
-- fechou; perde-se o carimbo, não o registro.
--
-- ADITIVA E IDEMPOTENTE: duas colunas nulas. Na janela de troca o contêiner
-- antigo não as conhece, não fecha nada sozinho e continua inserindo sem elas.
ALTER TABLE "atendimentos" ADD COLUMN IF NOT EXISTS "conclusao_origem" TEXT;
ALTER TABLE "atendimentos" ADD COLUMN IF NOT EXISTS "conclusao_consulta_id" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'atendimentos_conclusao_consulta_id_fkey'
  ) THEN
    ALTER TABLE "atendimentos"
      ADD CONSTRAINT "atendimentos_conclusao_consulta_id_fkey"
      FOREIGN KEY ("conclusao_consulta_id") REFERENCES "compromissos"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
