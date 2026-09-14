-- QUEM FECHOU O ATENDIMENTO, QUANDO, E POR QUÊ.
--
-- Concluir e cancelar eram um toque no seletor de situação, sem motivo e sem
-- autor. Medido na produção em 13–14/09/2026 (10 atendimentos): o #9 alternou
-- CANCELADO↔CONCLUIDO 6 vezes em 4 minutos (02/09) e o #4 foi cancelado duas
-- vezes antes de concluir. O toque único confunde, e a ficha não guardava
-- nada que explicasse o que aconteceu.
--
-- As rotas próprias (D9: `PATCH /atendimentos/:id/concluir` e `/cancelar`)
-- gravam aqui, no mesmo desenho de `compromissos`:
--   concluido_em / concluido_por / conclusao_obs
--   cancelado_em / cancelado_por / cancelado_categoria / cancelado_motivo
-- `cancelado_categoria` é TEXTO com os slugs do catálogo da agenda
-- (DESISTENCIA, NAO_COMPARECEU, PERDEU_OBJETO, DUPLICIDADE), como em
-- `compromissos`: a consulta cancelada junto recebe o mesmo slug, e categoria
-- nova não pede migração de enum.
--
-- SEM BACKFILL, de propósito: os atendimentos já fechados não dizem quem os
-- fechou nem por quê; preencher seria inventar autor e motivo.
--
-- CHAVES ESTRANGEIRAS EM BLOCO DO, E ISSO É CICATRIZ (ver
-- `20260908180000_quem_fechou_a_atividade`): Postgres não tem
-- `ADD CONSTRAINT IF NOT EXISTS`, e um `ADD CONSTRAINT` seco que encontrasse a
-- constraint pronta faria o `migrate deploy` falhar e recusar as migrações
-- seguintes. O nome conferido é exatamente o que o Prisma daria à relação.
-- ON DELETE SET NULL: apagar um usuário não pode apagar o atendimento que ele
-- fechou; perde-se o nome, não o registro.
--
-- Sem índice nas duas colunas: são 10 atendimentos, e só o Administrador apaga
-- usuário. O índice entra quando a tabela justificar.
--
-- ADITIVA E IDEMPOTENTE: sete colunas nulas; o contêiner antigo não as conhece
-- e continua concluindo e cancelando pelo `/status` durante a janela de troca.
ALTER TABLE "atendimentos" ADD COLUMN IF NOT EXISTS "concluido_em" TIMESTAMP(3);
ALTER TABLE "atendimentos" ADD COLUMN IF NOT EXISTS "concluido_por" TEXT;
ALTER TABLE "atendimentos" ADD COLUMN IF NOT EXISTS "conclusao_obs" TEXT;
ALTER TABLE "atendimentos" ADD COLUMN IF NOT EXISTS "cancelado_em" TIMESTAMP(3);
ALTER TABLE "atendimentos" ADD COLUMN IF NOT EXISTS "cancelado_por" TEXT;
ALTER TABLE "atendimentos" ADD COLUMN IF NOT EXISTS "cancelado_categoria" TEXT;
ALTER TABLE "atendimentos" ADD COLUMN IF NOT EXISTS "cancelado_motivo" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'atendimentos_concluido_por_fkey'
  ) THEN
    ALTER TABLE "atendimentos"
      ADD CONSTRAINT "atendimentos_concluido_por_fkey"
      FOREIGN KEY ("concluido_por") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'atendimentos_cancelado_por_fkey'
  ) THEN
    ALTER TABLE "atendimentos"
      ADD CONSTRAINT "atendimentos_cancelado_por_fkey"
      FOREIGN KEY ("cancelado_por") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
