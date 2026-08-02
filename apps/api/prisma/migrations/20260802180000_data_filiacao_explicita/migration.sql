-- Data de filiação com significado próprio.
--
-- O PROBLEMA
-- `created_at` acumulava dois papéis: a importação legada gravava nele a data
-- de filiação vinda da planilha (`createdAt: dataFiliacao`, importacao.service),
-- e o cadastro pelo sistema gravava a data do registro. Funcionava enquanto a
-- planilha trazia a data — mas 1.903 linhas vieram SEM ela e caíram no dia da
-- carga (24/06/2026). Resultado: o gráfico de crescimento exibia um pico de
-- 1.903 filiações num único mês, que nunca aconteceu.
--
-- A CORREÇÃO
-- Campo próprio, e NULO onde a data é desconhecida. Nulo é a resposta honesta:
-- inventar uma data (distribuir no tempo, usar a admissão, chutar o meio do
-- ano) produziria um gráfico bonito e falso. Registros sem data ficam fora da
-- série temporal, e a tela informa quantos são.
--
-- Nada é apagado: `created_at` continua intacto como carimbo de auditoria.

ALTER TABLE "filiados" ADD COLUMN IF NOT EXISTS "data_filiacao" TIMESTAMP(3);

-- ---------------------------------------------------------------------------
-- Backfill
--
-- Regra: `created_at` É a data de filiação, EXCETO nos registros da carga.
--
-- COMO A CARGA É IDENTIFICADA (dois sinais combinados, ambos verificados na
-- base real antes de escrever isto):
--
--   1. HORA REAL. Quem veio da planilha COM data de filiação tem `created_at`
--      exatamente à meia-noite (00:00:00) — é data de calendário, sem hora.
--      Quem caiu no `now()` do importador tem hora cheia (11:55:10). Só o
--      segundo grupo é suspeito.
--
--   2. RAJADA. Dentro do grupo suspeito, a carga aparece como centenas de
--      registros no MESMO MINUTO (1.903 em três minutos, na base de produção).
--      Um cadastro de balcão jamais faz isso — e é esse teste que separa a
--      importação dos filiados cadastrados pelo sistema no dia a dia.
--
-- POR QUE NÃO "MAIS DE 100 NO MESMO DIA"
-- Era a primeira versão desta migração, e estava ERRADA. Em produção há dois
-- dias de 2021 com 155 e 104 filiações — campanhas reais, com data verdadeira
-- vinda da planilha. O critério por dia apagaria a data de 259 pessoas.
-- ---------------------------------------------------------------------------
WITH carga AS (
  SELECT date_trunc('minute', "created_at") AS minuto
    FROM "filiados"
   WHERE "created_at"::time <> '00:00:00'
   GROUP BY 1
  HAVING count(*) > 50
)
UPDATE "filiados" f
   SET "data_filiacao" = f."created_at"
 WHERE NOT (
   f."created_at"::time <> '00:00:00'
   AND date_trunc('minute', f."created_at") IN (SELECT minuto FROM carga)
 );

-- Os de carga em massa ficam com data_filiacao NULA (desconhecida) — é o que
-- tira o pico falso do gráfico sem apagar ninguém do cadastro.

-- ---------------------------------------------------------------------------
-- Saneamento: datas impossíveis viram NULO
--
-- A base trouxe pelo menos uma filiação em 2323 (dígito trocado na planilha).
-- Uma data futura arrasta o eixo do gráfico e envenena qualquer média de tempo
-- de casa. Os validadores novos (common/validators/data.validators.ts) já
-- barram isso na entrada; aqui limpamos o que passou antes deles existirem.
-- `created_at` NÃO é tocado: é carimbo de auditoria, não dado de negócio.
-- ---------------------------------------------------------------------------
UPDATE "filiados"
   SET "data_filiacao" = NULL
 WHERE "data_filiacao" IS NOT NULL
   AND ("data_filiacao" > now() OR "data_filiacao" < DATE '1950-01-01');

CREATE INDEX IF NOT EXISTS "filiados_data_filiacao_idx" ON "filiados"("data_filiacao");
