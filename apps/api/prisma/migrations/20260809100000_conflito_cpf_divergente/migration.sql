-- Novo motivo de conflito: CPF_DIVERGENTE.
--
-- POR QUE UMA MIGRATION SEPARADA, e não uma correção na anterior
-- A migration da folha JÁ FOI APLICADA (no banco de desenvolvimento do
-- SINDSERM). Editar um arquivo já aplicado não reexecuta nada: o Prisma o
-- considera concluído pelo nome. O schema passaria a prometer um valor de enum
-- que aquele banco não tem, e o erro só apareceria quando alguém importasse um
-- arquivo com CPF divergente — em produção, no meio da carga.
--
-- MOTIVO DO VALOR NOVO
-- O export do banco legado do SINDSERM traz CPF; a folha mensal da Prefeitura
-- não. Quando a matrícula bate e o CPF NÃO bate, há dois documentos para a
-- mesma matrícula: um dos dois está errado e o sistema não tem como saber qual.
-- Antes disso existir, o caso caía em "atualização" e o CPF do arquivo era
-- gravado por cima — carimbando a identidade errada em alguém.

-- `ADD VALUE IF NOT EXISTS` é idempotente e roda dentro da transação do Prisma
-- no PostgreSQL 12+. O valor só não pode ser USADO na mesma transação, e aqui
-- ele apenas passa a existir.
ALTER TYPE "MotivoConflito" ADD VALUE IF NOT EXISTS 'CPF_DIVERGENTE';
