-- UM CADASTRO DE ORGANIZAÇÃO, com o patronal pendurado nele.
--
-- O PROBLEMA. "Organização" existia em dois cadastros que não se conheciam:
--
--   · `empresas`         — quem faz REPASSE PATRONAL. CNPJ único, endereço
--                          completo, senha do portal, contribuições. Também é
--                          o empregador do colaborador PJ/TERCEIRIZADO.
--   · `partes_externas`  — quem figura como PARTE no processo e quem EMPREGA o
--                          filiado (`vinculos_profissionais.parte_externa_id`).
--
-- Não havia FK entre eles, e o `documento` de um não conversava com o `cnpj` do
-- outro. O hospital que emprega enfermeiros, é réu numa reclamatória E faz
-- repasse precisava ser cadastrado DUAS VEZES — e um endereço corrigido de um
-- lado nunca chegava ao outro.
--
-- A DECISÃO: `partes_externas` passa a ser O cadastro de organização, e
-- `empresas` vira o DOSSIÊ PATRONAL dela — 1:0..1.
--
-- POR QUE NÃO FUNDIR AS DUAS TABELAS
-- `partes_externas` guarda PESSOA FÍSICA (o enum tem FISICA, e é usado: o
-- particular que é parte num processo). Fundir poria `senha_hash` — credencial
-- de login — em linhas que representam adversários em litígio. O que é patronal
-- é um PAPEL da organização, e papel se modela em tabela própria.
--
-- O QUE ESTA MIGRATION **NÃO** FAZ, e é o que a torna segura:
--   · não move `ContribuicaoPatronal.empresa_id` — o financeiro segue intacto;
--   · não move `colaboradores.empresa_id`;
--   · não toca em `senha_hash` nem em nada de autenticação;
--   · não apaga uma linha sequer.
-- Dinheiro e credencial ficam exatamente onde estavam. Só entra uma ligação.

-- ---------------------------------------------------------------------------
-- 1) A ligação
--
-- UNIQUE: uma organização tem no máximo UM dossiê patronal. Sem isso, dois
-- cadastros de empresa poderiam apontar para a mesma organização e voltaríamos
-- à duplicidade por outro caminho.
--
-- RESTRICT: apagar a organização de quem tem contribuição registrada apagaria
-- (ou orfanaria) histórico financeiro. Quem não deve mais aparecer se INATIVA
-- em `partes_externas.ativo`; apagar não é o caminho.
-- ---------------------------------------------------------------------------
ALTER TABLE "empresas"
  ADD COLUMN IF NOT EXISTS "parte_externa_id" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'empresas_parte_externa_id_key') THEN
    CREATE UNIQUE INDEX "empresas_parte_externa_id_key"
      ON "empresas"("parte_externa_id") WHERE "parte_externa_id" IS NOT NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'empresas_parte_externa_id_fkey'
  ) THEN
    ALTER TABLE "empresas"
      ADD CONSTRAINT "empresas_parte_externa_id_fkey"
      FOREIGN KEY ("parte_externa_id") REFERENCES "partes_externas"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Ligar ao que JÁ EXISTE, casando pelo documento
--
-- Os dois lados guardam SÓ DÍGITOS por contrato — `empresas.cnpj` ("somente
-- dígitos (14), sem máscara") e `partes_externas.documento` ("CPF/CNPJ apenas
-- com dígitos"). Ainda assim a comparação normaliza os dois lados: basta um
-- registro antigo ter entrado com máscara para o casamento falhar em silêncio
-- e criar uma organização duplicada — exatamente o que esta migration existe
-- para acabar.
--
-- CNPJ igual É a mesma organização. Não há aqui o risco de fusão indevida que
-- existe ao casar por NOME.
-- ---------------------------------------------------------------------------
UPDATE "empresas" e
   SET "parte_externa_id" = p."id"
  FROM "partes_externas" p
 WHERE e."parte_externa_id" IS NULL
   AND p."documento" IS NOT NULL
   AND regexp_replace(p."documento", '\D', '', 'g') = regexp_replace(e."cnpj", '\D', '', 'g');

-- ---------------------------------------------------------------------------
-- 3) Criar a organização de quem não tinha
--
-- `institucional` FALSE, explicitamente. É a linha que marca o PRÓPRIO
-- sindicato como polo ativo das ações institucionais, existe uma só e tem
-- índice único parcial. Uma empresa entrando marcada como institucional poria
-- um hospital no polo ativo de toda ação do sindicato — e o defeito só
-- apareceria dentro de uma petição.
--
-- `gen_random_uuid()` é nativo do PostgreSQL 13+ e o `id` da tabela é TEXT.
-- ---------------------------------------------------------------------------
INSERT INTO "partes_externas" (
  "id", "tipo", "nome", "nome_fantasia", "documento",
  "cidade", "uf", "ativo", "institucional", "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text,
  'JURIDICA',
  e."razao_social",
  e."nome_fantasia",
  regexp_replace(e."cnpj", '\D', '', 'g'),
  e."cidade",
  e."uf",
  TRUE,
  FALSE,
  NOW(),
  NOW()
  FROM "empresas" e
 WHERE e."parte_externa_id" IS NULL;

UPDATE "empresas" e
   SET "parte_externa_id" = p."id"
  FROM "partes_externas" p
 WHERE e."parte_externa_id" IS NULL
   AND p."documento" = regexp_replace(e."cnpj", '\D', '', 'g');

-- ---------------------------------------------------------------------------
-- 4) Conferência — reprova a migration se sobrou empresa sem organização
--
-- Um `UPDATE` que não casa nada não falha: ele afeta zero linhas e segue. Sem
-- esta conferência, uma base com dado fora do contrato terminaria a migration
-- "com sucesso" e a unificação estaria pela metade, sem ninguém saber.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  orfas INTEGER;
BEGIN
  SELECT count(*) INTO orfas FROM "empresas" WHERE "parte_externa_id" IS NULL;
  IF orfas > 0 THEN
    RAISE EXCEPTION
      'Restaram % empresa(s) sem organização ligada. A migration seria aplicada pela metade. Conferir com: SELECT id, cnpj, razao_social FROM empresas WHERE parte_externa_id IS NULL;',
      orfas;
  END IF;
END $$;
