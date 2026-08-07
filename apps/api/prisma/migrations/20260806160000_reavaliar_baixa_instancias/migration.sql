-- RECÁLCULO DA BAIXA DAS INSTÂNCIAS JÁ GRAVADAS.
--
-- POR QUE ISTO NÃO PODE ESPERAR A PRÓXIMA SINCRONIZAÇÃO
-- A regra de `instanciaBaixada` mudou: antes, um grau que recebia trânsito em
-- julgado só voltava a contar como vivo se aparecesse o código 893
-- (Desarquivamento). Na Justiça do Trabalho isso não acontece — depois do
-- trânsito vem "Liquidação iniciada" e a execução corre por meses no MESMO
-- grau, sem desarquivamento nenhum. Foi o que deu como encerrado o processo
-- 0000600-48.2023.5.22.0108, com 125 andamentos posteriores à baixa.
--
-- Corrigir só o código não bastaria, e é aqui que está a armadilha: a varredura
-- noturna busca processos ATIVO/PENDENTE, mais os ENCERRADOS que tenham alguma
-- instância NÃO baixada. Um processo indevidamente encerrado tem todas as
-- instâncias marcadas como baixadas — logo ele nunca mais seria consultado, e a
-- regra nova jamais rodaria sobre ele. O dado errado se protegia sozinho.
--
-- Este UPDATE reavalia com os andamentos QUE JÁ ESTÃO NO BANCO — nenhuma
-- chamada ao CNJ. A regra é a mesma do código, escrita em SQL:
--   baixada  ⇔  existe baixa (22 ou 848), nenhum desarquivamento (893) em dia
--               igual ou posterior a ela, e nenhum andamento em dia POSTERIOR.
-- A comparação é por DIA, e não por instante, porque a publicação e a expedição
-- do próprio arquivamento saem no mesmo dia da baixa — comparar por timestamp
-- faria o eco do arquivamento ressuscitar a instância.
--
-- O status do processo NÃO é mexido aqui de propósito: com a instância marcada
-- como viva, a varredura volta a alcançá-lo e `reavaliarStatusPorInstancias`
-- reabre o processo pelo caminho normal, registrando a movimentação interna que
-- explica a reabertura. Corrigir o status direto no SQL puularia esse histórico.

WITH dias AS (
  SELECT
    m.instancia_id,
    MAX(m.data_movimento::date)                                                    AS ultimo_dia,
    MAX(m.data_movimento::date) FILTER (WHERE m.codigo_movimento IN (22, 848))     AS dia_baixa,
    MAX(m.data_movimento::date) FILTER (WHERE m.codigo_movimento = 893)            AS dia_desarquivamento
  FROM "movimentacoes_processuais" m
  WHERE m.instancia_id IS NOT NULL
  GROUP BY m.instancia_id
)
UPDATE "processos_instancias" i
   SET "baixada" = COALESCE(
         d.dia_baixa IS NOT NULL
         AND (d.dia_desarquivamento IS NULL OR d.dia_desarquivamento < d.dia_baixa)
         AND d.ultimo_dia <= d.dia_baixa,
         FALSE
       ),
       "updated_at" = NOW()
  FROM dias d
 WHERE d.instancia_id = i.id
   AND i."baixada" IS DISTINCT FROM COALESCE(
         d.dia_baixa IS NOT NULL
         AND (d.dia_desarquivamento IS NULL OR d.dia_desarquivamento < d.dia_baixa)
         AND d.ultimo_dia <= d.dia_baixa,
         FALSE
       );

-- Instância sem nenhum andamento não pode ser dada como baixada: não há o que
-- comprove a baixa, e mantê-la marcada a deixaria fora da varredura para sempre.
-- É a mesma resposta da função pura para lista vazia.
UPDATE "processos_instancias" i
   SET "baixada" = FALSE, "updated_at" = NOW()
 WHERE i."baixada" = TRUE
   AND NOT EXISTS (
     SELECT 1 FROM "movimentacoes_processuais" m WHERE m.instancia_id = i.id
   );
