-- ARQUIVAMENTO DEFINITIVO (TPU 246) PASSA A ENCERRAR A INSTÂNCIA.
--
-- O QUE ESTAVA ERRADO
-- A regra reconhecia como encerramento apenas Baixa Definitiva (22) e Trânsito
-- em julgado (848). Faltava o 246 — "Definitivo", o arquivamento —, que é a
-- forma MAIS COMUM de um processo trabalhista terminar. Contagem no índice do
-- TRT22 em 07/08/2026:
--
--   246  171.261 documentos
--   848  102.083
--   22    40.890
--
-- Consequência: todo processo arquivado continuava marcado como VIVO. Ficava na
-- varredura noturna para sempre, gastando chamada ao CNJ, e a lista o exibia em
-- "Execução" meses depois do fim. Caso conferido: 0001000-26.2022.5.22.0002 —
-- execução extinta em 24/11/2025, arquivado em 02/02/2026, e ainda aparecendo
-- como processo em andamento.
--
-- Este UPDATE reavalia com os andamentos QUE JÁ ESTÃO NO BANCO, sem chamar o
-- CNJ, pela mesma regra do código: baixada ⇔ existe encerramento (22, 246 ou
-- 848), nenhum desarquivamento (893) em dia igual ou posterior, e nenhum
-- andamento em dia POSTERIOR. Comparação por DIA porque a publicação e a
-- expedição do próprio arquivamento saem no mesmo dia dele.
--
-- O STATUS do processo não é tocado aqui: com a instância marcada corretamente,
-- a varredura noturna chama `reavaliarStatusPorInstancias`, que encerra o
-- processo pelo caminho normal e registra a movimentação interna explicando.

WITH dias AS (
  SELECT
    m.instancia_id,
    MAX(m.data_movimento::date)                                                     AS ultimo_dia,
    MAX(m.data_movimento::date) FILTER (WHERE m.codigo_movimento IN (22, 246, 848)) AS dia_baixa,
    MAX(m.data_movimento::date) FILTER (WHERE m.codigo_movimento = 893)             AS dia_desarquivamento
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
