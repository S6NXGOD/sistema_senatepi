-- Identidade visual editável pela tela (cor institucional e logos).
--
-- Aditiva e de linha única: o sistema funciona sem nenhuma linha aqui, caindo
-- no padrão compilado do `tenant.config`. Por isso não há seed — a tabela
-- vazia é o estado correto de uma instalação que nunca mexeu na marca.
CREATE TABLE "identidade_visual" (
  "id" TEXT NOT NULL DEFAULT 'unica',
  "cor_primaria" TEXT,
  "logo_horizontal_cor_key" TEXT,
  "logo_horizontal_branco_key" TEXT,
  "logo_vertical_cor_key" TEXT,
  "logo_vertical_branco_key" TEXT,
  "atualizado_em" TIMESTAMP(3) NOT NULL,
  "atualizado_por" TEXT,
  CONSTRAINT "identidade_visual_pkey" PRIMARY KEY ("id")
);
