-- Tipos de evento da Agenda passam a ser CADASTRÁVEIS.
-- Passos (executados numa única transação pelo Prisma):
--   1. cria a tabela tipos_evento
--   2. semeia os 8 tipos que hoje são o enum (idempotente)
--   3. converte compromissos.tipo de enum para texto (preserva os valores)
--   4. remove o enum, agora sem uso

-- 1) Tabela de tipos de evento
CREATE TABLE "tipos_evento" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cor" TEXT NOT NULL DEFAULT 'slate',
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "sistema" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tipos_evento_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tipos_evento_slug_key" ON "tipos_evento"("slug");

-- 2) Semeia os tipos que hoje existem no enum (slug = valor antigo)
INSERT INTO "tipos_evento" ("id", "slug", "nome", "cor", "ordem", "sistema", "updated_at") VALUES
    ('f1a7e000-0000-4000-8000-000000000001', 'AUDIENCIA', 'Audiência', 'sky', 1, true, CURRENT_TIMESTAMP),
    ('f1a7e000-0000-4000-8000-000000000002', 'PRAZO', 'Prazo', 'red', 2, true, CURRENT_TIMESTAMP),
    ('f1a7e000-0000-4000-8000-000000000003', 'CONSULTA_JURIDICA', 'Consulta Jurídica', 'purple', 3, true, CURRENT_TIMESTAMP),
    ('f1a7e000-0000-4000-8000-000000000004', 'REUNIAO', 'Reunião', 'emerald', 4, true, CURRENT_TIMESTAMP),
    ('f1a7e000-0000-4000-8000-000000000005', 'DILIGENCIA', 'Diligência', 'teal', 5, true, CURRENT_TIMESTAMP),
    ('f1a7e000-0000-4000-8000-000000000006', 'DESPACHO', 'Despacho', 'slate', 6, true, CURRENT_TIMESTAMP),
    ('f1a7e000-0000-4000-8000-000000000007', 'PERICIA', 'Perícia', 'pink', 7, true, CURRENT_TIMESTAMP),
    ('f1a7e000-0000-4000-8000-000000000008', 'COMPROMISSO', 'Compromisso', 'orange', 8, true, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

-- 3) Converte a coluna de enum -> texto, mantendo os valores existentes
ALTER TABLE "compromissos" ALTER COLUMN "tipo" TYPE TEXT USING "tipo"::TEXT;

-- 4) Remove o tipo enum, que não é mais referenciado
DROP TYPE "TipoCompromisso";
