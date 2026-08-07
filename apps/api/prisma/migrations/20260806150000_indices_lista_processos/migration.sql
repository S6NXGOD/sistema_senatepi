-- ÍNDICES DA LISTA DE PROCESSOS.
--
-- A lista deixou de mostrar a CONTAGEM de movimentações e passou a mostrar a
-- ÚLTIMA — data e teor. São duas consultas novas na tela mais acessada do
-- módulo, e as duas caíam em varredura:
--
-- 1) "última movimentação de cada processo da página"
--      WHERE processo_id = $1 ORDER BY data_movimento DESC LIMIT 1
--    Com apenas "processos_id_idx", o banco lia TODOS os andamentos do processo
--    (há processos com mais de 200) e ordenava, 20 vezes por página. O índice
--    composto responde com uma única leitura no fim do índice.
--
-- 2) filtro "Fase processual = Execução"
--      EXISTS (... WHERE codigo_movimento IN (11384, 11385))
--    Sem índice em codigo_movimento, isso é sequential scan na maior tabela do
--    sistema a cada clique no chip.
--
-- Os dois índices são aditivos: nenhuma consulta existente muda de plano por
-- causa deles, no máximo melhora.

CREATE INDEX IF NOT EXISTS "movimentacoes_processuais_processo_id_data_movimento_idx"
  ON "movimentacoes_processuais"("processo_id", "data_movimento" DESC);

CREATE INDEX IF NOT EXISTS "movimentacoes_processuais_codigo_movimento_processo_id_idx"
  ON "movimentacoes_processuais"("codigo_movimento", "processo_id");
