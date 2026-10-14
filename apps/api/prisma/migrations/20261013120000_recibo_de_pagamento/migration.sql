-- O RECIBO DE PAGAMENTO — quando é o sindicato que paga. 13/10/2026.
--
-- "Quero também a possibilidade de gerar recibos para, por exemplo, situações
-- em que o sindicato precisou contratar alguém para prestar um serviço. Tipo,
-- foi um eletricista e consertou uma fiação, aí o sistema gera o recibo para o
-- eletricista assinar e dizer que o sindicato transferiu o valor." — o dono.
--
-- São dois documentos com a mesma estrutura e QUEM ASSINA trocado:
--
--   ENTRADA  o sindicato declara  "Recebemos de Fulano…"   assina o SINDICATO
--   SAÍDA    o prestador declara  "Recebi do SENATEPI…"    assina o PRESTADOR
--
-- O de saída é o que vale mais: ele é a prova, guardada pelo sindicato, de que
-- o dinheiro chegou a quem devia. Sem ele a prestação de contas tem um valor
-- saindo do caixa e nenhuma assinatura do outro lado.
--
-- MEDIDO ANTES: a produção tem ZERO recibos, ZERO saídas no caixa e uma conta
-- ("CONTA SINDICATO"). Não existe hoje nenhuma tela que registre dinheiro
-- SAINDO — o recibo de pagamento é a primeira.
--
-- ADITIVA E IDEMPOTENTE. A coluna nova tem DEFAULT, então o INSERT do
-- contêiner antigo (que não a conhece) continua válido na janela de troca; o
-- enum é NOVO, e não um valor a mais num existente — este último é que derruba
-- o Prisma antigo. A única remoção é de um ÍNDICE, que relaxa a regra em vez
-- de apertá-la: nenhum código lê índice.
DO $$ BEGIN
  CREATE TYPE "TipoRecibo" AS ENUM ('ENTRADA', 'SAIDA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "recibos"
  ADD COLUMN IF NOT EXISTS "tipo" "TipoRecibo" NOT NULL DEFAULT 'ENTRADA';

-- DUAS SÉRIES, e não uma. "Recibo nº 7/2026" sem dizer o lado não responde à
-- pergunta do conselho fiscal (entrou ou saiu?). Separadas, cada série é
-- contínua — e é a continuidade que deixa auditar: dá para perguntar "cadê o
-- 4?". Numa série só, um buraco numa direção ficaria tapado pela outra.
CREATE UNIQUE INDEX IF NOT EXISTS "recibos_exercicio_tipo_numero_key"
  ON "recibos" ("exercicio", "tipo", "numero");

-- A antiga sai DEPOIS de a nova existir. Ela era mais restritiva; retirá-la só
-- afrouxa, e o contêiner antigo — que numera por exercício ignorando o tipo e
-- só grava ENTRADA — continua produzindo pares válidos para a nova.
DROP INDEX IF EXISTS "recibos_exercicio_numero_key";

-- "Quanto saiu do caixa e ainda não tem assinatura?" é a pergunta nova da
-- fila de pendentes, e ela varre por tipo.
CREATE INDEX IF NOT EXISTS "recibos_tipo_idx" ON "recibos" ("tipo");
