-- OS ADVOGADOS QUE O DIÁRIO NOMEIA VIRAM VÍNCULO — e o que é do robô se distingue do que é de gente.
--
-- 1) `processos_advogados.origem`: quem pôs esse advogado na equipe. Nulo = as
--    linhas que já existiam, todas feitas à mão ou pela importação; o código lê
--    nulo como MANUAL. Não é enfeite: é o que a tela usa para dizer "veio do
--    Diário" e o que separa a sugestão do robô da decisão de uma pessoa.
--
-- 2) `processos_advogados_dispensados`: a LÁPIDE. Sem ela, tirar um advogado da
--    equipe à mão duraria até a varredura da madrugada, que o encontraria
--    citado no ato e o recolocaria — o robô desfazendo a decisão de gente todo
--    dia, em silêncio. Mesma lição da ligação MANUAL em Contas Públicas.
--
-- 3) `compromisso_responsaveis.origem`: participante posto pelo ROBÔ não é o
--    mesmo que participante escolhido por alguém. O sino conta o primeiro como
--    "seu" e tocaria para a equipe inteira a cada prazo — quatro advogados
--    recebendo o mesmo alarme é o caminho conhecido para ninguém olhar o sino.
--
-- Tudo aditivo e idempotente: na janela de troca o contêiner antigo continua
-- gravando sem citar estas colunas.

ALTER TABLE "processos_advogados" ADD COLUMN IF NOT EXISTS "origem" TEXT;

ALTER TABLE "compromisso_responsaveis" ADD COLUMN IF NOT EXISTS "origem" TEXT;

CREATE TABLE IF NOT EXISTS "processos_advogados_dispensados" (
  "processo_id"   TEXT NOT NULL,
  "advogado_id"   TEXT NOT NULL,
  "dispensado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dispensado_por" TEXT,
  CONSTRAINT "processos_advogados_dispensados_pkey" PRIMARY KEY ("processo_id", "advogado_id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'processos_advogados_dispensados_processo_id_fkey') THEN
    ALTER TABLE "processos_advogados_dispensados"
      ADD CONSTRAINT "processos_advogados_dispensados_processo_id_fkey"
      FOREIGN KEY ("processo_id") REFERENCES "processos"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'processos_advogados_dispensados_advogado_id_fkey') THEN
    ALTER TABLE "processos_advogados_dispensados"
      ADD CONSTRAINT "processos_advogados_dispensados_advogado_id_fkey"
      FOREIGN KEY ("advogado_id") REFERENCES "users"("id") ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "processos_advogados_dispensados_advogado_id_idx"
  ON "processos_advogados_dispensados"("advogado_id");

-- ---------------------------------------------------------------------------
-- "TAMBÉM ATUAM": a equipe do caso entra como RESERVA na tarefa do robô.
--
-- O gatilho que monta a equipe da atividade já existia e diz, no comentário
-- original, por que ele existe: são oito lugares que criam atividade, e o nono
-- não vai lembrar de chamar o ajudante. Vale igual para a reserva — por isso
-- ela entra AQUI, e não em cada robô.
--
-- SÓ EM TAREFA DE ROBÔ (`origem_automatica`) E SÓ COM PROCESSO: numa tarefa
-- criada por gente, quem participa é quem a pessoa escolheu.
-- SÓ ADVOGADO ATIVO: quem saiu do sindicato não é reserva de ninguém.
-- NUNCA O PRÓPRIO RESPONSÁVEL: ele já entrou como principal, na linha acima.
--
-- A marca 'AUTOMATICA' é o que impede o sino de tocar quatro vezes pelo mesmo
-- prazo: o contador conta o que é seu; a reserva aparece no cartão e na ficha.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION senatepi_equipe_do_compromisso()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $trg$
BEGIN
  INSERT INTO "compromisso_responsaveis" ("compromisso_id", "usuario_id", "principal", "created_at")
  VALUES (NEW."id", NEW."responsavel_id", true, NEW."created_at")
  ON CONFLICT DO NOTHING;

  IF NEW."origem_automatica" AND NEW."processo_id" IS NOT NULL THEN
    INSERT INTO "compromisso_responsaveis" ("compromisso_id", "usuario_id", "principal", "created_at", "origem")
    SELECT NEW."id", pa."advogado_id", false, NEW."created_at", 'AUTOMATICA'
      FROM "processos_advogados" pa
      JOIN "users" u ON u."id" = pa."advogado_id"
     WHERE pa."processo_id" = NEW."processo_id"
       AND pa."advogado_id" <> NEW."responsavel_id"
       AND u."ativo"
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$trg$;
