-- Marca QUAL API produziu cada linha do log de sincronização.
--
-- POR QUE UMA COLUNA NOVA E NÃO UM VALOR A MAIS EM `origem`
-- `origem` (IMPORTACAO | MANUAL | CRON) responde "quem disparou". A pergunta
-- nova é outra: "com quem falamos" — DataJud ou DJEN. Empilhar as duas num
-- enum só produziria combinações sem sentido (não existe "DJEN" disparado por
-- IMPORTACAO no mesmo eixo) e obrigaria uma migração de enum a cada integração
-- futura. Como TEXT com default, a coluna nasce preenchida em todo o histórico
-- e a próxima fonte não custa migração nenhuma.
--
-- O DEFAULT NÃO É COSMÉTICO: `apps/api/package.json` roda `prisma migrate
-- deploy` dentro do `start`, então esta migração aplica ANTES da versão nova
-- da aplicação subir. Durante esses segundos, o código ANTIGO grava linhas sem
-- informar `fonte` — e elas precisam nascer como 'DATAJUD', que é o que de fato
-- eram.

ALTER TABLE "logs_sincronizacao_datajud"
  ADD COLUMN IF NOT EXISTS "fonte" TEXT NOT NULL DEFAULT 'DATAJUD';

-- Sustenta as consultas do painel de saúde do robô, que a partir de agora
-- sempre filtram por fonte (senão o DJEN entraria na conta do DataJud e o
-- número de falhas do CNJ passaria a mentir).
CREATE INDEX IF NOT EXISTS "logs_sincronizacao_datajud_fonte_created_at_idx"
  ON "logs_sincronizacao_datajud"("fonte", "created_at");


-- ---------------------------------------------------------------------------
-- Trava de execução única dos jobs agendados.
--
-- O QUE ELA CORRIGE
-- Cada cron se protegia com `private rodando = false`, um booleano da INSTÂNCIA.
-- Com mais de uma réplica da API, cada uma tem o seu, ambos valem `false` às
-- 02:00, e as duas varrem o acervo inteiro em paralelo: o dobro de chamadas ao
-- CNJ (contra o rate limit que a cadência de 2–3s existe para respeitar) e
-- movimentação duplicada, porque o dedup daquele caminho é feito em memória.
--
-- POR QUE NÃO `pg_try_advisory_lock`
-- A trava consultiva pertence à CONEXÃO que a tomou, e o Prisma usa pool: o
-- unlock pode cair noutra conexão, devolver `false` em silêncio e deixar o
-- cadeado preso para sempre — o job nunca mais rodaria. Prender tudo numa
-- transação resolveria a conexão, mas manteria uma transação aberta durante uma
-- varredura de dezenas de minutos.
--
-- POR QUE UMA LINHA COM PRAZO
-- `expira_em` é o que torna a trava à prova de queda: se o processo morrer no
-- meio do job, ninguém apaga a linha, mas ela caduca sozinha. Sem prazo, um
-- crash exigiria alguém entrar no banco para destravar o robô.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "travas_job" (
  -- Nome do job. É a PK: é ela que garante uma trava por job.
  "nome"      TEXT NOT NULL,
  -- Instância que detém a trava. Vai no WHERE do DELETE para que uma réplica
  -- jamais libere a trava tomada por outra.
  "dono_id"   TEXT NOT NULL,
  "expira_em" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "travas_job_pkey" PRIMARY KEY ("nome")
);
