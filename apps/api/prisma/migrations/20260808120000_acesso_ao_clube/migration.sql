-- PORTARIA DO CLUBE.
--
-- O SINDSERM Teresina tem um clube em que o filiado entra pela carteirinha com
-- QR, pela matrícula ou pelo CPF — e a entrada precisa ficar registrada.
--
-- POR QUE UMA TABELA NOVA, E NÃO `presencas`
-- `Presenca` significa "esteve NESTE EVENTO" em todo o sistema: alimenta
-- certificado, quórum de plenário e relatório por evento, e `evento_id` é
-- obrigatório lá. Acesso ao clube é outro fato — acontece todo dia, sem evento.
-- Afrouxar `evento_id` obrigaria TODA consulta de evento a passar a filtrar o
-- que não é evento, e bastaria uma esquecida para um relatório de presença
-- contar entrada de clube. É o mesmo tipo de "duas verdades na mesma coluna"
-- que já custou caro no módulo de processos.
--
-- REGISTRA TAMBÉM AS RECUSAS. Saber que um desfiliado tentou entrar ontem vale
-- mais que saber que dez filiados entraram: é o registro da recusa que a
-- portaria mostra quando alguém reclama.

CREATE TYPE "OrigemAcesso" AS ENUM ('QR', 'MATRICULA', 'CPF');

CREATE TABLE "registros_acesso" (
  "id"             TEXT NOT NULL,
  "tipo_pessoa"    "TipoPessoa" NOT NULL,
  "filiado_id"     TEXT,
  "dependente_id"  TEXT,
  "colaborador_id" TEXT,
  "nome_snapshot"  TEXT NOT NULL,
  "registrado_em"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "origem"         "OrigemAcesso" NOT NULL,
  "identificador"  TEXT,
  "liberado"       BOOLEAN NOT NULL,
  "motivo"         TEXT NOT NULL,
  "registrado_por" TEXT,
  "ip"             TEXT,
  "user_agent"     TEXT,
  CONSTRAINT "registros_acesso_pkey" PRIMARY KEY ("id")
);

-- SetNull, e não Cascade: apagar um cadastro não pode apagar o histórico de
-- quem entrou no clube — o `nome_snapshot` continua respondendo quem era.
ALTER TABLE "registros_acesso"
  ADD CONSTRAINT "registros_acesso_filiado_id_fkey"
    FOREIGN KEY ("filiado_id") REFERENCES "filiados"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "registros_acesso_dependente_id_fkey"
    FOREIGN KEY ("dependente_id") REFERENCES "dependentes"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "registros_acesso_colaborador_id_fkey"
    FOREIGN KEY ("colaborador_id") REFERENCES "colaboradores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A portaria consulta "quem entrou hoje"; o dossiê, "quando esta pessoa entrou".
CREATE INDEX "registros_acesso_registrado_em_idx" ON "registros_acesso"("registrado_em");
CREATE INDEX "registros_acesso_filiado_id_idx" ON "registros_acesso"("filiado_id");
