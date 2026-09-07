-- O ROBÔ PASSA A REGISTRAR QUE DISPENSOU A TAREFA, EM VEZ DE O ALARME ADIVINHAR.
--
-- Medido em 07/09/2026 na produção: das 1.243 publicações classificadas sem
-- tarefa, 1.243 — a população inteira — são "notícia velha" pela régua do
-- próprio robô (`ehNoticiaVelha`): o ato é anterior ao momento em que passamos
-- a olhar aquele processo, então uma tarefa criada hoje seria eco.
--
-- O sino e a faixa liam só `compromisso_id IS NULL` e chamavam TODAS de
-- pendência. Resultado no ar: nove advogados com a barra vermelha em cima de
-- toda tela, todo dia, com números como "1003 publicações suas sem tarefa
-- aberta" — 100% falso positivo, e nenhuma dessas era dos últimos 7 dias.
--
-- Derivar a regra na consulta do sino seria caro (um min(created_at) por
-- processo, a cada 60 s, por usuário) e frágil: a régua mudaria em dois lugares.
-- Guardar a DECISÃO é mais barato e mais honesto — e sobra para a tela de
-- Publicações poder dizer "o robô dispensou esta, e por quê".
ALTER TABLE "comunicacoes_djen" ADD COLUMN "tarefa_dispensada_em" TIMESTAMP(3);

-- Backfill pela MESMA regra do robô, não por "tudo que está sem tarefa": se um
-- dia houver uma falha real de automação no histórico, ela continua acesa.
UPDATE "comunicacoes_djen" d
   SET "tarefa_dispensada_em" = d."created_at"
  FROM (
    SELECT "processo_id", min("created_at") AS vigiado_desde
      FROM "comunicacoes_djen"
     WHERE "processo_id" IS NOT NULL
     GROUP BY "processo_id"
  ) v
 WHERE v."processo_id" = d."processo_id"
   AND d."compromisso_id" IS NULL
   AND d."providencia" IS NOT NULL
   -- Dia contra dia: `data_disponibilizacao` é DATE e `vigiado_desde` é
   -- instante. A tolerância de 3 dias é a janela da varredura diária.
   AND d."data_disponibilizacao"::date
       < ((v.vigiado_desde - interval '3 hours') - interval '3 days')::date;

-- SEM ÍNDICE NOVO, de propósito. Um índice PARCIAL não cabe no schema.prisma e
-- viraria drift no próximo `prisma migrate dev`; e o ganho seria teórico — são
-- 1.420 linhas, e a consulta já entra pelo `@@index([processoId, ...])`.

-- A TAREFA DE CADASTRAR A AÇÃO NOVA.
--
-- A fila do Diário só existia no sino e na tela de Processos: nada entrava na
-- agenda de ninguém. Uma ação recente contra o sindicato ficava dependendo de
-- alguém olhar uma lista. Agora ela vira tarefa do advogado citado no ato, e
-- esta coluna é o que impede a segunda tarefa amanhã.
ALTER TABLE "sugestoes_processo" ADD COLUMN "compromisso_id" TEXT;

ALTER TABLE "sugestoes_processo"
  ADD CONSTRAINT "sugestoes_processo_compromisso_id_fkey"
  FOREIGN KEY ("compromisso_id") REFERENCES "compromissos"("id") ON DELETE SET NULL;

CREATE UNIQUE INDEX "sugestoes_processo_compromisso_id_key"
    ON "sugestoes_processo" ("compromisso_id");
