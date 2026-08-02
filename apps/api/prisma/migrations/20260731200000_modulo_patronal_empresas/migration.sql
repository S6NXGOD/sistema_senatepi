-- Módulo Patronal.
--
-- A tabela "empresas" já existia (empregadora de colaboradores PJ/terceirizados).
-- Em vez de criar uma segunda tabela para o mesmo conceito — mesma chave de
-- negócio, o CNPJ — ela é ESTENDIDA com os dados cadastrais e as credenciais
-- de acesso ao portal patronal.
--
-- NÃO-DESTRUTIVA: só adiciona colunas, todas opcionais ou com default.
-- "senha_hash" é NULL de propósito: uma empresa que existe apenas como vínculo
-- de colaborador não tem acesso ao portal enquanto não for habilitada.

ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "nome_fantasia"   TEXT;
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "cep"             TEXT;
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "logradouro"      TEXT;
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "bairro"          TEXT;
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "cidade"          TEXT;
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "uf"              TEXT;
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "senha_hash"      TEXT;
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "primeiro_acesso" BOOLEAN NOT NULL DEFAULT true;

-- Listagem ordenada/filtrada por razão social.
CREATE INDEX IF NOT EXISTS "empresas_razao_social_idx" ON "empresas" ("razao_social");
