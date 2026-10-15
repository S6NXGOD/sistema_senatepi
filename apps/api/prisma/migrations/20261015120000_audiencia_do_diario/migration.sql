-- A AUDIÊNCIA VEM DO DIÁRIO — o carimbo do robô de pauta. 15/10/2026.
--
-- "Preciso implementar a automação de agendamento de audiências. Já temos a
-- integração ativa com o DJEN e as APIs do CNJ." — o dono.
--
-- A máquina de pauta existia inteira (classificador, radar, criador de
-- compromisso, aviso ao filiado, tarefa de preparo) e NUNCA produziu uma
-- audiência. Medido na produção antes desta migração:
--
--   movimentações do DataJud marcadas como audiência ...... 265
--   dessas, com DATA em qualquer campo ...................... 0
--   compromissos de audiência criados pelo robô ............. 0
--   compromissos de audiência na agenda (todos à mão) ....... 3
--
-- Ela estava faminta, não quebrada: o DataJud manda o rótulo ("Inicial", "de
-- Instrução") e o complemento, nunca o dia. Quem manda o dia é o DIÁRIO.
-- Rodando o leitor novo sobre as 2.487 publicações reais: 98 designam
-- audiência, 77 distintas, 83 com link de sala virtual.
--
-- COLUNAS PRÓPRIAS DO ROBÔ, e não as de gente. `tarefa_dispensada_em` é a
-- dispensa de uma PESSOA e cala o aviso na tela; o carimbo do robô é
-- justamente o que torna o aviso possível. Misturar os dois já apagou trabalho
-- nosso antes — por isso três colunas novas em vez de reaproveitar.
--
-- ADITIVA E IDEMPOTENTE. Três colunas NULÁVEIS e um índice; nada é renomeado
-- nem removido, e o contêiner antigo — que não conhece nenhuma delas —
-- continua inserindo e lendo normalmente durante a janela de troca.
ALTER TABLE "comunicacoes_djen"
  ADD COLUMN IF NOT EXISTS "audiencia_avaliada_em" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "audiencia_avaliada_motivo" TEXT,
  ADD COLUMN IF NOT EXISTS "audiencia_em" TIMESTAMP(3);

-- A FILA DO ROBÔ: "sem compromisso E sem carimbo". Sem o índice, cada rodada
-- varre as 2.487 linhas (e crescendo) para achar as poucas ainda não olhadas.
CREATE INDEX IF NOT EXISTS "comunicacoes_djen_audiencia_avaliada_em_compromisso_id_idx"
  ON "comunicacoes_djen" ("audiencia_avaliada_em", "compromisso_id");
