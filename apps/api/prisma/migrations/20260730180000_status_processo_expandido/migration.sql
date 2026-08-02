-- Amplia os status internos do processo para cobrir o ciclo de vida real do
-- contencioso (antes só ATIVO/ARQUIVADO/SUSPENSO).
--
-- Em migração SEPARADA de propósito: o PostgreSQL não permite USAR um valor de
-- enum recém-criado dentro da mesma transação que o criou. Isolando o ALTER TYPE
-- aqui, a migração seguinte (que semeia/usa os status) roda sem risco.

ALTER TYPE "StatusProcesso" ADD VALUE IF NOT EXISTS 'PENDENTE';
ALTER TYPE "StatusProcesso" ADD VALUE IF NOT EXISTS 'ENCERRADO';
ALTER TYPE "StatusProcesso" ADD VALUE IF NOT EXISTS 'GANHO_EXECUCAO';
ALTER TYPE "StatusProcesso" ADD VALUE IF NOT EXISTS 'IMPROCEDENTE';
