-- RODÍZIO DA VARREDURA COMPLEMENTAR DO DJEN.
--
-- O PROBLEMA DE ESCALA
-- O DJEN permite 20 requisições por minuto por IP (cabeçalho X-RateLimit-Limit)
-- e corta com 403 quando estoura. A varredura por OAB resolve o caso comum com
-- uma chamada por advogado; a varredura complementar — processo a processo —
-- existe para a exceção (processo em que a OAB do sindicato não consta do polo)
-- e custa UMA REQUISIÇÃO POR PROCESSO.
--
-- Com o acervo crescendo, essa lista cresce junto e a rodada passaria de uma
-- hora, depois de duas, até estourar o prazo da trava do job — e duas execuções
-- passariam a se sobrepor. A saída não é acelerar (a cota é do CNJ, não nossa):
-- é limitar quantos processos entram por noite e garantir que TODOS sejam
-- alcançados ao longo dos dias.
--
-- Este carimbo é o que permite o rodízio: a consulta ordena por ele, com os
-- nunca consultados primeiro. NULO = nunca foi consultado individualmente, que
-- é o estado de todo o acervo hoje.

ALTER TABLE "processos"
  ADD COLUMN IF NOT EXISTS "ultima_consulta_djen" TIMESTAMP(3);

-- Sustenta o ORDER BY do rodízio sem varrer a tabela inteira a cada noite.
-- NULLS FIRST casa com a ordenação usada pelo robô (quem nunca foi consultado
-- tem prioridade sobre quem já foi).
CREATE INDEX IF NOT EXISTS "processos_ultima_consulta_djen_idx"
  ON "processos"("ultima_consulta_djen" ASC NULLS FIRST);
