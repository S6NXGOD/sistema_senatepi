-- POR QUE O ROBÔ NÃO CRIOU A TAREFA.
--
-- ADITIVA e nulável: na janela de troca o contêiner ANTIGO segue gravando
-- `tarefa_dispensada_em` sem esta coluna, e a linha continua válida. Nenhum
-- índice novo — a coluna é lida junto com a linha, nunca filtrada sozinha.
ALTER TABLE "comunicacoes_djen" ADD COLUMN IF NOT EXISTS "tarefa_dispensada_motivo" TEXT;

-- As 1.396 linhas já dispensadas são, todas, notícia velha: a única regra de
-- dispensa que existia até agora. Carimbar é o que faz a tela poder explicar em
-- vez de calar.
UPDATE "comunicacoes_djen"
   SET "tarefa_dispensada_motivo" = 'NOTICIA_VELHA'
 WHERE "tarefa_dispensada_em" IS NOT NULL
   AND "tarefa_dispensada_motivo" IS NULL;
