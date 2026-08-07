-- O ÍNDICE DE DEDUPLICAÇÃO PASSA A INCLUIR O DETALHE.
--
-- O CNJ devolve, com o MESMO carimbo de tempo, código e nome, movimentos que
-- dizem coisas OPOSTAS. Medido no 0000600-48.2023.5.22.0108 em 07/08/2026:
--
--   2023-11-30T11:43:04  cod 12747 "Inicial"  situacao_da_audiencia = designada
--   2023-11-30T11:43:04  cod 12747 "Inicial"  situacao_da_audiencia = cancelada
--   2024-02-05T14:49:21  idem
--
-- São dois fatos — a designação e o cancelamento —, registrados no mesmo
-- instante pelo tribunal. Com a chave antiga (instância, data, código,
-- descrição) um dos dois era descartado, e qual sobrevivia dependia da ordem em
-- que o Elasticsearch devolvesse. Uma audiência CANCELADA podia ficar gravada
-- como designada — mandando o advogado a uma audiência que não existe — ou o
-- contrário, escondendo uma que existe. O segundo caso é o pior.
--
-- `detalhe` é o texto montado a partir dos complementos tabelados, então
-- distingue os dois sem inventar campo novo.
--
-- COALESCE no índice porque no Postgres dois NULL são distintos: sem ele, o
-- índice deixaria de barrar duplicata em todo movimento sem complemento — que
-- é a maioria.

DROP INDEX IF EXISTS "movimentacoes_processuais_dedup_key";

CREATE UNIQUE INDEX "movimentacoes_processuais_dedup_key"
  ON "movimentacoes_processuais"(
    "instancia_id", "data_movimento", "codigo_movimento", "descricao", (COALESCE("detalhe", ''))
  )
  WHERE "instancia_id" IS NOT NULL AND "codigo_movimento" IS NOT NULL;
