-- Fim do módulo "Cadastros Base".
--
-- Ele existia para editar três listas — Departamentos, Cargos e Empresas — e
-- tinha menu próprio, chave de permissão própria e nenhuma auditoria. Dois
-- problemas o condenaram:
--
--  1) EMPRESAS não é uma "lista de apoio": é a entidade do módulo Patronal
--     (credencial de portal, endereço, contribuições). O CRUD simplificado
--     apagava empresa com `prisma.empresa.delete`, e como
--     ContribuicaoPatronal.empresa_id é ON DELETE CASCADE, isso levava junto
--     todas as contribuições — sem confirmação e sem log. A trava
--     "está em uso por colaboradores" nunca disparava, porque a FK de
--     Colaborador é ON DELETE SET NULL (nunca gera P2003).
--
--  2) CARGOS e DEPARTAMENTOS são de Colaboradores e de mais ninguém. Quem
--     edita colaborador é quem edita a lista — a permissão separada só criava
--     uma linha a mais na matriz, e nem valia: o controller checava @Roles,
--     não o módulo.
--
-- Nenhum dado é perdido aqui: as três tabelas continuam intactas. O que sai é
-- o CAMINHO para apagar empresa pela porta dos fundos.

-- 1) Aposentadoria sem exclusão -------------------------------------------
-- cargo_id/departamento_id são NOT NULL em colaboradores: um registro em uso
-- não pode ser apagado nunca. Sem `ativo`, um cargo extinto ficava para sempre
-- na lista de seleção.
ALTER TABLE "cargos"        ADD COLUMN IF NOT EXISTS "ativo" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "departamentos" ADD COLUMN IF NOT EXISTS "ativo" BOOLEAN NOT NULL DEFAULT true;

-- 2) A chave `cadastros` sai das matrizes de permissão já gravadas ---------
-- `sanitizarPermissoes` no back descarta chaves desconhecidas na hora de
-- gravar, mas as matrizes existentes continuariam carregando a chave morta.
UPDATE "users"
   SET "permissoes" = "permissoes" - 'cadastros'
 WHERE "permissoes" IS NOT NULL
   AND jsonb_typeof("permissoes") = 'object'
   AND "permissoes" ? 'cadastros';
