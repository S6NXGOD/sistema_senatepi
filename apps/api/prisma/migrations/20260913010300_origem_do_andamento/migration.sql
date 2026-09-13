-- POR ONDE O ANDAMENTO ENTROU.
--
-- "Andamentos internos" nos Relatórios deveria contar o trabalho que alguém
-- LANÇOU na ficha do processo. Contava também o eco: concluir uma atividade
-- ligada a processo escreve sozinho "Prazo X — Peça protocolada." como
-- andamento, com o nome de quem concluiu. Medido em 12/09/2026: 17 dos 106
-- andamentos com autor em 90 dias (16%) eram esse eco — a mesma ação contada
-- duas vezes, uma na agenda e outra no processo.
--
-- `origem_sistema` não resolve: ela diz se a AUTORIA é do robô, e a nota da
-- conclusão tem autor humano. Esta coluna responde outra pergunta — qual
-- caminho escreveu:
--   CONCLUSAO  eco da conclusão de uma atividade
--   CONVERSAO  a conversa que abriu o caso pré-processual
--   IMPORTACAO planilha de processos
--   NULO       lançado à mão pela ficha — o único que conta como andamento
--
-- ADITIVA E IDEMPOTENTE: coluna nula; o contêiner antigo não a conhece. As
-- três atualizações abaixo só tocam linha com `origem IS NULL`, então rodar
-- de novo não muda nada. O único gatilho da tabela é AFTER INSERT
-- (`trg_ultimo_movimento_interno`): o UPDATE não mexe em `ultimo_movimento_em`.
ALTER TABLE "movimentacoes_internas" ADD COLUMN IF NOT EXISTS "origem" TEXT;

-- --------------------------------------------------------- backfill: CONVERSAO
-- VEM PRIMEIRO, e a ordem importa. Quando o desfecho abre um caso
-- pré-processual, a conclusão NÃO grava eco (o caso já nasce com a conversa
-- como 1º andamento, em `criarPreProcessual`) — mas essa conversa é escrita
-- pelo mesmo autor, no processo que passa a ser o da atividade, milissegundos
-- antes de `concluido_em`. A regra do eco, sozinha, a rotularia CONCLUSAO.
--
-- A marca é o próprio caso: processo com `origem_compromisso_id`, e a nota
-- gravada na mesma transação que o criou (±5 s de `created_at`). Nenhum
-- caminho de gente escreve andamento nesse intervalo.
UPDATE "movimentacoes_internas" m
   SET "origem" = 'CONVERSAO'
  FROM "processos" p
 WHERE m."origem" IS NULL
   AND m."origem_sistema" = false
   AND m."processo_id" = p."id"
   AND p."origem_compromisso_id" IS NOT NULL
   AND m."tipo" = 'ATUALIZACAO'
   AND m."created_at" BETWEEN p."created_at" - INTERVAL '5 seconds'
                          AND p."created_at" + INTERVAL '5 seconds';

-- --------------------------------------------------------- backfill: CONCLUSAO
-- O eco é gravado na MESMA transação que marca a atividade como concluída, pelo
-- mesmo usuário, no processo dela. Janela de ±5 s entre as duas escritas.
--
-- Duas âncoras, porque `concluido_em` guarda só a ÚLTIMA conclusão: quem
-- concluiu, reabriu e concluiu de novo deixou um eco da primeira vez que a
-- coluna já não alcança. A linha CONCLUIDO de `compromissos_historico` (gravada
-- logo depois da transação, com o mesmo autor) guarda todas.
--
-- Comparação direta entre colunas TIMESTAMP(3) gravadas em UTC pelo Prisma —
-- sem `AT TIME ZONE`, que em coluna sem fuso SOMARIA 3 horas.
UPDATE "movimentacoes_internas" m
   SET "origem" = 'CONCLUSAO'
 WHERE m."origem" IS NULL
   AND m."autor_id" IS NOT NULL
   AND m."origem_sistema" = false
   AND EXISTS (
     SELECT 1
       FROM "compromissos" c
      WHERE c."processo_id" = m."processo_id"
        AND (
              (    c."status" = 'CONCLUIDO'
               AND c."concluido_por" = m."autor_id"
               AND c."concluido_em" BETWEEN m."created_at" - INTERVAL '5 seconds'
                                        AND m."created_at" + INTERVAL '5 seconds')
           OR EXISTS (
                SELECT 1
                  FROM "compromissos_historico" h
                 WHERE h."compromisso_id" = c."id"
                   AND h."acao" = 'CONCLUIDO'
                   AND h."autor_id" = m."autor_id"
                   AND h."created_at" BETWEEN m."created_at" - INTERVAL '5 seconds'
                                          AND m."created_at" + INTERVAL '5 seconds')
            )
   );

-- -------------------------------------------------------- backfill: IMPORTACAO
-- A planilha de processos grava, para cada linha com andamento, uma nota
-- `ATUALIZACAO` em nome de quem subiu o arquivo, com `origem_sistema` falso
-- (a frase é de gente do jurídico). O código novo já grava IMPORTACAO; as notas
-- da carga de 31/08/2026 nasceram antes da coluna. Sem esta atualização, quem
-- subiu a planilha apareceria nos Relatórios com 82 andamentos lançados à mão.
--
-- Medido na produção em 13/09/2026, em leitura: dos 106 andamentos com autor
-- humano, 14 casam com o eco da conclusão e 5 com a conversa do pré-processual;
-- esta seleção pega EXATAMENTE 82 — todos do mesmo autor, gravados em 31/08
-- entre 21:51 e 21:53 UTC. Sobram 5, os lançados à mão.
--
-- A linha da importação não guarda o id do processo. A marca é o par texto do
-- andamento + NPU da linha, comparado só pelos dígitos (a planilha pode trazer
-- o número com ou sem máscara). Roda por último: o que já virou CONVERSAO ou
-- CONCLUSAO não é tocado.
UPDATE "movimentacoes_internas" m
   SET "origem" = 'IMPORTACAO'
  FROM "processos" p
 WHERE m."origem" IS NULL
   AND m."origem_sistema" = false
   AND m."autor_id" IS NOT NULL
   AND m."tipo" = 'ATUALIZACAO'
   AND m."processo_id" = p."id"
   AND EXISTS (
     SELECT 1
       FROM "importacao_linhas" l
       JOIN "importacoes" i ON i."id" = l."importacao_id"
      WHERE i."perfil"::text = 'PROCESSOS_CSV'
        AND l."dados"::jsonb->>'andamento' = m."descricao"
        AND regexp_replace(coalesce(l."dados"::jsonb->>'npu', ''), '\D', '', 'g')
          = regexp_replace(coalesce(p."numero_cnj", ''), '\D', '', 'g')
   );
