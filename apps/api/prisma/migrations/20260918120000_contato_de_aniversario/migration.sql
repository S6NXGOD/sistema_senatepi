-- O SINDICATO CUMPRIMENTOU, OU DECIDIU NÃO CUMPRIMENTAR (18/09/2026).
--
-- O cartão de aniversariantes da home era passivo: mostrava quem faz aniversário
-- e ficava por isso mesmo. Ninguém sabia se alguém já tinha falado com a pessoa,
-- e no dia seguinte a informação sumia. O dono pediu que ele PEÇA uma decisão —
-- parabenizar ou deixar passar.
--
-- "Deixar passar" sem registro seria um botão de fechar, e a casa não tem botão
-- de fechar: o que faz um aviso sumir é o FATO, nunca o gesto de dispensá-lo.
-- Por isso os DOIS desfechos são gravados: saber que ninguém falou com a Maria
-- é tão útil quanto saber que a Ana foi cumprimentada.
--
-- ADITIVA E IDEMPOTENTE. Uma tabela nova, nenhuma coluna mexida, nenhuma FK.
-- Durante a janela de troca do deploy o contêiner antigo simplesmente ignora a
-- tabela: ele não a lê, não a escreve e não sabe que ela existe.
--
-- POLIMÓRFICA como a própria lista do painel, em que filiado e colaborador
-- aparecem lado a lado. Sem chave estrangeira pelo mesmo motivo de
-- `concluido_por`: apagar a pessoa não pode travar a exclusão dela, e a linha é
-- trilha de relacionamento, não um vínculo de integridade.

CREATE TABLE IF NOT EXISTS "contatos_de_aniversario" (
  "id"         TEXT NOT NULL,
  "pessoa_id"  TEXT NOT NULL,
  "tipo"       TEXT NOT NULL,
  -- DIA de calendário, não instante: a pergunta é "já cuidaram do aniversário
  -- de hoje?", e hoje é um dia em Teresina. Coluna DATE, lida com `formatDataPura`.
  "dia"        DATE NOT NULL,
  "desfecho"   TEXT NOT NULL,
  "autor"      TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "contatos_de_aniversario_pkey" PRIMARY KEY ("id")
);

-- A CHAVE NATURAL: uma decisão por pessoa por dia. Clicar duas vezes não gera
-- duas linhas, e trocar de ideia no mesmo dia atualiza em vez de acumular.
CREATE UNIQUE INDEX IF NOT EXISTS "contatos_de_aniversario_pessoa_id_dia_key"
  ON "contatos_de_aniversario" ("pessoa_id", "dia");

-- O painel pergunta sempre pelo DIA de hoje: é por aí que a consulta entra.
CREATE INDEX IF NOT EXISTS "contatos_de_aniversario_dia_idx"
  ON "contatos_de_aniversario" ("dia");
