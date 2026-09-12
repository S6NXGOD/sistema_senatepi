-- A RESERVA ACOMPANHA A EQUIPE DO CASO — e não só a equipe do segundo em que a tarefa nasceu.
--
-- O gatilho de 11/09 (`senatepi_equipe_do_compromisso`) põe a equipe do
-- processo como reserva quando a tarefa do robô é INSERIDA. Ele olha a equipe
-- daquele instante — e ela muda logo depois:
--
--   · A varredura do Diário cria a tarefa ANTES de ligar ao processo os
--     advogados que o ato cita (`correlacionarPendentes` roda antes de
--     `ligarAdvogadosDoAto`, e não pode trocar de lugar: a ligação precisa da
--     publicação já correlacionada). Medido em 12/09/2026: a tarefa nasceu às
--     05:54:57 e a advogada citada entrou na equipe às 05:54:58 — 1,8 segundo
--     tarde demais para virar reserva.
--   · As tarefas abertas criadas antes de 11/09 nunca receberam ninguém.
--   · Quem entra ou sai da equipe pela ficha do processo não chegava às tarefas
--     que já existiam.
--
-- Em 12/09/2026 eram 6 tarefas abertas do robô com gente da equipe de fora —
-- quatro delas de um responsável que não acessava o sistema havia 39 dias, duas
-- já atrasadas, e ninguém mais do caso aparecia nelas.
--
-- O conserto mora onde a mudança acontece: entrou na equipe, vira reserva das
-- tarefas ABERTAS do robô naquele processo; saiu, deixa de ser. Só tarefa de
-- robô (a de gente tem a equipe que a pessoa escolheu), só advogado ativo, nunca
-- o responsável. Ao sair, apaga só a linha que o próprio robô pôs
-- ('AUTOMATICA' e não principal): participante escolhido por gente e quem
-- assumiu a tarefa ficam onde estão.
--
-- Aditivo e idempotente: na janela de troca o contêiner antigo continua gravando
-- `processos_advogados` como sempre, e o gatilho só acrescenta.

CREATE OR REPLACE FUNCTION senatepi_reserva_acompanha_a_equipe()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $trg$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "compromisso_responsaveis" ("compromisso_id", "usuario_id", "principal", "created_at", "origem")
    SELECT c."id", NEW."advogado_id", false, (now() AT TIME ZONE 'UTC'), 'AUTOMATICA'
      FROM "compromissos" c
      JOIN "users" u ON u."id" = NEW."advogado_id"
     WHERE c."processo_id" = NEW."processo_id"
       AND c."origem_automatica"
       AND c."status" IN ('PENDENTE', 'EM_ANDAMENTO')
       AND c."responsavel_id" <> NEW."advogado_id"
       AND u."ativo"
    ON CONFLICT DO NOTHING;
    RETURN NEW;
  END IF;

  DELETE FROM "compromisso_responsaveis" r
   USING "compromissos" c
   WHERE r."compromisso_id" = c."id"
     AND c."processo_id" = OLD."processo_id"
     AND c."status" IN ('PENDENTE', 'EM_ANDAMENTO')
     AND r."usuario_id" = OLD."advogado_id"
     AND r."origem" = 'AUTOMATICA'
     AND NOT r."principal";
  RETURN OLD;
END;
$trg$;

DROP TRIGGER IF EXISTS trg_reserva_acompanha_a_equipe ON "processos_advogados";

CREATE TRIGGER trg_reserva_acompanha_a_equipe
  AFTER INSERT OR DELETE ON "processos_advogados"
  FOR EACH ROW
  EXECUTE FUNCTION senatepi_reserva_acompanha_a_equipe();

-- A DÍVIDA DE ANTES DO GATILHO: toda tarefa ABERTA do robô recebe a equipe atual
-- do caso. `ON CONFLICT DO NOTHING` não mexe em quem já está lá — nem na reserva
-- que já existia, nem no participante que alguém escolheu, nem em quem assumiu.
INSERT INTO "compromisso_responsaveis" ("compromisso_id", "usuario_id", "principal", "created_at", "origem")
SELECT c."id", pa."advogado_id", false, (now() AT TIME ZONE 'UTC'), 'AUTOMATICA'
  FROM "compromissos" c
  JOIN "processos_advogados" pa ON pa."processo_id" = c."processo_id"
  JOIN "users" u ON u."id" = pa."advogado_id"
 WHERE c."origem_automatica"
   AND c."status" IN ('PENDENTE', 'EM_ANDAMENTO')
   AND pa."advogado_id" <> c."responsavel_id"
   AND u."ativo"
ON CONFLICT DO NOTHING;
