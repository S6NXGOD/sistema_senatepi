-- ---------------------------------------------------------------------------
-- "NÃO SÃO A MESMA ORGANIZAÇÃO" — a decisão humana que a varredura respeita.
--
-- POR QUE ISTO EXISTE, e não é acessório.
--
-- A comparação de nomes nunca vai ser perfeita, e não precisa ser. Medido no
-- cadastro real da produção em 21/08/2026: 4 pares apontados, 2 falsos. Depois
-- de tratar topônimo como ruído, sobraram 2 — um deles verdadeiro
-- ("PRONTOCARE" e "PRONTOCARE CLINICA E ATENDIMENTOS LTDA") e um falso
-- ("MUNICÍPIO DE PALMEIRAIS" e "Profissionais de Enfermagem de Palmeirais").
--
-- Um falso positivo em dois é tolerável SE der para descartá-lo. Sem descarte,
-- ele reaparece em toda visita, a fila nunca esvazia, e em duas semanas ninguém
-- mais abre o painel — inclusive quando houver duplicata de verdade. É a
-- diferença entre uma fila que converge e uma lista que vira paisagem.
--
-- O PAR É GUARDADO ORDENADO (a_id < b_id) e o CHECK garante isso. Sem a ordem
-- canônica, descartar (A,B) deixaria (B,A) aparecendo de novo — o mesmo erro
-- que a varredura já evita ao montar a chave do par.
--
-- ON DELETE CASCADE nos dois lados: quando uma das organizações some (numa
-- mesclagem, por exemplo), o descarte perde o sentido e vai junto.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "partes_externas_nao_duplicadas" (
  "a_id"           TEXT NOT NULL,
  "b_id"           TEXT NOT NULL,
  "descartado_por" TEXT,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "partes_externas_nao_duplicadas_pkey" PRIMARY KEY ("a_id", "b_id"),
  CONSTRAINT "partes_externas_nao_duplicadas_ordem_check" CHECK ("a_id" < "b_id")
);

DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'partes_externas_nao_duplicadas_a_id_fkey') THEN
    ALTER TABLE "partes_externas_nao_duplicadas"
      ADD CONSTRAINT "partes_externas_nao_duplicadas_a_id_fkey"
      FOREIGN KEY ("a_id") REFERENCES "partes_externas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'partes_externas_nao_duplicadas_b_id_fkey') THEN
    ALTER TABLE "partes_externas_nao_duplicadas"
      ADD CONSTRAINT "partes_externas_nao_duplicadas_b_id_fkey"
      FOREIGN KEY ("b_id") REFERENCES "partes_externas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $mig$;

CREATE INDEX IF NOT EXISTS "partes_externas_nao_duplicadas_b_id_idx"
  ON "partes_externas_nao_duplicadas"("b_id");
