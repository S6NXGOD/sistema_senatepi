-- Conclusão da unificação Funcionário/Prestador → Colaborador.
--
-- A unificação começou em 03/07/2026 (commit "unifica funcionarios/prestadores")
-- e parou no meio: `Colaborador` foi criado, o menu deixou de mostrar os
-- cadastros antigos, mas os módulos continuaram ativos e um serviço de boot
-- COPIAVA Funcionário → Colaborador a cada inicialização. Resultado: a mesma
-- pessoa em duas tabelas, divergindo em silêncio — editar o colaborador não
-- tocava o funcionário, e o QR lido na portaria vinha do registro que ninguém
-- atualizava.
--
-- O que impedia de apagar os antigos era real: `presencas` e `documentos`
-- apontavam para eles, e Colaborador não tinha `qr_token`. Esta migração
-- resolve isso na ordem certa: primeiro dá ao colaborador o que faltava,
-- depois remaneja os vínculos, e só então derruba o legado.
--
-- Casamento por CPF (só dígitos), que é único nas duas pontas.

-- ---------------------------------------------------------------------------
-- 1) Colaborador recebe o que só existia no legado
-- ---------------------------------------------------------------------------
ALTER TABLE "colaboradores" ADD COLUMN IF NOT EXISTS "matricula"      TEXT;
ALTER TABLE "colaboradores" ADD COLUMN IF NOT EXISTS "foto_thumb_key" TEXT;
ALTER TABLE "colaboradores" ADD COLUMN IF NOT EXISTS "qr_token"       TEXT;

-- Herda matrícula e miniatura do funcionário de mesmo CPF (quando houver).
UPDATE "colaboradores" c
   SET "matricula"      = f."matricula",
       "foto_thumb_key" = COALESCE(c."foto_thumb_key", f."foto_thumb_key"),
       -- Reaproveita o token: um QR já impresso continua valendo enquanto o
       -- id não muda. (O payload é assinado sobre id+tipo+token; como o id e o
       -- tipo mudam, na prática o crachá é reemitido — mas não custa manter.)
       "qr_token"       = f."qr_token"
  FROM "funcionarios" f
 WHERE regexp_replace(f."cpf", '\D', '', 'g') = c."cpf";

-- Quem não veio do legado (ou colidiu) ganha token novo agora.
UPDATE "colaboradores" SET "qr_token" = gen_random_uuid()::text WHERE "qr_token" IS NULL;

ALTER TABLE "colaboradores" ALTER COLUMN "qr_token" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "colaboradores_qr_token_key"  ON "colaboradores"("qr_token");
CREATE UNIQUE INDEX IF NOT EXISTS "colaboradores_matricula_key" ON "colaboradores"("matricula");

-- ---------------------------------------------------------------------------
-- 1b) REDE DE SEGURANÇA: funcionários/prestadores que nunca viraram colaborador
--
-- A cópia Funcionário → Colaborador era feita por um serviço que rodava a cada
-- boot da API e só agia quando o CPF tinha 11 dígitos. Quem ficou de fora (CPF
-- em branco, malformado, ou ambiente onde o serviço não chegou a rodar) seria
-- APAGADO pelos DROPs do passo 5, junto com seus documentos.
--
-- Aqui esses órfãos viram colaboradores antes de qualquer destruição. Assim a
-- migração é segura em qualquer base, sem depender de o serviço de boot ter
-- rodado — o que não dá para garantir num ambiente que não se pode inspecionar.
-- ---------------------------------------------------------------------------

-- Cargo/departamento de destino: as FKs são obrigatórias em colaboradores.
INSERT INTO "cargos" ("id", "nome", "created_at", "updated_at")
SELECT gen_random_uuid()::text, 'Não informado', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
 WHERE NOT EXISTS (SELECT 1 FROM "cargos" WHERE "nome" = 'Não informado');

INSERT INTO "departamentos" ("id", "nome", "created_at", "updated_at")
SELECT gen_random_uuid()::text, 'Não informado', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
 WHERE NOT EXISTS (SELECT 1 FROM "departamentos" WHERE "nome" = 'Não informado');

-- Funcionários órfãos. `cpf` de colaborador é UNIQUE e NOT NULL: quem estiver
-- sem CPF utilizável recebe um marcador rastreável ('SEM-CPF-' + id) em vez de
-- ser descartado — perder a pessoa é pior do que carregar um CPF inválido, e a
-- string deixa explícito que precisa de correção manual.
INSERT INTO "colaboradores" (
  "id", "nome", "cpf", "status", "tipo_vinculo", "cargo_id", "departamento_id",
  "qr_token", "matricula", "foto_key", "foto_thumb_key",
  "data_nascimento", "data_admissao", "telefone", "email",
  "cep", "logradouro", "numero", "bairro", "cidade", "uf",
  "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text,
  f."nome",
  CASE WHEN length(regexp_replace(f."cpf", '\D', '', 'g')) = 11
       THEN regexp_replace(f."cpf", '\D', '', 'g')
       ELSE 'SEM-CPF-' || f."id" END,
  CASE WHEN f."status"::text IN ('ATIVO','INATIVO','AFASTADO','FERIAS','DESLIGADO')
       THEN f."status"::text::"StatusColaborador"
       ELSE 'ATIVO'::"StatusColaborador" END,
  CASE f."tipo"::text
    WHEN 'PRESTADOR_SERVICO' THEN 'PJ'::"TipoVinculo"
    WHEN 'ESTAGIARIO'        THEN 'ESTAGIO'::"TipoVinculo"
    WHEN 'TERCEIRIZADO'      THEN 'TERCEIRIZADO'::"TipoVinculo"
    ELSE 'CLT'::"TipoVinculo" END,
  (SELECT "id" FROM "cargos"        WHERE "nome" = 'Não informado' LIMIT 1),
  (SELECT "id" FROM "departamentos" WHERE "nome" = 'Não informado' LIMIT 1),
  f."qr_token", f."matricula", f."foto_key", f."foto_thumb_key",
  f."data_nascimento", f."data_admissao", f."telefone", f."email",
  f."cep", f."endereco", f."numero", f."bairro", f."cidade", f."estado",
  f."created_at", CURRENT_TIMESTAMP
  FROM "funcionarios" f
 WHERE NOT EXISTS (
   SELECT 1 FROM "colaboradores" c
    WHERE c."cpf" = regexp_replace(f."cpf", '\D', '', 'g')
      AND length(regexp_replace(f."cpf", '\D', '', 'g')) = 11
 );

-- Prestadores PESSOA FÍSICA órfãos (os PJ viram Empresa no passo 4).
INSERT INTO "colaboradores" (
  "id", "nome", "cpf", "status", "tipo_vinculo", "cargo_id", "departamento_id",
  "qr_token", "foto_key", "foto_thumb_key", "telefone", "email",
  "vencimento_contrato", "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text,
  pr."nome",
  regexp_replace(pr."cpf_cnpj", '\D', '', 'g'),
  CASE WHEN pr."status"::text = 'ATIVO' THEN 'ATIVO'::"StatusColaborador"
       ELSE 'INATIVO'::"StatusColaborador" END,
  'TERCEIRIZADO'::"TipoVinculo",
  (SELECT "id" FROM "cargos"        WHERE "nome" = 'Não informado' LIMIT 1),
  (SELECT "id" FROM "departamentos" WHERE "nome" = 'Não informado' LIMIT 1),
  pr."qr_token", pr."foto_key", pr."foto_thumb_key", pr."telefone", pr."email",
  pr."vigencia_fim", pr."created_at", CURRENT_TIMESTAMP
  FROM "prestadores" pr
 WHERE pr."tipo_pessoa"::text = 'PESSOA_FISICA'
   AND length(regexp_replace(pr."cpf_cnpj", '\D', '', 'g')) = 11
   AND NOT EXISTS (
     SELECT 1 FROM "colaboradores" c
      WHERE c."cpf" = regexp_replace(pr."cpf_cnpj", '\D', '', 'g')
   );

-- Colisão de matrícula: `matricula` é UNIQUE em colaboradores e pode repetir
-- entre um registro pré-existente e o que acabou de ser copiado.
UPDATE "colaboradores" c
   SET "matricula" = NULL
 WHERE "matricula" IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM "colaboradores" o
      WHERE o."matricula" = c."matricula" AND o."id" < c."id"
   );

-- ---------------------------------------------------------------------------
-- 2) Presenças passam a apontar para o colaborador
-- ---------------------------------------------------------------------------
ALTER TABLE "presencas" ADD COLUMN IF NOT EXISTS "colaborador_id" TEXT;

UPDATE "presencas" p
   SET "colaborador_id" = c."id"
  FROM "funcionarios" f
  JOIN "colaboradores" c ON c."cpf" = regexp_replace(f."cpf", '\D', '', 'g')
 WHERE p."funcionario_id" = f."id";

UPDATE "presencas" p
   SET "colaborador_id" = c."id"
  FROM "prestadores" pr
  JOIN "colaboradores" c ON c."cpf" = regexp_replace(pr."cpf_cnpj", '\D', '', 'g')
 WHERE p."prestador_id" = pr."id";

-- ---------------------------------------------------------------------------
-- 3) Documentos deixam de ficar partidos entre duas fichas
-- ---------------------------------------------------------------------------
UPDATE "documentos" d
   SET "colaborador_id" = c."id", "funcionario_id" = NULL
  FROM "funcionarios" f
  JOIN "colaboradores" c ON c."cpf" = regexp_replace(f."cpf", '\D', '', 'g')
 WHERE d."funcionario_id" = f."id";

UPDATE "documentos" d
   SET "colaborador_id" = c."id", "prestador_id" = NULL
  FROM "prestadores" pr
  JOIN "colaboradores" c ON c."cpf" = regexp_replace(pr."cpf_cnpj", '\D', '', 'g')
 WHERE d."prestador_id" = pr."id";

-- ---------------------------------------------------------------------------
-- 4) Prestador PESSOA JURÍDICA vira Empresa (módulo Patronal)
--
-- PJ não é pessoa e nunca coube em Colaborador. Vai para `empresas` SEM senha:
-- fica cadastrada como fornecedora, sem acesso ao portal patronal — o mesmo
-- caso das empregadoras de colaborador PJ.
-- ---------------------------------------------------------------------------
INSERT INTO "empresas" ("id", "cnpj", "razao_social", "primeiro_acesso", "created_at", "updated_at")
SELECT gen_random_uuid()::text,
       regexp_replace(pr."cpf_cnpj", '\D', '', 'g'),
       pr."nome",
       false,
       pr."created_at",
       CURRENT_TIMESTAMP
  FROM "prestadores" pr
 WHERE pr."tipo_pessoa" = 'PESSOA_JURIDICA'
   AND length(regexp_replace(pr."cpf_cnpj", '\D', '', 'g')) = 14
ON CONFLICT ("cnpj") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5) Só agora o legado cai
--
-- Presenças de gente que não casou por CPF viram registro órfão de propósito:
-- `nome_snapshot` preserva quem entrou no evento, que é o dado que importa para
-- o histórico. Sem isso, perderíamos a contagem do evento.
-- ---------------------------------------------------------------------------
-- O enum vira TEXTO antes da reescrita e volta a enum depois. É o caminho
-- obrigatório: `ALTER TYPE ... ADD VALUE` não pode ser usado na mesma transação
-- em que foi criado, e o Prisma roda a migração inteira numa transação só.
ALTER TABLE "presencas" ALTER COLUMN "tipo_pessoa" TYPE TEXT USING "tipo_pessoa"::text;
DROP TYPE "TipoPessoa";

UPDATE "presencas" SET "tipo_pessoa" = 'COLABORADOR'
 WHERE "tipo_pessoa" IN ('FUNCIONARIO', 'PRESTADOR');

CREATE TYPE "TipoPessoa" AS ENUM ('FILIADO', 'DEPENDENTE', 'COLABORADOR');
ALTER TABLE "presencas"
  ALTER COLUMN "tipo_pessoa" TYPE "TipoPessoa" USING "tipo_pessoa"::"TipoPessoa";

ALTER TABLE "presencas"  DROP COLUMN IF EXISTS "funcionario_id";
ALTER TABLE "presencas"  DROP COLUMN IF EXISTS "prestador_id";
ALTER TABLE "documentos" DROP COLUMN IF EXISTS "funcionario_id";
ALTER TABLE "documentos" DROP COLUMN IF EXISTS "prestador_id";

DROP TABLE IF EXISTS "funcionario_historico";
DROP TABLE IF EXISTS "funcionarios";
DROP TABLE IF EXISTS "prestadores";

-- Índice único da presença, agora pela nova coluna.
CREATE UNIQUE INDEX IF NOT EXISTS "presencas_evento_id_colaborador_id_key"
  ON "presencas"("evento_id", "colaborador_id");

-- FK do colaborador na presença (SetNull: excluir a pessoa não apaga o
-- histórico de quem entrou no evento).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'presencas_colaborador_id_fkey') THEN
    ALTER TABLE "presencas"
      ADD CONSTRAINT "presencas_colaborador_id_fkey"
      FOREIGN KEY ("colaborador_id") REFERENCES "colaboradores"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6) Enums órfãos — nenhuma coluna os referencia depois dos DROPs acima.
-- ---------------------------------------------------------------------------
DROP TYPE IF EXISTS "TipoFuncionario";
DROP TYPE IF EXISTS "StatusFuncionario";
DROP TYPE IF EXISTS "TipoHistoricoFuncionario";
DROP TYPE IF EXISTS "TipoPrestador";
DROP TYPE IF EXISTS "StatusGenerico";
