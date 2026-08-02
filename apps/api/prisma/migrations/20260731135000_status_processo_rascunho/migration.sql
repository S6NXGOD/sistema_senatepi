-- Novo status de processo: RASCUNHO (consulta que virou processo, ainda sem NPU).
--
-- EM MIGRAÇÃO SEPARADA de propósito: o Postgres não deixa USAR um valor de enum
-- na mesma transação em que ele é criado ("unsafe use of new value of enum type").
-- A migração seguinte é quem escreve o CHECK que referencia 'RASCUNHO'.

ALTER TYPE "StatusProcesso" ADD VALUE IF NOT EXISTS 'RASCUNHO';
