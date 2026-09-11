-- ============================================================================
-- QUANDO O TESOURO FOI CONSULTADO — a diferença entre "não publicou" e
-- "ainda não perguntamos".
--
-- O DEFEITO QUE ISTO CONSERTA. A ficha do Governo do Estado do Piauí dizia,
-- com todas as letras: "O município não publicou o Relatório de Gestão Fiscal
-- no período consultado." Duas afirmações falsas numa frase só — o Estado não
-- é município, e ele PUBLICOU (37,00% da receita em pessoal, 1º quadrimestre de
-- 2026, conferido na origem). A verdade é que a varredura ainda não tinha
-- perguntado por ele.
--
-- Sem esta coluna as duas situações são indistinguíveis: nos dois casos não
-- existe linha em `indicadores_pessoal_ente`. E a tela precisa distinguir,
-- porque as consequências são opostas — "não publicou" é irregularidade do
-- ente, "não perguntamos" é tarefa nossa.
--
-- ADITIVA e nulável: o contêiner antigo insere sem citá-la, e nulo já significa
-- exatamente o que precisa significar — nunca consultado.
-- ============================================================================

ALTER TABLE "entes" ADD COLUMN IF NOT EXISTS "siconfi_consultado_em" TIMESTAMP(3);

-- Índice para a varredura achar rápido quem está defasado ou nunca foi visto.
CREATE INDEX IF NOT EXISTS "entes_siconfi_consultado_em_idx"
  ON "entes" ("siconfi_consultado_em");
