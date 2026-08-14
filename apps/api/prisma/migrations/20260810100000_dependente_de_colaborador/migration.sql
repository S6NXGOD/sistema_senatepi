-- DEPENDENTE DE COLABORADOR — e a importação da equipe vinda do sistema antigo.
--
-- Três coisas, todas ADITIVAS. Nenhuma linha existente muda de valor e nenhuma
-- coluna existente muda de significado, então o binário anterior continua
-- subindo depois desta migration (compatível nos dois sentidos).
--
-- 1. `dependentes` passa a aceitar DOIS tipos de titular: filiado (como sempre)
--    ou colaborador (novo). `filiado_id` vira anulável e ganha um irmão.
-- 2. `colaboradores` ganha `empresa_nome` — o contratante em texto, para o
--    prestador cuja empresa não é pessoa jurídica cadastrada.
-- 3. `importacoes` ganha o perfil COLABORADORES_LEGADO e contadores próprios.
--
-- Tudo em IF NOT EXISTS / DO $$: uma migration que explode no segundo deploy
-- trava o `prisma migrate deploy` que roda no start da API.

-- ---------------------------------------------------------------------------
-- 1) Dependentes: titular polimórfico
-- ---------------------------------------------------------------------------

ALTER TABLE "dependentes" ALTER COLUMN "filiado_id" DROP NOT NULL;
ALTER TABLE "dependentes" ADD COLUMN IF NOT EXISTS "colaborador_id" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dependentes_colaborador_id_fkey'
  ) THEN
    ALTER TABLE "dependentes"
      ADD CONSTRAINT "dependentes_colaborador_id_fkey"
      FOREIGN KEY ("colaborador_id") REFERENCES "colaboradores"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "dependentes_colaborador_id_idx"
  ON "dependentes"("colaborador_id");

-- EXATAMENTE UM TITULAR — a regra fica no BANCO, não só no código.
--
-- Sem este CHECK, tornar `filiado_id` anulável abriria duas portas novas: o
-- dependente ÓRFÃO (nenhum titular), que entraria nas contagens do painel e não
-- apareceria em ficha nenhuma, e o de DOIS DONOS, que entraria no clube pelo
-- status de quem estivesse ativo. Nenhum dos dois tem conserto barato depois de
-- criado aos milhares por uma importação — por isso a garantia é do banco, que
-- vale para o serviço, para o script de carga e para o SQL na unha.
--
-- `num_nonnulls` existe no PostgreSQL desde a 9.6.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dependentes_um_titular'
  ) THEN
    ALTER TABLE "dependentes"
      ADD CONSTRAINT "dependentes_um_titular"
      CHECK (num_nonnulls("filiado_id", "colaborador_id") = 1);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Colaborador: empresa contratante em texto
--
-- `empresas.cnpj` é NOT NULL e único porque a tabela é o dossiê PATRONAL (tem
-- login de portal e contribuição). A base legada traz o contratante do
-- prestador só pelo NOME. As duas saídas ruins seriam inventar um CNPJ para
-- caber na FK — poluindo o cadastro patronal com empresas que não contribuem —
-- ou descartar o dado. Esta coluna é a terceira, e segue o precedente já aceito
-- de `vinculos_profissionais.empresa`.
-- ---------------------------------------------------------------------------

ALTER TABLE "colaboradores" ADD COLUMN IF NOT EXISTS "empresa_nome" TEXT;

-- ---------------------------------------------------------------------------
-- 3) Importação da equipe legada
-- ---------------------------------------------------------------------------

-- `ADD VALUE IF NOT EXISTS` roda dentro da transação do Prisma no PostgreSQL
-- 12+; o valor só não pode ser USADO na mesma transação, e aqui ele apenas
-- passa a existir.
ALTER TYPE "PerfilImportacao" ADD VALUE IF NOT EXISTS 'COLABORADORES_LEGADO';

ALTER TABLE "importacoes"
  ADD COLUMN IF NOT EXISTS "dependentes_criados" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "importacoes"
  ADD COLUMN IF NOT EXISTS "dependentes_removidos" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "importacao_linhas" ADD COLUMN IF NOT EXISTS "colaborador_id" TEXT;
