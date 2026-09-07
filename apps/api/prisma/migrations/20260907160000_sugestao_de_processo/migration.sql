-- A AÇÃO NOVA QUE O DIÁRIO REVELA E O SISTEMA JOGAVA FORA.
--
-- A varredura do DJEN consulta por OAB, e o CNJ devolve a carteira INTEIRA de
-- cada advogado. Tudo que não casava com um `Processo.numeroCNJ` cadastrado era
-- descartado na ingestão — decisão correta de privacidade: o processo
-- particular de quem trabalha aqui não é assunto do sindicato.
--
-- Só que junto ia o caso NOVO do próprio sindicato. Esta tabela guarda apenas
-- esses: só entra quando o SINDICATO figura entre os destinatários do ato.
-- Nada de terceiro é persistido.
--
-- ADITIVA POR CONSTRUÇÃO: uma tabela nova, um enum novo e uma FK opcional. O
-- contêiner ANTIGO, que serve tráfego contra este banco durante a troca, não
-- conhece nada disto e continua funcionando — nenhuma coluna existente muda de
-- nome, de tipo ou de obrigatoriedade.
-- AMBOS existe porque o tribunal diz "ambos": em recurso o sindicato figura
-- como recorrente E recorrido. Medido nas 1.408 publicações do acervo em
-- 07/09/2026 -- 754 só autor, 167 só réu e 113 nos dois (11%). Escolher um
-- deles ali seria um chute com cara de fato.
CREATE TYPE "PoloDaSugestao" AS ENUM ('ATIVO', 'PASSIVO', 'AMBOS', 'INDEFINIDO');
CREATE TYPE "StatusSugestaoProcesso" AS ENUM ('PENDENTE', 'CADASTRADO', 'IGNORADO');

CREATE TABLE "sugestoes_processo" (
    "id"              TEXT NOT NULL,
    "numero_cnj"      TEXT NOT NULL,
    "sigla_tribunal"  TEXT,
    "nome_orgao"      TEXT,
    "nome_classe"     TEXT,
    "nosso_polo"      "PoloDaSugestao" NOT NULL,
    "partes"          JSONB,
    "advogados"       JSONB,
    "primeira_em"     TIMESTAMP(3) NOT NULL,
    "ultima_em"       TIMESTAMP(3) NOT NULL,
    "publicacoes"     INTEGER NOT NULL DEFAULT 1,
    "status"          "StatusSugestaoProcesso" NOT NULL DEFAULT 'PENDENTE',
    "processo_id"     TEXT,
    "decidido_por"    TEXT,
    "decidido_em"     TIMESTAMP(3),
    "motivo_descarte" TEXT,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sugestoes_processo_pkey" PRIMARY KEY ("id")
);

-- O mesmo NPU não pode gerar duas sugestões: a ingestão faz `upsert` por ele.
CREATE UNIQUE INDEX "sugestoes_processo_numero_cnj_key" ON "sugestoes_processo"("numero_cnj");
CREATE UNIQUE INDEX "sugestoes_processo_processo_id_key" ON "sugestoes_processo"("processo_id");
-- A fila é lida por status e por recência.
CREATE INDEX "sugestoes_processo_status_ultima_em_idx" ON "sugestoes_processo"("status", "ultima_em");

-- SET NULL nas duas pontas: apagar um processo ou desativar um usuário não pode
-- derrubar o registro de que a sugestão existiu e de que alguém a decidiu.
ALTER TABLE "sugestoes_processo"
  ADD CONSTRAINT "sugestoes_processo_processo_id_fkey"
  FOREIGN KEY ("processo_id") REFERENCES "processos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sugestoes_processo"
  ADD CONSTRAINT "sugestoes_processo_decidido_por_fkey"
  FOREIGN KEY ("decidido_por") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
