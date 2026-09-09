-- A CAIXA DE ENTRADA DO ADVOGADO.
--
-- O robô acerta com CERTEZA em 15,8% dos atos e erra o dono em 4,1%; no resto
-- ele não sabe — e criar tarefa mesmo assim é o que enchia a agenda de trabalho
-- que não era de ninguém ali. Em vez de adivinhar, ele PROPÕE.
--
-- Medido em 08/09/2026 sobre os últimos 30 dias: 49 atos virariam tarefa hoje;
-- 7 têm ordem nossa provada COM prazo (vão direto), 2 são da outra parte (não
-- chegam) e 40 viram proposta — 2,6 por semana no pior caso individual, e ZERO
-- sem dono identificável.
--
-- IDEMPOTENTE, pela mesma razão da migração anterior: `ADD CONSTRAINT` seco
-- derrubou a API em 502 quando encontrou a restrição já criada à mão. Postgres
-- não tem `IF NOT EXISTS` para constraint, então a checagem é explícita.
--
-- ADITIVA: duas colunas nulas. O contêiner ANTIGO ignora as duas e continua
-- gravando como antes — na janela de troca nada quebra.
ALTER TABLE "comunicacoes_djen" ADD COLUMN IF NOT EXISTS "tarefa_proposta_em" TIMESTAMP(3);
ALTER TABLE "comunicacoes_djen" ADD COLUMN IF NOT EXISTS "tarefa_proposta_para" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'comunicacoes_djen_tarefa_proposta_para_fkey'
  ) THEN
    ALTER TABLE "comunicacoes_djen"
      ADD CONSTRAINT "comunicacoes_djen_tarefa_proposta_para_fkey"
      FOREIGN KEY ("tarefa_proposta_para") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- A caixa é consultada POR ADVOGADO e a cada carregamento do painel: sem índice
-- é varredura das 1.433 publicações para responder sobre meia dúzia.
CREATE INDEX IF NOT EXISTS "comunicacoes_djen_proposta_idx"
  ON "comunicacoes_djen"("tarefa_proposta_para", "tarefa_proposta_em");

-- POR QUE o advogado recusou, com as palavras dele. É o único dado que diz
-- ONDE a regra erra: hoje o robô só sabe que 80% dos atos são indefinidos.
ALTER TABLE "comunicacoes_djen" ADD COLUMN IF NOT EXISTS "motivo_da_recusa" TEXT;
