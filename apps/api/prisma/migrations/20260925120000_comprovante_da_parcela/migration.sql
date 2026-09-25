-- O COMPROVANTE DE PAGAMENTO, ENVIADO PELO PRÓPRIO FILIADO. 25/09/2026.
--
-- "O portal o filiado pode consultar débitos em aberto nas cobranças que estão
-- no nome dele e pagar, além de anexar comprovante." — o dono.
--
-- TRÊS COLUNAS E NENHUM STATUS NOVO, e a ausência é a decisão.
--
-- O caminho óbvio seria um `AGUARDANDO_CONFIRMACAO` no enum `StatusParcela`.
-- Não dá: durante a JANELA DE TROCA do deploy, o contêiner ANTIGO da API lê
-- este mesmo banco, e o Prisma ESTOURA ao encontrar um valor de enum que o seu
-- client não conhece. Uma parcela gravada com o status novo derrubaria a
-- listagem de cobranças inteira do contêiner antigo — não só aquela linha.
--
-- Colunas opcionais não têm esse problema: o código antigo simplesmente não as
-- seleciona. "Tem comprovante e ainda não está PAGO" é um estado DERIVADO, que
-- a tela calcula, e a baixa continua sendo a mesma que a secretaria já dá.
--
-- POR QUE NÃO `anexos_documentos`: lá o anexo herda o módulo do PAI, e quem
-- autoriza é o `AnexoDoModuloGuard` a partir de atendimento/processo/
-- compromisso. Um quarto pai significaria mexer no guard que governa a
-- permissão de todos os anexos do sistema, para guardar UM arquivo por parcela.
-- O comprovante é 1-para-1 com a parcela; a coluna diz isso melhor.
--
-- ADITIVA E IDEMPOTENTE: nada existente é alterado ou removido.
ALTER TABLE "parcelas_cobranca"
  ADD COLUMN IF NOT EXISTS "comprovante_key" TEXT,
  ADD COLUMN IF NOT EXISTS "comprovante_nome" TEXT,
  ADD COLUMN IF NOT EXISTS "comprovante_enviado_em" TIMESTAMP(3);

-- A pergunta da secretaria é "quem mandou comprovante e ainda não recebeu
-- baixa?". Índice parcial: só as linhas COM comprovante entram, e são poucas.
CREATE INDEX IF NOT EXISTS "parcelas_com_comprovante"
  ON "parcelas_cobranca" ("comprovante_enviado_em")
  WHERE "comprovante_key" IS NOT NULL;
