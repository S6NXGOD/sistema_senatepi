-- Campos de perfil do usuário/administrador.
ALTER TABLE "users" ADD COLUMN "username" TEXT;
ALTER TABLE "users" ADD COLUMN "avatar_url" TEXT;

-- username único (Postgres permite múltiplos NULL no índice único).
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
