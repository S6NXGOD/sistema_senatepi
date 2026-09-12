-- PARTES QUE O DIÁRIO CONHECE E A FICHA NÃO TINHA.
--
-- Medido na produção em 12/09/2026: das 108 fichas com publicação, 43 têm parte
-- que o tribunal nomeia no ato e que nunca foi cadastrada aqui — 51 partes ao
-- todo. Não é descuido de quem digita: o DataJud não devolve partes (é a razão
-- de a aba existir), então tudo dependia de alguém copiar do PJe à mão.
--
-- A varredura da madrugada passa a repor o que é PROVÁVEL e a propor o resto.
-- Estas duas colunas são o que separa uma coisa da outra ao longo do tempo.
--
-- ADITIVA E IDEMPOTENTE, como exige a janela de troca do deploy: o contêiner
-- antigo continua atendendo contra o banco já migrado, então nada de rename,
-- nada de NOT NULL sem default, nada de remoção.

-- 1. DE ONDE VEIO A PARTE. Nulo = o histórico, que é anterior a esta distinção
--    e presume-se digitado por gente (o robô nunca havia escrito aqui).
ALTER TABLE "partes_processo" ADD COLUMN IF NOT EXISTS "origem" TEXT;

-- 2. A LÁPIDE. Sem ela, apagar à mão uma parte que o robô pôs é inútil: na
--    madrugada seguinte ela volta, porque o Diário continua nomeando-a. O
--    sistema já aprendeu isto com os advogados (`processos_advogados_dispensados`)
--    e com o alarme que contradizia o robô — decisão de gente tem de deixar
--    marca, senão o robô a desfaz achando que está ajudando.
--
--    A chave é o NOME NORMALIZADO e não o id: a linha apagada não existe mais,
--    e o que precisa ser reconhecido na próxima rodada é o nome que o tribunal
--    vai repetir.
CREATE TABLE IF NOT EXISTS "partes_processo_dispensadas" (
  "processo_id"  TEXT NOT NULL,
  "nome_chave"   TEXT NOT NULL,
  "nome"         TEXT NOT NULL,
  "dispensado_em"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dispensado_por" TEXT,
  CONSTRAINT "partes_processo_dispensadas_pkey" PRIMARY KEY ("processo_id", "nome_chave")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'partes_processo_dispensadas_processo_id_fkey'
  ) THEN
    ALTER TABLE "partes_processo_dispensadas"
      ADD CONSTRAINT "partes_processo_dispensadas_processo_id_fkey"
      FOREIGN KEY ("processo_id") REFERENCES "processos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'partes_processo_dispensadas_dispensado_por_fkey'
  ) THEN
    ALTER TABLE "partes_processo_dispensadas"
      ADD CONSTRAINT "partes_processo_dispensadas_dispensado_por_fkey"
      FOREIGN KEY ("dispensado_por") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "partes_processo_dispensadas_processo_id_idx"
  ON "partes_processo_dispensadas"("processo_id");
