-- Reestruturação de perfis (UserRole) + permissões por módulo.

-- 1) Novas colunas em users
ALTER TABLE "users" ADD COLUMN "nome_exibicao" TEXT;
ALTER TABLE "users" ADD COLUMN "permissoes" JSONB;

-- 2) Recria o enum UserRole mapeando os valores antigos (preserva os dados):
--    ADMIN->ADMINISTRADOR, DIRETORIA->COORDENACAO, FUNCIONARIO/RECEPCAO->TRIAGEM.
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "role" TYPE TEXT USING "role"::text;

UPDATE "users" SET "role" = CASE "role"
  WHEN 'ADMIN'       THEN 'ADMINISTRADOR'
  WHEN 'DIRETORIA'   THEN 'COORDENACAO'
  WHEN 'FUNCIONARIO' THEN 'TRIAGEM'
  WHEN 'RECEPCAO'    THEN 'TRIAGEM'
  ELSE "role"
END;

DROP TYPE "UserRole";
CREATE TYPE "UserRole" AS ENUM ('ADMINISTRADOR', 'COORDENACAO', 'ADVOGADO', 'TRIAGEM');

ALTER TABLE "users" ALTER COLUMN "role" TYPE "UserRole" USING "role"::"UserRole";
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'TRIAGEM';
