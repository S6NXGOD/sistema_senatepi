-- Datas de CALENDÁRIO na convenção única: meia-noite de Brasília (03:00Z).
--
-- Contexto: a importação inicial gravou 03:00Z (meia-noite local) enquanto os
-- formulários do sistema gravavam 00:00Z (meia-noite UTC). Como as telas usam
-- toLocaleDateString('pt-BR'), os registros em 00:00Z apareciam UM DIA ANTES —
-- o que fazia o desafio do recadastramento por link recusar a data correta.
--
-- NÃO-DESTRUTIVA: só desloca o horário dentro do mesmo dia de calendário.
-- O dia é preservado por date_trunc antes de somar as 3 horas, e a condição
-- garante idempotência (rodar de novo não muda nada).

DO $$
DECLARE
  alvo   RECORD;
  mudou  INTEGER;
BEGIN
  FOR alvo IN
    SELECT table_name AS tabela, column_name AS coluna
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND column_name IN ('data_nascimento', 'data_admissao', 'data_desligamento')
  LOOP
    EXECUTE format(
      'UPDATE %I SET %I = date_trunc(''day'', %I) + interval ''3 hours''
        WHERE %I IS NOT NULL
          AND %I <> date_trunc(''day'', %I) + interval ''3 hours''',
      alvo.tabela, alvo.coluna, alvo.coluna, alvo.coluna, alvo.coluna, alvo.coluna
    );
    GET DIAGNOSTICS mudou = ROW_COUNT;
    IF mudou > 0 THEN
      RAISE NOTICE 'datas normalizadas: %.% (% registros)', alvo.tabela, alvo.coluna, mudou;
    END IF;
  END LOOP;
END $$;
