-- Desfiliação estruturada.
--
-- Antes, desfiliar gravava apenas `situacao = DESFILIADO` e um texto livre no
-- histórico. Três perguntas do dia a dia não tinham resposta:
--   • "quantos saíram por inadimplência este ano?" — o motivo era texto solto;
--   • "até que mês cobro esse associado?" — o mês de corte não existia;
--   • "quem desfiliou e quando?" — só sobrava a frase do histórico.
--
-- Tudo aqui é ADITIVO: nenhuma coluna some, nenhum dado é reescrito. Filiados
-- já desfiliados continuam desfiliados, apenas sem os novos campos preenchidos
-- (o que é honesto — aquele dado nunca foi coletado).

-- ---------------------------------------------------------------------------
-- 1) Motivo padronizado
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MotivoDesfiliacao') THEN
    CREATE TYPE "MotivoDesfiliacao" AS ENUM (
      'APOSENTADORIA',
      'MUDANCA_ESTADO',
      'MUDANCA_PROFISSAO',
      'SOLICITACAO_PESSOAL',
      'INADIMPLENCIA',
      'OUTROS'
    );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Campos da desfiliação no cadastro do filiado
-- ---------------------------------------------------------------------------
ALTER TABLE "filiados"
  ADD COLUMN IF NOT EXISTS "motivo_desfiliacao"      "MotivoDesfiliacao",
  ADD COLUMN IF NOT EXISTS "desfiliacao_observacoes" TEXT,
  ADD COLUMN IF NOT EXISTS "desfiliado_em"           TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "desfiliado_por"          TEXT,
  ADD COLUMN IF NOT EXISTS "desfiliacao_mes_corte"   TEXT;

-- ---------------------------------------------------------------------------
-- 3) Tipo de documento para o termo assinado
--
-- Faz o termo assinado aparecer CATEGORIZADO na aba Documentos, em vez de cair
-- no genérico "OUTRO" junto com RG e comprovante de residência.
-- ---------------------------------------------------------------------------
ALTER TYPE "TipoDocumento" ADD VALUE IF NOT EXISTS 'TERMO_DESFILIACAO';
