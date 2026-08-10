-- LIGA OS VÍNCULOS JÁ IMPORTADOS AO ÓRGÃO CADASTRADO.
--
-- O DEFEITO. `vinculos_profissionais` guarda o empregador em DOIS lugares:
-- `empresa` (texto) e `parte_externa_id` (a ligação com o cadastro). A
-- importação da folha preenchia só o texto — no acervo do SINDSERM, os 963
-- vínculos ficaram com `parte_externa_id` NULO embora as 36 secretarias
-- estivessem cadastradas ali do lado.
--
-- POR QUE O TEXTO SOZINHO NÃO BASTA:
--   1. "Quantos filiados na SEMEC?" só pode ser respondido agrupando por texto.
--      Basta a folha seguinte escrever "SEMEC " com espaço, ou a razão social
--      por extenso, e vira outro grupo — uma variação nova por competência.
--   2. Renomear o órgão no cadastro não propaga: os vínculos seguem com o nome
--      velho depois de uma reforma administrativa.
--   3. O combobox oferece o cadastro, mas o importado não está ligado a ele —
--      parece ligado e não está.
--
-- O TEXTO CONTINUA COMO ESTÁ. Ele é a FOTOGRAFIA do que a folha disse e é o
-- que responde "onde a pessoa trabalha" mesmo depois de a organização sair do
-- cadastro (a FK é SetNull). Esta migration NÃO altera `empresa`.
--
-- ADITIVA E CONSERVADORA: só preenche o que está NULO, nunca sobrescreve uma
-- ligação que alguém já fez pela tela.
--
-- ---------------------------------------------------------------------------
-- A REGRA DE CASAMENTO — precisa concordar com `chaveOrganizacao()` no
-- TypeScript (`organizacao-vinculo.util.ts`), que é quem liga os vínculos das
-- PRÓXIMAS importações. Se divergirem, o backfill liga um conjunto e o
-- importador liga outro, e a base fica com metade ligada sem sintoma visível.
--
--   maiúsculas · espaços internos colapsados · aparado nas pontas
--   SEM remoção de acento, de propósito: os dois lados vêm da mesma origem, e
--   ampliar o casamento aproximaria nomes que talvez não sejam o mesmo órgão.
--
-- CASAMENTO EXATO, NUNCA POR SEMELHANÇA. Um casamento aproximado poria o
-- servidor na secretaria errada, e ninguém descobriria olhando a tela — porque
-- o texto do vínculo continuaria certo.
-- ---------------------------------------------------------------------------

-- Sigla (`nome_fantasia`) tem precedência: é o que a folha escreve ("SEMEC").
-- Chave AMBÍGUA — a mesma sigla em duas organizações — é descartada pelo
-- `HAVING count(*) = 1`: casar com qualquer uma seria sortear em qual
-- secretaria o servidor trabalha.
WITH chaves AS (
  SELECT upper(btrim(regexp_replace("nome_fantasia", '\s+', ' ', 'g'))) AS chave,
         min("id") AS org_id,
         count(*) AS quantas
    FROM "partes_externas"
   WHERE "ativo" AND "nome_fantasia" IS NOT NULL AND btrim("nome_fantasia") <> ''
   GROUP BY 1
  HAVING count(*) = 1

  UNION ALL

  SELECT upper(btrim(regexp_replace("nome", '\s+', ' ', 'g'))) AS chave,
         min("id") AS org_id,
         count(*) AS quantas
    FROM "partes_externas"
   WHERE "ativo"
   GROUP BY 1
  HAVING count(*) = 1
),
-- Uma chave que apareça nas DUAS listas (sigla de uma, razão social de outra)
-- também é ambígua e sai fora.
unicas AS (
  SELECT chave, min(org_id) AS org_id
    FROM chaves
   GROUP BY chave
  HAVING count(*) = 1
)
UPDATE "vinculos_profissionais" v
   SET "parte_externa_id" = u.org_id
  FROM unicas u
 WHERE v."parte_externa_id" IS NULL
   AND upper(btrim(regexp_replace(v."empresa", '\s+', ' ', 'g'))) = u.chave;

-- ---------------------------------------------------------------------------
-- Relatório no log do deploy.
--
-- Ficar NULO é resultado legítimo e esperado: "NÃO INFORMADO NA FOLHA" é célula
-- vazia da Prefeitura, e órgão fora da lista é órgão que a secretaria ainda vai
-- cadastrar. Por isso isto AVISA e não falha — diferente da migration da
-- unificação patronal, onde sobrar linha significava trabalho pela metade.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  ligados INTEGER;
  soltos  INTEGER;
BEGIN
  SELECT count(*) INTO ligados FROM "vinculos_profissionais" WHERE "parte_externa_id" IS NOT NULL;
  SELECT count(*) INTO soltos  FROM "vinculos_profissionais" WHERE "parte_externa_id" IS NULL;
  RAISE NOTICE 'vinculos ligados ao cadastro de organizacoes: % | sem ligacao: %', ligados, soltos;
  IF soltos > 0 THEN
    RAISE NOTICE 'Os sem ligacao sao esperados (orgao nao informado na folha ou fora do cadastro). Conferir com: SELECT empresa, count(*) FROM vinculos_profissionais WHERE parte_externa_id IS NULL GROUP BY 1 ORDER BY 2 DESC;';
  END IF;
END $$;
