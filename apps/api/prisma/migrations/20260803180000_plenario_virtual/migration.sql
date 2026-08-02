-- Plenário Virtual — assembleias, cursos e sorteios remotos.
--
-- O evento vira um motor configurável: o mesmo model atende assembleia com
-- votação, curso com certificado e sorteio ao vivo, conforme as chaves em
-- `configuracoes`. Três tabelas paralelas duplicariam presença, check-in e
-- dossiê, e divergiriam no primeiro ajuste feito só numa delas.
--
-- NÃO existe tabela nova de participantes. `presencas` já é o registro de quem
-- esteve no evento, já impede entrada duplicada e já guarda o nome em snapshot;
-- ela apenas GANHA as colunas de evidência. Uma segunda tabela obrigaria a
-- somar duas fontes para contar quórum — e quórum errado invalida assembleia.

-- ---------------------------------------------------------------------------
-- 1) Novos tipos de evento
--
-- ALTER TYPE ... ADD VALUE não pode rodar na mesma transação em que o valor é
-- usado, e o Prisma envolve a migração inteira numa transação. Como aqui os
-- valores só são gravados depois (pelo app), o ADD VALUE isolado funciona —
-- foi o que já resolvemos em 20260801160000_cadastros_base_absorvidos.
-- ---------------------------------------------------------------------------
ALTER TYPE "TipoEvento" ADD VALUE IF NOT EXISTS 'CURSO';
ALTER TYPE "TipoEvento" ADD VALUE IF NOT EXISTS 'SORTEIO';
ALTER TYPE "TipoEvento" ADD VALUE IF NOT EXISTS 'NEGOCIACAO';

-- ---------------------------------------------------------------------------
-- 2) Enums do plenário
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "ModoVotacao" AS ENUM ('SECRETA', 'NOMINAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "StatusPauta" AS ENUM ('RASCUNHO', 'ABERTA', 'ENCERRADA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "OrigemPresenca" AS ENUM ('QR_PRESENCIAL', 'AUTOATENDIMENTO_VIRTUAL', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 3) Evento: configuração, reunião e fechamento
-- ---------------------------------------------------------------------------
ALTER TABLE "eventos"
  ADD COLUMN IF NOT EXISTS "configuracoes"    JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "link_reuniao"     TEXT,
  ADD COLUMN IF NOT EXISTS "google_event_id"  TEXT,
  ADD COLUMN IF NOT EXISTS "url_video_drive"  TEXT,
  ADD COLUMN IF NOT EXISTS "texto_ata"        TEXT,
  ADD COLUMN IF NOT EXISTS "dossie_pdf_key"   TEXT,
  ADD COLUMN IF NOT EXISTS "dossie_gerado_em" TIMESTAMP(3);

-- ---------------------------------------------------------------------------
-- 4) Presença: evidências de acesso
--
-- Isto NÃO é assinatura digital. Não há certificado ICP-Brasil nem chave
-- privada do signatário: prova que alguém, de posse daquele CPF, acessou
-- daquele IP naquele instante, com o vínculo conferido na hora. É evidência
-- forte de participação — chamar de "assinatura" atribuiria ao dossiê um valor
-- probatório que ele não tem.
--
-- LGPD (Lei nº 13.709/2018): endereço IP é dado pessoal. A coleta é informada
-- ANTES na tela de check-in, e a base legal consta do dossiê.
--
-- O default QR_PRESENCIAL preserva o significado das presenças já existentes:
-- todas vieram da leitura de QR na portaria.
-- ---------------------------------------------------------------------------
ALTER TABLE "presencas"
  ADD COLUMN IF NOT EXISTS "origem"        "OrigemPresenca" NOT NULL DEFAULT 'QR_PRESENCIAL',
  ADD COLUMN IF NOT EXISTS "ip"            TEXT,
  ADD COLUMN IF NOT EXISTS "user_agent"    TEXT,
  ADD COLUMN IF NOT EXISTS "cpf_informado" TEXT;

-- ---------------------------------------------------------------------------
-- 5) Pautas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "pautas_votacao" (
  "id"            TEXT NOT NULL,
  "evento_id"     TEXT NOT NULL,
  "ordem"         INTEGER NOT NULL DEFAULT 0,
  "titulo"        TEXT NOT NULL,
  "descricao"     TEXT,
  -- [{ "id": "sim", "rotulo": "Aprovo" }, ...] — `id` é o que a urna referencia.
  "opcoes"        JSONB NOT NULL,
  "modo"          "ModoVotacao" NOT NULL DEFAULT 'SECRETA',
  "status"        "StatusPauta" NOT NULL DEFAULT 'RASCUNHO',
  "quorum_minimo" INTEGER,
  "aberta_em"     TIMESTAMP(3),
  "encerrada_em"  TIMESTAMP(3),
  "autor"         TEXT,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pautas_votacao_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pautas_votacao_evento_id_fkey" FOREIGN KEY ("evento_id")
    REFERENCES "eventos"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "pautas_votacao_evento_id_ordem_idx"
  ON "pautas_votacao"("evento_id", "ordem");

-- ---------------------------------------------------------------------------
-- 6) Habilitação — QUEM votou
--
-- O índice único é a trava do voto duplo. Conferir com SELECT antes de inserir
-- perderia a corrida entre dois cliques simultâneos; deixar o banco recusar é o
-- que torna a garantia real.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "votos_habilitacao" (
  "id"         TEXT NOT NULL,
  "pauta_id"   TEXT NOT NULL,
  "filiado_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "votos_habilitacao_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "votos_habilitacao_pauta_id_fkey" FOREIGN KEY ("pauta_id")
    REFERENCES "pautas_votacao"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "voto_habilitacao_unico"
  ON "votos_habilitacao"("pauta_id", "filiado_id");
CREATE INDEX IF NOT EXISTS "votos_habilitacao_pauta_id_idx"
  ON "votos_habilitacao"("pauta_id");

-- ---------------------------------------------------------------------------
-- 7) Urna — O QUE foi votado
--
-- SIGILO. Repare no que esta tabela NÃO tem: `created_at`.
--
-- A ausência é deliberada. Com carimbo de tempo aqui e em `votos_habilitacao`,
-- bastaria ordenar as duas por horário para parear voto e votante — o sigilo
-- seria decorativo. Sem timestamp e com id aleatório, não há consulta que
-- correlacione as duas, nem com acesso direto ao banco.
--
-- Em pauta NOMINAL o `filiado_id` é preenchido, porque a ata precisa registrar
-- o voto de cada presente. Sem FK para `filiados`: o voto é um ato registrado, e
-- excluir o cadastro do filiado não pode apagar deliberação de assembleia.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "votos_urna" (
  "id"         TEXT NOT NULL,
  "pauta_id"   TEXT NOT NULL,
  "opcao_id"   TEXT NOT NULL,
  -- SOMENTE em pauta NOMINAL. Nulo é o que garante o sigilo.
  "filiado_id" TEXT,
  CONSTRAINT "votos_urna_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "votos_urna_pauta_id_fkey" FOREIGN KEY ("pauta_id")
    REFERENCES "pautas_votacao"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "votos_urna_pauta_id_idx" ON "votos_urna"("pauta_id");

-- ---------------------------------------------------------------------------
-- 8) Sorteios
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "sorteios_evento" (
  "id"           TEXT NOT NULL,
  "evento_id"    TEXT NOT NULL,
  "titulo"       TEXT NOT NULL,
  "premio"       TEXT,
  "criterio"     JSONB NOT NULL DEFAULT '{}',
  -- Semente guardada para o sorteio ser reexecutável e conferível. Sorteio que
  -- ninguém pode auditar é sorteio que ninguém precisa acreditar.
  "seed"         TEXT NOT NULL,
  "resultado"    JSONB NOT NULL,
  "realizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "autor"        TEXT,
  CONSTRAINT "sorteios_evento_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sorteios_evento_evento_id_fkey" FOREIGN KEY ("evento_id")
    REFERENCES "eventos"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "sorteios_evento_evento_id_idx"
  ON "sorteios_evento"("evento_id");
