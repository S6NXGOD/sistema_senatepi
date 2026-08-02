-- OAB do usuário — chave para cruzar com os advogados informados no processo
-- (e dado de perfil do próprio advogado, útil em petições/relatórios).
--
-- NÃO-DESTRUTIVA: duas colunas opcionais. Nenhum dado existente é tocado.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "oab"    TEXT,
  ADD COLUMN IF NOT EXISTS "oab_uf" TEXT;

-- Busca por inscrição (o cruzamento consulta por OAB).
CREATE INDEX IF NOT EXISTS "users_oab_idx" ON "users"("oab");
