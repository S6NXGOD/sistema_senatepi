-- NÃO ENCHER A FILA COM PROCESSO QUE JÁ ACABOU.
--
-- A primeira colheita trouxe 32 ações do sindicato sem cadastro, e boa parte
-- delas era de processo encerrado — o que faz sentido: o ATO DE ENCERRAMENTO é
-- justamente a última coisa que um processo morto publica no Diário, e é por
-- ele que a varredura o encontra.
--
-- Fila cheia de trabalho que não existe é o jeito mais rápido de a equipe parar
-- de olhar a fila. Agora, ao encontrar uma ação nova, o sistema confere no
-- DataJud se ela ainda corre (`instanciaBaixada`, a mesma regra de códigos TPU
-- que o resto do módulo usa) e marca ENCERRADO quando todas as instâncias já
-- foram baixadas.
--
-- O critério do usuário é ESTADO, não idade: "não me importo se é de 2014,
-- contanto que ainda esteja rolando".
--
-- ADITIVA POR CONSTRUÇÃO. Um valor novo no enum e uma coluna nova, anulável. O
-- contêiner ANTIGO só consulta `status = 'PENDENTE'`, então nunca lê uma linha
-- ENCERRADO e não tem como falhar ao interpretar o enum que ele desconhece.
ALTER TYPE "StatusSugestaoProcesso" ADD VALUE IF NOT EXISTS 'ENCERRADO';

-- Nulo = não deu para conferir (o CNJ não conhece o número, ou a consulta
-- falhou). Aí a ação FICA na fila: esconder processo vivo custa prazo; mostrar
-- um morto custa um clique.
ALTER TABLE "sugestoes_processo"
  ADD COLUMN IF NOT EXISTS "verificado_no_cnj_em" TIMESTAMP(3);
