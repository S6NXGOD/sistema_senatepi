-- ANDAMENTOS DUPLICADOS ENTRE INSTÂNCIAS.
--
-- O QUE ACONTECEU
-- O backfill apontou para a instância herdada TODOS os andamentos do processo,
-- porque naquele momento existia uma instância por processo. Quando o parser
-- multi-instância passou a devolver dois graus, os andamentos do outro grau
-- foram inseridos DE NOVO na instância nova — a chave de deduplicação é por
-- instância, de propósito, já que 1º e 2º grau praticam atos homônimos e
-- tratá-los como o mesmo fato apagaria o andamento de um dos dois.
--
-- MEDIDO NA PRODUÇÃO em 07/08/2026: no 0001000-26.2022.5.22.0002, 148 atos
-- praticados pela 2ª Vara do Trabalho de Teresina (1º grau) estavam também
-- pendurados na instância do 2º grau (Gabinete do Desembargador). O processo
-- contava 379 andamentos onde o CNJ tem 293; a linha do tempo mostrava tudo
-- duas vezes e a contagem por instância mentia.
--
-- O CRITÉRIO É CONSERVADOR — só apaga a cópia quando as TRÊS coisas valem:
--   1. o mesmo ato (data, código e descrição) está em duas instâncias do mesmo
--      processo, ou seja, é comprovadamente uma cópia;
--   2. o ato registra o ÓRGÃO que o praticou, e esse órgão é o de outra
--      instância do processo — é a prova de a qual grau ele pertence;
--   3. a instância dona (a do órgão) tem o ato.
-- Ato sem órgão, ou cujo órgão não bate com nenhuma instância, fica intocado:
-- na dúvida, preservar histórico.
--
-- A prevenção está no código (`redistribuirAndamentos`), que agora MOVE o
-- andamento para a instância certa antes de mesclar, em vez de deixar duplicar.

DELETE FROM "movimentacoes_processuais" m
 USING "processos_instancias" i_atual, "processos_instancias" i_dona
 WHERE m."instancia_id" = i_atual."id"
   AND i_dona."processo_id" = i_atual."processo_id"
   AND i_dona."id" <> i_atual."id"
   -- (2) o órgão do ato é o de OUTRA instância, e não o da instância em que ele está
   AND m."orgao_julgador" IS NOT NULL
   AND i_dona."orgao_julgador" IS NOT NULL
   AND upper(m."orgao_julgador") = upper(i_dona."orgao_julgador")
   AND upper(COALESCE(i_atual."orgao_julgador", '')) <> upper(m."orgao_julgador")
   -- (1) e (3) a instância dona tem o MESMO ato: é cópia, não perda de histórico
   AND EXISTS (
     SELECT 1 FROM "movimentacoes_processuais" m2
      WHERE m2."instancia_id" = i_dona."id"
        AND m2."data_movimento" = m."data_movimento"
        AND m2."descricao" = m."descricao"
        AND m2."codigo_movimento" IS NOT DISTINCT FROM m."codigo_movimento"
   );

-- Os derivados da instância (último movimento e baixa) foram calculados sobre o
-- conjunto inflado — recalcula com a mesma regra do código.
WITH dias AS (
  SELECT
    m.instancia_id,
    MAX(m.data_movimento)                                                           AS ultimo_movimento,
    MAX(m.data_movimento::date)                                                     AS ultimo_dia,
    MAX(m.data_movimento::date) FILTER (WHERE m.codigo_movimento IN (22, 246, 848)) AS dia_baixa,
    MAX(m.data_movimento::date) FILTER (WHERE m.codigo_movimento = 893)             AS dia_desarquivamento
  FROM "movimentacoes_processuais" m
  WHERE m.instancia_id IS NOT NULL
  GROUP BY m.instancia_id
)
UPDATE "processos_instancias" i
   SET "ultimo_movimento_em" = d.ultimo_movimento,
       "baixada" = COALESCE(
         d.dia_baixa IS NOT NULL
         AND (d.dia_desarquivamento IS NULL OR d.dia_desarquivamento < d.dia_baixa)
         AND d.ultimo_dia <= d.dia_baixa,
         FALSE
       ),
       "updated_at" = NOW()
  FROM dias d
 WHERE d.instancia_id = i.id;
