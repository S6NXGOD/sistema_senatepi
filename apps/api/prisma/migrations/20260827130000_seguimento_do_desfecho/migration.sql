-- DE QUAL ATIVIDADE ESTA NASCEU.
--
-- O CASO REAL, visto na produção em 27/08/2026. O Dr. Murilo tinha DOIS
-- "Encaminhamento da reunião" idênticos, ambos das 12:00 às 13:00 do dia 03/09,
-- criados com dezesseis minutos de diferença e com textos que descreviam o
-- mesmo evento de duas formas ("Reunião encerrada com o recebimento de
-- contraproposta…" e "Reunião finalizada com a apresentação de contraproposta
-- da FMS…").
--
-- O que aconteceu: alguém concluiu a reunião, reabriu para corrigir o texto do
-- desfecho e concluiu de novo. Cada conclusão criava um seguimento — e o
-- primeiro ficava. A agenda do advogado passava a ter duas tarefas para a mesma
-- coisa, uma delas condenada a ser cancelada à mão por alguém que primeiro
-- precisaria descobrir que era duplicata.
--
-- POR QUE UMA COLUNA, E NÃO UMA BUSCA POR SEMELHANÇA
-- Sem o vínculo, a única forma de reconhecer o seguimento anterior seria casar
-- título + tipo + responsável + dia — que erra nos dois sentidos: perde o
-- seguimento cujo título mudou junto com o desfecho, e agarra uma tarefa
-- legítima que por acaso se pareça. A ligação explícita não erra.
--
-- ELA TAMBÉM SERVE À LEITURA: com o vínculo gravado, a ficha da atividade pode
-- mostrar "esta nasceu de tal reunião", que hoje só existe no texto da
-- descrição e não é navegável.
--
-- `onDelete: SetNull` de propósito: apagar a reunião de origem não pode levar
-- junto a providência que ela gerou — a tarefa continua sendo devida.
--
-- SEGURANÇA NA JANELA DE TROCA: puramente aditivo. Coluna nula, sem NOT NULL e
-- sem default; o contêiner antigo não a conhece, o Prisma lista as colunas
-- explicitamente em todo SELECT, e os INSERTs dele seguem válidos.

ALTER TABLE "compromissos"
  ADD COLUMN IF NOT EXISTS "origem_desfecho_id" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'compromissos_origem_desfecho_id_fkey'
  ) THEN
    ALTER TABLE "compromissos"
      ADD CONSTRAINT "compromissos_origem_desfecho_id_fkey"
      FOREIGN KEY ("origem_desfecho_id") REFERENCES "compromissos"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- A consulta que importa é "há seguimento ABERTO desta origem?", feita a cada
-- conclusão. Sem índice, ela varre a tabela inteira toda vez.
CREATE INDEX IF NOT EXISTS "compromissos_origem_desfecho_id_idx"
  ON "compromissos" ("origem_desfecho_id");
