-- Dois tipos de atividade novos, ambos "sistema" (renomeáveis, não excluíveis).
--
-- CONTATO
--   A tarefa que o robô cria para a secretaria avisar o filiado da audiência
--   nascia como COMPROMISSO (o tipo genérico). Ao concluir, as opções eram
--   "Concluída / Vinculado a processo / Virou processo novo" — nenhuma responde
--   a única pergunta que importa: O FILIADO FOI AVISADO? Filiado não avisado é
--   ausência na audiência, e isso ficava invisível.
--
-- ACOMPANHAMENTO
--   Destino dos desfechos que declaram uma pendência e não tinham onde guardá-la:
--   reunião "com encaminhamentos", perícia "laudo pendente", acordo a cumprir.
--   Antes o texto morria em `desfecho_obs` — sem dono, sem data, sem lista.

INSERT INTO "tipos_evento" ("id", "slug", "nome", "cor", "ordem", "sistema", "updated_at") VALUES
    ('f1a7e000-0000-4000-8000-000000000009', 'CONTATO',        'Contato',        'cyan',   9,  true, CURRENT_TIMESTAMP),
    ('f1a7e000-0000-4000-8000-00000000000a', 'ACOMPANHAMENTO', 'Acompanhamento', 'indigo', 10, true, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

-- Reclassifica as tarefas de aviso JÁ criadas pelo robô. São reconhecíveis sem
-- ambiguidade: só elas juntam origem automática, tipo genérico e este título.
-- Só as que ainda estão abertas — reescrever o tipo de uma atividade concluída
-- invalidaria o desfecho já registrado nela.
UPDATE "compromissos"
   SET "tipo" = 'CONTATO'
 WHERE "origem_automatica" = true
   AND "tipo" = 'COMPROMISSO'
   AND "titulo" LIKE '%Avisar filiado%'
   AND "status" IN ('PENDENTE', 'EM_ANDAMENTO');
