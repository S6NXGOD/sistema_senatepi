-- EQUIPE NA AGENDA, URGÊNCIA COM MOTIVO E A FASE PRÉ-PROCESSUAL.
--
-- Quatro assuntos numa migration só porque eles se cruzam: a atividade que
-- passa a ter equipe é a mesma que gera o caso pré-processual, e a urgência
-- atravessa triagem, agenda e processo. Separá-los deixaria o banco num estado
-- em que metade da regra vale.
--
-- TUDO ADITIVO, com uma exceção controlada: o RENAME do valor de enum
-- RASCUNHO -> PRE_PROCESSUAL. Ver a seção 4.

-- ---------------------------------------------------------------------------
-- 1) EQUIPE DA ATIVIDADE (N:N)
--
-- `compromissos.responsavel_id` CONTINUA existindo e continua NOT NULL: ele
-- vira ATALHO da linha `principal`, exatamente como `processos.advogado_id`.
-- Não há reescrita do código de leitura — é o que torna esta mudança segura
-- num módulo com 52 pontos que leem o responsável.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "compromisso_responsaveis" (
  "compromisso_id" TEXT NOT NULL,
  "usuario_id"     TEXT NOT NULL,
  "principal"      BOOLEAN NOT NULL DEFAULT false,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "compromisso_responsaveis_pkey" PRIMARY KEY ("compromisso_id", "usuario_id")
);

DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compromisso_responsaveis_compromisso_id_fkey') THEN
    ALTER TABLE "compromisso_responsaveis"
      ADD CONSTRAINT "compromisso_responsaveis_compromisso_id_fkey"
      FOREIGN KEY ("compromisso_id") REFERENCES "compromissos"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compromisso_responsaveis_usuario_id_fkey') THEN
    ALTER TABLE "compromisso_responsaveis"
      ADD CONSTRAINT "compromisso_responsaveis_usuario_id_fkey"
      FOREIGN KEY ("usuario_id") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $mig$;

CREATE INDEX IF NOT EXISTS "compromisso_responsaveis_usuario_id_idx"
  ON "compromisso_responsaveis"("usuario_id");

-- NO MÁXIMO UM RESPONSÁVEL POR ATIVIDADE — a regra fica no banco.
--
-- Sem isto, `principal` seria só uma coluna que o código promete manter, e o
-- primeiro caminho que esquecer de desmarcar o anterior cria uma atividade com
-- dois donos. Duas pessoas responsáveis é o mesmo que nenhuma: a cobrança não
-- tem destinatário. Índice único PARCIAL porque participantes (principal =
-- false) são vários por definição — o Prisma não sabe declarar índice parcial.
CREATE UNIQUE INDEX IF NOT EXISTS "compromisso_um_principal"
  ON "compromisso_responsaveis"("compromisso_id")
  WHERE "principal";

-- Retroalimenta a equipe com quem já é responsável hoje. Sem este passo, toda
-- atividade existente ficaria com a tabela nova vazia e a primeira
-- sincronização apagaria o atalho.
INSERT INTO "compromisso_responsaveis" ("compromisso_id", "usuario_id", "principal", "created_at")
SELECT c."id", c."responsavel_id", true, c."created_at"
FROM "compromissos" c
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2) URGÊNCIA COM MOTIVO, DATA E AUTOR — nos três lugares
--
-- O booleano sozinho não se revisa: ninguém sabe por que aquilo é urgente nem
-- desde quando, então nada é desmarcado e em poucos meses metade do acervo é
-- "urgente". Com motivo e data, a fila passa a ter como ser auditada.
-- ---------------------------------------------------------------------------

ALTER TABLE "compromissos" ADD COLUMN IF NOT EXISTS "urgente_motivo" TEXT;
ALTER TABLE "compromissos" ADD COLUMN IF NOT EXISTS "urgente_em" TIMESTAMP(3);
ALTER TABLE "compromissos" ADD COLUMN IF NOT EXISTS "urgente_por" TEXT;

ALTER TABLE "atendimentos" ADD COLUMN IF NOT EXISTS "urgente" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "atendimentos" ADD COLUMN IF NOT EXISTS "urgente_motivo" TEXT;
ALTER TABLE "atendimentos" ADD COLUMN IF NOT EXISTS "urgente_em" TIMESTAMP(3);
ALTER TABLE "atendimentos" ADD COLUMN IF NOT EXISTS "urgente_por" TEXT;
CREATE INDEX IF NOT EXISTS "atendimentos_urgente_idx" ON "atendimentos"("urgente");

ALTER TABLE "processos" ADD COLUMN IF NOT EXISTS "urgente" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "processos" ADD COLUMN IF NOT EXISTS "urgente_motivo" TEXT;
ALTER TABLE "processos" ADD COLUMN IF NOT EXISTS "urgente_em" TIMESTAMP(3);
ALTER TABLE "processos" ADD COLUMN IF NOT EXISTS "urgente_por" TEXT;
CREATE INDEX IF NOT EXISTS "processos_urgente_idx" ON "processos"("urgente");

-- A ETIQUETA VIRA COLUNA.
--
-- Reaproveita `senatepi_normalizar_busca` (IMMUTABLE, tira acento e pontuação)
-- em vez da extensão `unaccent` — mesma decisão, e pelo mesmo motivo, da
-- migration `20260802210000_busca_normalizada`.
--
-- As grafias abaixo não são hipótese: é justamente por o texto livre
-- produzi-las que "Urgente" deixou de ser etiqueta.
UPDATE "processos"
SET "urgente" = true,
    "urgente_motivo" = 'Migrado da etiqueta "Urgente" - motivo nao registrado a epoca.',
    "urgente_em" = COALESCE("updated_at", "created_at")
WHERE "urgente" = false
  AND EXISTS (
    SELECT 1 FROM unnest("etiquetas") AS e
    WHERE senatepi_normalizar_busca(e) IN ('urgente', 'urgentissimo', 'urgentissima', 'muito urgente')
  );

-- E some da lista de etiquetas, para o dado não ficar em dois lugares divergindo.
UPDATE "processos"
SET "etiquetas" = ARRAY(
      SELECT e FROM unnest("etiquetas") AS e
      WHERE senatepi_normalizar_busca(e) NOT IN ('urgente', 'urgentissimo', 'urgentissima', 'muito urgente')
    )
WHERE EXISTS (
  SELECT 1 FROM unnest("etiquetas") AS e
  WHERE senatepi_normalizar_busca(e) IN ('urgente', 'urgentissimo', 'urgentissima', 'muito urgente')
);

-- ---------------------------------------------------------------------------
-- 3) SOLICITANTE E CATEGORIA
-- ---------------------------------------------------------------------------

ALTER TABLE "processos" ADD COLUMN IF NOT EXISTS "solicitado_por_id" TEXT;
ALTER TABLE "processos" ADD COLUMN IF NOT EXISTS "categoria" TEXT;

DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'processos_solicitado_por_id_fkey') THEN
    ALTER TABLE "processos"
      ADD CONSTRAINT "processos_solicitado_por_id_fkey"
      FOREIGN KEY ("solicitado_por_id") REFERENCES "filiados"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $mig$;

CREATE INDEX IF NOT EXISTS "processos_solicitado_por_id_idx"
  ON "processos"("solicitado_por_id");

-- Quem já nasceu de uma atividade da agenda tem solicitante conhecido: é o
-- filiado daquela atividade. Preenche o retroativo — sem isto o campo só
-- valeria para o que vier depois, e a tela mostraria "—" no histórico inteiro.
UPDATE "processos" p
SET "solicitado_por_id" = c."filiado_id"
FROM "compromissos" c
WHERE p."origem_compromisso_id" = c."id"
  AND p."solicitado_por_id" IS NULL
  AND c."filiado_id" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4) PRE_PROCESSUAL entra no enum — SEM renomear, SEM mexer nas linhas
--
-- A versão anterior desta migração fazia `RENAME VALUE 'RASCUNHO' TO
-- 'PRE_PROCESSUAL'`. Parecia a opção segura: o rótulo troca no lugar, nenhuma
-- linha se move, não há instante em que um processo fique sem status. Tudo isso
-- é verdade — e ainda assim quebra a produção, por um motivo que não está no
-- banco e sim no DEPLOY.
--
-- O `migrate deploy` roda no contêiner NOVO, antes de ele subir. Enquanto ele
-- sobe e passa no health check, quem atende requisição é o contêiner ANTIGO —
-- agora falando com um banco já migrado. Medido, com o cliente Prisma gerado a
-- partir do schema que está em produção, contra este banco já renomeado:
--
--   processo.findMany()                      -> Value 'PRE_PROCESSUAL' not found in enum
--   processo.groupBy(['statusInterno'])      -> idem
--   notIn ['ARQUIVADO','IMPROCEDENTE','RASCUNHO'] -> Postgres 22P02
--
-- O último é o que decide a questão: ele quebra MESMO COM ZERO LINHAS
-- rerrotuladas, porque o literal 'RASCUNHO' deixa de existir e a consulta que o
-- menciona fica inválida. E essa consulta está no caminho da listagem de
-- processos. Ou seja: o rename derrubaria o módulo inteiro durante a troca.
--
-- Então a migração é ADITIVA e só isso:
--   * acrescenta o rótulo novo;
--   * NÃO renomeia;
--   * NÃO toca em nenhuma linha.
--
-- Resultado: o contêiner antigo continua com seus literais válidos e suas
-- linhas legíveis até sair do ar. O código novo grava sempre 'PRE_PROCESSUAL' e
-- lê os dois como a mesma fase (`PRE_PROCESSUAIS`, em `processos.service.ts`).
-- Rerrotular o histórico é cosmético; se algum dia valer a pena, é um UPDATE de
-- uma linha em OUTRO deploy — nunca no mesmo que introduz o rótulo.
--
-- NÃO CONFUNDIR COM `StatusPauta.RASCUNHO`, que é OUTRO enum (pauta de votação
-- de assembleia) e não é tocado aqui — conferido antes de escrever isto.
--
-- `ADD VALUE` pode rodar dentro de transação no PG 12+ desde que o valor novo
-- não seja USADO na mesma transação. Não é: não há UPDATE usando-o abaixo.
-- ---------------------------------------------------------------------------

ALTER TYPE "StatusProcesso" ADD VALUE IF NOT EXISTS 'PRE_PROCESSUAL';

-- O CHECK `processos_npu_obrigatorio_check` também precisa aceitar o rótulo
-- novo, senão nenhum caso pré-processual consegue ser gravado. Isso vai na
-- migração SEGUINTE (20260814210500): usar o valor recém-adicionado na mesma
-- transação que o adicionou é proibido pelo Postgres.

-- ---------------------------------------------------------------------------
-- 5) O GATILHO QUE IMPEDE ATIVIDADE SEM EQUIPE
--
-- POR QUE UM GATILHO, E NÃO "lembrar de chamar o helper".
-- Existem OITO lugares que criam atividade: a tela, o seguimento do desfecho, o
-- encaminhamento da triagem, quatro caminhos do robô de prazos e o de
-- correlação. Cada um teria de lembrar de gravar a equipe, e o nono — que
-- alguém escreve daqui a três meses — não vai lembrar. O sintoma seria mudo: a
-- atividade existe, aparece para o responsável pelo atalho, e some da agenda de
-- todo mundo quando a equipe passar a ser a fonte de leitura.
--
-- O banco resolve isso de uma vez, para todo caminho presente e futuro,
-- inclusive SQL na unha. Mesma escolha de `trg_filiados_busca`.
--
-- SÓ NO INSERT, de propósito: a atualização passa por `sincronizarEquipe`, que
-- reescreve as duas pontas na mesma transação. Um gatilho de UPDATE brigaria
-- com ele — os dois tentariam mandar no mesmo par de linhas.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION senatepi_equipe_do_compromisso()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $trg$
BEGIN
  INSERT INTO "compromisso_responsaveis" ("compromisso_id", "usuario_id", "principal", "created_at")
  VALUES (NEW."id", NEW."responsavel_id", true, NEW."created_at")
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$trg$;

DROP TRIGGER IF EXISTS "trg_compromisso_equipe" ON "compromissos";
CREATE TRIGGER "trg_compromisso_equipe"
  AFTER INSERT ON "compromissos"
  FOR EACH ROW
  EXECUTE FUNCTION senatepi_equipe_do_compromisso();
