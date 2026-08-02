-- Decisões sobre pares de filiados possivelmente duplicados.
--
-- POR QUE ESTA TABELA GUARDA DECISÕES E NÃO GRUPOS
-- A detecção de duplicidade é função pura dos dados atuais: se alguém corrigir
-- um nome, o grupo muda. Persistir os grupos criaria uma lista que envelhece
-- sozinha e passa a mentir. O que precisa sobreviver é o JULGAMENTO humano —
-- "olhei estes dois e são pessoas diferentes" — para que o par não volte a ser
-- apresentado em toda varredura.
--
-- Também é o registro permanente de que a limpeza aconteceu. A ferramenta que
-- lê esta tabela é temporária (mutirão de higienização da carga legada); a
-- tabela não é. Apagar a ferramenta um dia é higiene; apagar o rastro do que
-- ela fez seria destruir a auditoria do momento em que o sistema mais mexeu
-- nos dados dos associados.

CREATE TYPE "DecisaoDuplicata" AS ENUM ('DISTINTOS', 'FUNDIDO');

CREATE TABLE "duplicata_decisao" (
  "id"            TEXT NOT NULL,
  -- O par é gravado SEMPRE com filiado_id_a < filiado_id_b. Sem essa
  -- normalização, (X,Y) e (Y,X) seriam linhas diferentes e o índice único não
  -- impediria a mesma decisão de ser registrada duas vezes — o par voltaria a
  -- aparecer na varredura dependendo da ordem em que o SQL devolvesse as
  -- linhas.
  "filiado_id_a"  TEXT NOT NULL,
  "filiado_id_b"  TEXT NOT NULL,
  "decisao"       "DecisaoDuplicata" NOT NULL,
  -- Nome de quem decidiu, em texto: é snapshot e sobrevive à exclusão do
  -- usuário, no mesmo padrão de `desfiliado_por` em filiados.
  "autor"         TEXT,
  -- Na fusão, guarda o que foi absorvido e os dados do registro apagado
  -- (matrícula, CPF, nome). É a única memória de que aquele cadastro existiu.
  "metadata"      JSONB,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "duplicata_decisao_pkey" PRIMARY KEY ("id"),
  -- Garante a normalização acima no próprio banco, não só na aplicação.
  CONSTRAINT "duplicata_decisao_ordem_check" CHECK ("filiado_id_a" < "filiado_id_b")
);

CREATE UNIQUE INDEX "duplicata_decisao_par_key"
  ON "duplicata_decisao"("filiado_id_a", "filiado_id_b");

-- Consultados para filtrar a varredura: dado um filiado, quais pares dele já
-- foram julgados.
CREATE INDEX "duplicata_decisao_a_idx" ON "duplicata_decisao"("filiado_id_a");
CREATE INDEX "duplicata_decisao_b_idx" ON "duplicata_decisao"("filiado_id_b");

-- SEM chave estrangeira para `filiados`, de propósito.
--
-- Numa fusão, o registro descartado é APAGADO. Com FK e ON DELETE CASCADE, a
-- decisão que registra a fusão seria destruída pela própria fusão — o rastro
-- sumiria no exato instante em que passa a ser necessário. Com ON DELETE
-- RESTRICT, a fusão nem aconteceria. O id do filiado apagado fica aqui como
-- referência histórica, igual a um número de nota fiscal: aponta para algo que
-- não existe mais, e é exatamente esse o ponto.
