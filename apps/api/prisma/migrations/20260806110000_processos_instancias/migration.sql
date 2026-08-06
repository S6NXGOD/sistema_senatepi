-- INSTÂNCIAS DO PROCESSO — uma linha por grau do mesmo número.
--
-- O QUE ISTO CORRIGE
-- A API do DataJud devolve UM DOCUMENTO POR GRAU, todos no mesmo índice do
-- tribunal e distinguidos pelo `_id` (`TJPI_G1_<npu>`, `TJPI_G2_<npu>`). Cada
-- documento traz o PRÓPRIO array de movimentos. Consulta real ao NPU
-- 0831236-24.2023.8.18.0140: o G2 tem 16 movimentos, o G1 tem 42.
--
-- O cliente lia `hits.hits[0]` e ignorava o resto. Qual dos dois graus
-- sobrevivia dependia da ordenação por relevância do Elasticsearch — não de
-- nenhuma regra — e as movimentações do outro nunca chegavam ao banco. Um
-- processo com apelação no 2º grau e cumprimento de sentença correndo no 1º
-- mostrava metade da vida processual, sem qualquer sinal de que faltava algo.
--
-- POR QUE NÃO BASTOU RELAXAR `processos.numero_cnj UNIQUE`
-- Porque não é isso que o dado é. É UM processo — mesma parte, mesmo filiado,
-- mesmo advogado responsável, mesma pasta. O que existe em duplicidade é o
-- GRAU. Duplicar a linha de `processos` obrigaria a duplicar também partes,
-- vínculo de filiado, anexos e atividades, e faria a lista mostrar o mesmo
-- processo duas vezes.

CREATE TABLE "processos_instancias" (
  "id"          TEXT NOT NULL,
  "processo_id" TEXT NOT NULL,

  -- `_id` do documento no DataJud. É a chave natural: identifica o documento do
  -- jeito que o próprio CNJ o identifica, e sobrevive a mudanças de órgão
  -- julgador (que acontecem quando o processo é redistribuído).
  "doc_id"      TEXT NOT NULL,
  -- G1 | G2 | JE | TR. TEXT e não enum: cada tribunal usa um subconjunto e
  -- valores novos aparecem sem aviso — um enum exigiria migração para
  -- descobrir um grau que já está em produção.
  "grau"        TEXT NOT NULL,
  "tribunal"    TEXT NOT NULL,

  "classe_processual"     TEXT,
  "classe_codigo"         INTEGER,
  "orgao_julgador"        TEXT,
  "orgao_julgador_codigo" TEXT,
  "data_distribuicao"     TIMESTAMP(3),
  "nivel_sigilo"          INTEGER,
  "formato"               TEXT,
  "sistema"               TEXT,
  "atualizado_no_cnj_em"  TIMESTAMP(3),

  -- Data do movimento MAIS RECENTE desta instância.
  --
  -- ATENÇÃO a quem for mexer nisto: NÃO use `atualizado_no_cnj_em` para decidir
  -- qual instância está viva. Aquele campo é o carimbo de INGESTÃO do CNJ e vem
  -- praticamente idêntico nos dois graus — verificado no NPU acima: ambos
  -- 2026-08-03, enquanto o último movimento real era 2026-05 no G2 e 2025-11 no
  -- G1. Escolher por ele elegeria a instância errada de forma consistente.
  "ultimo_movimento_em"   TIMESTAMP(3),

  -- Baixa Definitiva (TPU 22) ou Trânsito em julgado (848), sem Desarquivamento
  -- (893) posterior. Códigos conferidos contra o índice do TJPI.
  "baixada"   BOOLEAN NOT NULL DEFAULT false,
  -- Instância que alimenta os atalhos de `processos`.
  "principal" BOOLEAN NOT NULL DEFAULT false,

  "ultima_sincronizacao" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "processos_instancias_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "processos_instancias"
  ADD CONSTRAINT "processos_instancias_processo_id_fkey"
  FOREIGN KEY ("processo_id") REFERENCES "processos"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "processos_instancias_processo_id_doc_id_key"
  ON "processos_instancias"("processo_id", "doc_id");
CREATE INDEX "processos_instancias_processo_id_idx"
  ON "processos_instancias"("processo_id");

-- No máximo uma instância principal por processo — mesma técnica já usada em
-- `processos_advogados_principal_key`. Sem isto, uma falha no meio da
-- sincronização deixaria duas principais e os atalhos de `processos` passariam
-- a depender da ordem da consulta.
CREATE UNIQUE INDEX "processos_instancias_principal_key"
  ON "processos_instancias"("processo_id") WHERE "principal";


-- ---------------------------------------------------------------------------
-- De qual grau veio cada andamento.
-- ---------------------------------------------------------------------------

ALTER TABLE "movimentacoes_processuais"
  ADD COLUMN IF NOT EXISTS "instancia_id" TEXT;

ALTER TABLE "movimentacoes_processuais"
  ADD CONSTRAINT "movimentacoes_processuais_instancia_id_fkey"
  FOREIGN KEY ("instancia_id") REFERENCES "processos_instancias"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "movimentacoes_processuais_instancia_id_idx"
  ON "movimentacoes_processuais"("instancia_id");


-- ---------------------------------------------------------------------------
-- BACKFILL — uma instância para cada processo que já existe.
--
-- Não chama o CNJ: usa os metadados que já estão em `processos`. As instâncias
-- que faltam (o outro grau) entram na primeira varredura noturna depois de
-- ligar DATAJUD_MULTI_INSTANCIA. Assim o sistema nunca fica num estado em que
-- há movimentação sem instância enquanto a flag está desligada.
--
-- Idempotente por construção: o `NOT EXISTS` evita recriar, e a migração pode
-- ser reaplicada numa cópia sem efeito colateral.
-- ---------------------------------------------------------------------------

INSERT INTO "processos_instancias" (
  "id", "processo_id", "doc_id", "grau", "tribunal",
  "classe_processual", "classe_codigo", "orgao_julgador", "orgao_julgador_codigo",
  "data_distribuicao", "nivel_sigilo", "formato", "sistema", "atualizado_no_cnj_em",
  "ultimo_movimento_em", "principal", "ultima_sincronizacao", "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text,
  p."id",
  -- Reproduz o formato do `_id` do CNJ para que a próxima sincronização
  -- reconheça esta linha como a MESMA instância e a atualize, em vez de criar
  -- uma segunda ao lado. `COALESCE(grau, 'G1')` porque processos importados
  -- antes de o campo existir vieram sem grau, e 1º grau é o caso esmagador.
  COALESCE(p."tribunal", 'ND') || '_' || COALESCE(p."grau", 'G1') || '_' || p."numero_cnj",
  COALESCE(p."grau", 'G1'),
  COALESCE(p."tribunal", 'ND'),
  p."classe_processual", p."classe_codigo", p."orgao_julgador", p."orgao_julgador_codigo",
  p."data_distribuicao", p."nivel_sigilo", p."formato", p."sistema", p."atualizado_no_cnj_em",
  -- Último andamento conhecido, direto da tabela de movimentações: é o valor
  -- correto do campo e evita uma segunda passada para preenchê-lo.
  (SELECT MAX(m."data_movimento") FROM "movimentacoes_processuais" m WHERE m."processo_id" = p."id"),
  true,
  p."ultima_sincronizacao",
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "processos" p
WHERE p."numero_cnj" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "processos_instancias" i WHERE i."processo_id" = p."id");

-- Todo andamento já gravado pertence à instância recém-criada: até aqui só
-- existia uma por processo, então não há ambiguidade.
UPDATE "movimentacoes_processuais" m
   SET "instancia_id" = i."id"
  FROM "processos_instancias" i
 WHERE i."processo_id" = m."processo_id"
   AND m."instancia_id" IS NULL;


-- ---------------------------------------------------------------------------
-- DEDUP DE MOVIMENTAÇÃO NO BANCO.
--
-- O merge do DataJud deduplica em MEMÓRIA, pela trinca (data, código TPU,
-- descrição), e insere com `createMany` sem `skipDuplicates`. Isso funciona
-- enquanto uma sincronização roda por vez. Não é o caso: o botão "Sincronizar"
-- da ficha e o robô das 02:00 podem coincidir, e com duas réplicas da API duas
-- varreduras podiam rodar juntas. Ambas leem "não existe", ambas inserem.
--
-- O índice torna a duplicata impossível no lugar certo — o banco —, o que
-- também deixa o `skipDuplicates` do código ser uma otimização e não a única
-- linha de defesa.
--
-- A CHAVE É A INSTÂNCIA, NÃO O PROCESSO
-- Cada grau tem o próprio andamento, e nada impede que o 1º e o 2º pratiquem o
-- mesmo ato ("Conclusão", TPU 51) no mesmo instante — são dois fatos distintos,
-- em dois juízos. Um índice por `processo_id` trataria isso como duplicata e
-- derrubaria a sincronização com violação de unicidade, justamente nos
-- processos que a funcionalidade nova veio atender.
--
-- POR QUE PARCIAL
-- Em Postgres, NULL nunca é igual a NULL: linhas sem código TPU ou sem
-- instância jamais colidiriam, e o índice as carregaria sem nunca protegê-las.
-- Deixá-las de fora diz isso explicitamente, em vez de fingir uma garantia que
-- não existe. Na prática a cobertura é total: só chega aqui movimentação vinda
-- do CNJ, que sempre tem instância (o backfill acima) e quase sempre código.
--
-- ⚠️ SE ESTA MIGRAÇÃO FALHAR AQUI, há duplicatas preexistentes. Rode antes:
--   SELECT processo_id, data_movimento, codigo_movimento, descricao, count(*)
--     FROM movimentacoes_processuais
--    WHERE codigo_movimento IS NOT NULL
--    GROUP BY 1,2,3,4 HAVING count(*) > 1;
-- ---------------------------------------------------------------------------

-- Remove duplicatas preexistentes ANTES de criar o índice.
--
-- Particiona por `processo_id` e não por `instancia_id` de propósito: neste
-- ponto cada processo tem exatamente UMA instância (o backfill acima), então as
-- duas chaves são equivalentes — e `PARTITION BY instancia_id` juntaria numa só
-- partição todas as linhas com instância nula, comparando processos diferentes
-- entre si.
--
-- QUAL LINHA SOBREVIVE, em ordem de prioridade:
--   1. a que tem `compromisso_id` — apagá-la desfaria o vínculo com a atividade
--      já criada na Agenda, e a atividade viraria órfã de origem;
--   2. a que tem `dispensado_em` — carrega a decisão de um humano ("não é
--      audiência"), que o radar respeita; perdê-la faria o alerta voltar;
--   3. a mais antiga, por desempate estável (`created_at`, depois `id`).
--
-- `x IS NULL` ordena false (0) antes de true (1), então a linha COM o campo
-- preenchido fica em primeiro.
DELETE FROM "movimentacoes_processuais"
 WHERE "id" IN (
   SELECT "id" FROM (
     SELECT "id",
            row_number() OVER (
              PARTITION BY "processo_id", "data_movimento", "codigo_movimento", "descricao"
              ORDER BY ("compromisso_id" IS NULL),
                       ("dispensado_em" IS NULL),
                       "created_at",
                       "id"
            ) AS rn
       FROM "movimentacoes_processuais"
      WHERE "codigo_movimento" IS NOT NULL
   ) ranked
   WHERE ranked.rn > 1
 );

CREATE UNIQUE INDEX "movimentacoes_processuais_dedup_key"
  ON "movimentacoes_processuais"("instancia_id", "data_movimento", "codigo_movimento", "descricao")
  WHERE "instancia_id" IS NOT NULL AND "codigo_movimento" IS NOT NULL;
