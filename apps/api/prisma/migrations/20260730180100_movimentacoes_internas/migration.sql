-- MOVIMENTAÇÕES INTERNAS (andamentos registrados pela equipe jurídica) e seus
-- TIPOS cadastráveis.
--
-- Ficam separadas de "movimentacoes_processuais" (espelho do DataJud) porque são
-- conteúdo do escritório: têm autor, anexo, nota interna e podem carimbar a
-- mudança de status do processo. A linha do tempo da tela é a UNIÃO das duas.

-- 1) Tipos de movimentação (cadastráveis)
CREATE TABLE "tipos_movimentacao" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cor" TEXT NOT NULL DEFAULT 'slate',
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "sistema" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tipos_movimentacao_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tipos_movimentacao_slug_key" ON "tipos_movimentacao"("slug");

-- 2) Semeia os tipos padrão (idempotente)
INSERT INTO "tipos_movimentacao" ("id", "slug", "nome", "cor", "ordem", "sistema", "updated_at") VALUES
    ('a1b2c3d0-0000-4000-8000-000000000001', 'ATUALIZACAO', 'Atualização', 'slate',   1, true, CURRENT_TIMESTAMP),
    ('a1b2c3d0-0000-4000-8000-000000000002', 'AUDIENCIA',   'Audiência',   'purple',  2, true, CURRENT_TIMESTAMP),
    ('a1b2c3d0-0000-4000-8000-000000000003', 'DECISAO',     'Decisão',     'emerald', 3, true, CURRENT_TIMESTAMP),
    ('a1b2c3d0-0000-4000-8000-000000000004', 'DESPACHO',    'Despacho',    'teal',    4, true, CURRENT_TIMESTAMP),
    ('a1b2c3d0-0000-4000-8000-000000000005', 'PRAZO',       'Prazo',       'amber',   5, true, CURRENT_TIMESTAMP),
    ('a1b2c3d0-0000-4000-8000-000000000006', 'PROTOCOLO',   'Protocolo',   'blue',    6, true, CURRENT_TIMESTAMP),
    ('a1b2c3d0-0000-4000-8000-000000000007', 'RECURSO',     'Recurso',     'orange',  7, true, CURRENT_TIMESTAMP),
    ('a1b2c3d0-0000-4000-8000-000000000008', 'URGENTE',     'Urgente!',    'red',     8, true, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

-- 3) Movimentações internas
CREATE TABLE "movimentacoes_internas" (
    "id" TEXT NOT NULL,
    "processo_id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "nota_interna" BOOLEAN NOT NULL DEFAULT false,
    "status_anterior" "StatusProcesso",
    "status_novo" "StatusProcesso",
    "anexo_id" TEXT,
    "autor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "movimentacoes_internas_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "movimentacoes_internas_processo_id_created_at_idx"
  ON "movimentacoes_internas"("processo_id", "created_at");
CREATE INDEX "movimentacoes_internas_tipo_idx" ON "movimentacoes_internas"("tipo");

-- Cascade no processo (excluir o processo leva o histórico junto);
-- SetNull no autor e no anexo (excluir usuário/arquivo não apaga o andamento).
ALTER TABLE "movimentacoes_internas"
  ADD CONSTRAINT "movimentacoes_internas_processo_id_fkey"
  FOREIGN KEY ("processo_id") REFERENCES "processos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "movimentacoes_internas"
  ADD CONSTRAINT "movimentacoes_internas_autor_id_fkey"
  FOREIGN KEY ("autor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "movimentacoes_internas"
  ADD CONSTRAINT "movimentacoes_internas_anexo_id_fkey"
  FOREIGN KEY ("anexo_id") REFERENCES "anexos_documentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
