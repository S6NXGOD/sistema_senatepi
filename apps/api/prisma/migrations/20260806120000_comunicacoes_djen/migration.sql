-- PUBLICAÇÕES E INTIMAÇÕES DO DJEN (API Comunica PJe, do CNJ).
--
-- O QUE ISTO ACRESCENTA
-- O DataJud entrega o RÓTULO do ato — "Expedição de documento", "Mero
-- expediente" — e quase nunca o teor: `conteudo` chega nulo na esmagadora
-- maioria das movimentações. Só que quem abre prazo é a PUBLICAÇÃO, e é ela que
-- diz o que precisa ser feito:
--
--   "ATO ORDINATÓRIO Intimo a parte autora a apresentar réplica no prazo de 15
--    dias. CONTESTAÇÃO TEMPESTIVA"
--
-- Sem essa fonte, a atividade automática só podia dizer "Verificação de
-- Intimação / Prazo — confira no PJe o que estão pedindo". Com ela, a atividade
-- passa a nomear a providência e a carregar o texto.
--
-- A tabela COMPLEMENTA `movimentacoes_processuais`, não a substitui: o DataJud
-- continua detectando que algo aconteceu, o DJEN explica o quê. O vínculo entre
-- as duas (`movimentacao_id`) é o que impede um mesmo fato de virar duas
-- atividades.
--
-- LGPD — MUDANÇA DE NATUREZA DO DADO
-- O DataJud expõe só metadado processual. O DJEN traz NOME DAS PARTES dentro de
-- `texto`. É publicação oficial, pública por lei, mas a categoria do dado
-- guardado mudou, e por isso: o teor nunca vai para log de aplicação; a leitura
-- passa pelo mesmo controle de módulo do resto de Processos; e publicação de
-- processo NÃO CADASTRADO não é gravada — nem o texto, nem as partes, nem a OAB
-- (decisão de produto: o sindicato acompanha o próprio acervo, não a carteira
-- inteira de cada advogado).

CREATE TABLE "comunicacoes_djen" (
  "id" TEXT NOT NULL,

  -- Hash da comunicação no DJEN, ÚNICO.
  --
  -- É a idempotência que falta ao lado DataJud, cuja deduplicação é feita em
  -- memória. Aqui a duplicata é impossível por constraint do banco, o que torna
  -- seguro reprocessar a mesma janela de dias — e a varredura reprocessa todo
  -- dia, de propósito, para absorver fim de semana e feriado.
  "hash" TEXT NOT NULL,

  "numero_processo" TEXT NOT NULL,
  "processo_id"     TEXT,
  "instancia_id"    TEXT,
  "sigla_tribunal"  TEXT NOT NULL,

  -- Intimação | Edital | Citação | Lista de distribuição — 4 valores limpos,
  -- e é sobre eles que as regras de classificação são escritas.
  "tipo_comunicacao" TEXT,
  -- TEXTO LIVRE, varia por tribunal. Numa amostra de 100 publicações vieram
  -- "Sentença", "87", "DESPACHO/DECISÃO", "Devedores", "Publicação Automática".
  -- Guardado para exibição; NÃO usar em regra.
  "tipo_documento"   TEXT,
  "nome_orgao"       TEXT,
  "nome_classe"      TEXT,
  -- D = Diário de Justiça Eletrônico Nacional; E = Plataforma Nacional de Editais.
  "meio"             TEXT,
  "link"             TEXT,
  -- O teor integral. É o dado que justifica a integração inteira.
  "texto"            TEXT NOT NULL,

  "data_disponibilizacao" DATE NOT NULL,

  "destinatarios" JSONB,
  "advogados"     JSONB,

  "providencia"           TEXT,
  -- Prazo que o TEXTO menciona. SUGESTÃO — o sistema não calcula vencimento:
  -- contagem oficial depende de dias úteis, feriado da comarca e forma de
  -- intimação, e errar isso para menos é perder prazo.
  "prazo_mencionado_dias" INTEGER,

  "compromisso_id"  TEXT,
  -- Movimentação do DataJud que descreve o MESMO fato.
  "movimentacao_id" TEXT,

  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "comunicacoes_djen_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "comunicacoes_djen_hash_key" ON "comunicacoes_djen"("hash");
CREATE INDEX "comunicacoes_djen_processo_id_data_disponibilizacao_idx"
  ON "comunicacoes_djen"("processo_id", "data_disponibilizacao");
CREATE INDEX "comunicacoes_djen_numero_processo_idx" ON "comunicacoes_djen"("numero_processo");
CREATE INDEX "comunicacoes_djen_compromisso_id_idx" ON "comunicacoes_djen"("compromisso_id");
CREATE INDEX "comunicacoes_djen_movimentacao_id_idx" ON "comunicacoes_djen"("movimentacao_id");

-- CASCADE no processo: a publicação é cache de dado público que pode ser
-- rebuscado; sem o processo ela não tem a quem pertencer.
ALTER TABLE "comunicacoes_djen"
  ADD CONSTRAINT "comunicacoes_djen_processo_id_fkey"
  FOREIGN KEY ("processo_id") REFERENCES "processos"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL nos demais: apagar uma atividade da agenda ou reindexar uma
-- instância não pode levar junto a publicação, que é o registro do que o
-- tribunal comunicou.
ALTER TABLE "comunicacoes_djen"
  ADD CONSTRAINT "comunicacoes_djen_instancia_id_fkey"
  FOREIGN KEY ("instancia_id") REFERENCES "processos_instancias"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "comunicacoes_djen"
  ADD CONSTRAINT "comunicacoes_djen_compromisso_id_fkey"
  FOREIGN KEY ("compromisso_id") REFERENCES "compromissos"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "comunicacoes_djen"
  ADD CONSTRAINT "comunicacoes_djen_movimentacao_id_fkey"
  FOREIGN KEY ("movimentacao_id") REFERENCES "movimentacoes_processuais"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
