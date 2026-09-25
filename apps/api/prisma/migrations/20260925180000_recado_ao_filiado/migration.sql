-- O RECADO DO ADVOGADO PARA O FILIADO, no portal. 25/09/2026.
--
-- "Existe algo no sistema que o advogado pode colocar para comunicar algo ao
-- filiado pelo portal?" — o dono. NÃO EXISTIA, e é um buraco: o portal mostra o
-- que o TRIBUNAL publicou, em linguagem de tribunal, e nada do que o sindicato
-- tem a dizer sobre aquilo. A pessoa lê "Decurso de Prazo" e liga para a
-- secretaria — que é justamente o telefonema que o portal deveria evitar.
--
-- NÃO É A NOTA INTERNA. `movimentacoes_internas` é a conversa da EQUIPE sobre o
-- caso (estratégia, avaliação de chance) e nunca sai do sistema. O recado nasce
-- sabendo que o filiado vai ler — a diferença está na cabeça de quem escreve, e
-- misturar os dois numa tabela só acabaria com estratégia processual aparecendo
-- no celular da parte contrária pelas mãos do próprio cliente.
--
-- UM "VISTO" SÓ, e a medição permite: dos 194 processos da produção, ZERO tem
-- mais de um filiado (174 não têm nenhum, 20 têm exatamente um). Se um dia
-- entrar uma ação coletiva, `visto_em` passa a significar "alguém viu" — o que
-- continua sendo mais útil do que nada, e está anotado no modelo.
--
-- ADITIVA: tabela nova, nada existente é tocado. O contêiner antigo a ignora.
CREATE TABLE IF NOT EXISTS "recados_do_processo" (
  "id"          TEXT NOT NULL,
  "processo_id" TEXT NOT NULL,
  "texto"       TEXT NOT NULL,
  "autor_id"    TEXT,
  -- O nome fica CONGELADO na linha: o advogado pode sair do sindicato, e o
  -- recado continua tendo de dizer quem escreveu.
  "autor_nome"  TEXT NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "visto_em"    TIMESTAMP(3),
  CONSTRAINT "recados_do_processo_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "recados_do_processo"
    ADD CONSTRAINT "recados_do_processo_processo_id_fkey"
    FOREIGN KEY ("processo_id") REFERENCES "processos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "recados_do_processo_processo_id_idx"
  ON "recados_do_processo" ("processo_id");

-- "Quantos recados ainda não foram vistos?" é a pergunta do painel e do sino do
-- portal: índice parcial, porque os vistos não interessam à contagem.
CREATE INDEX IF NOT EXISTS "recados_nao_vistos"
  ON "recados_do_processo" ("processo_id") WHERE "visto_em" IS NULL;
