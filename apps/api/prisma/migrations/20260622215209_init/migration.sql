-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'DIRETORIA', 'FUNCIONARIO', 'RECEPCAO');

-- CreateEnum
CREATE TYPE "Sexo" AS ENUM ('MASCULINO', 'FEMININO', 'OUTRO');

-- CreateEnum
CREATE TYPE "EstadoCivil" AS ENUM ('SOLTEIRO', 'CASADO', 'DIVORCIADO', 'VIUVO', 'UNIAO_ESTAVEL', 'OUTRO');

-- CreateEnum
CREATE TYPE "SituacaoFiliado" AS ENUM ('ATIVO', 'INATIVO', 'SUSPENSO', 'PENDENTE');

-- CreateEnum
CREATE TYPE "StatusGenerico" AS ENUM ('ATIVO', 'INATIVO');

-- CreateEnum
CREATE TYPE "TipoDependente" AS ENUM ('CONJUGE', 'FILHO');

-- CreateEnum
CREATE TYPE "FormacaoProfissional" AS ENUM ('ENFERMEIRO', 'TECNICO_ENFERMAGEM', 'AUXILIAR_ENFERMAGEM', 'OUTRO');

-- CreateEnum
CREATE TYPE "TipoPessoa" AS ENUM ('FILIADO', 'DEPENDENTE', 'FUNCIONARIO', 'PRESTADOR');

-- CreateEnum
CREATE TYPE "TipoPrestador" AS ENUM ('PESSOA_FISICA', 'PESSOA_JURIDICA');

-- CreateEnum
CREATE TYPE "TipoEvento" AS ENUM ('ASSEMBLEIA', 'CONGRESSO', 'REUNIAO', 'EVENTO_SOCIAL', 'EVENTO_ESPORTIVO', 'OUTRO');

-- CreateEnum
CREATE TYPE "StatusEvento" AS ENUM ('AGENDADO', 'EM_ANDAMENTO', 'REALIZADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "StatusCarteirinha" AS ENUM ('ATIVA', 'EXPIRADA', 'REVOGADA');

-- CreateEnum
CREATE TYPE "TipoDocumento" AS ENUM ('TERMO_CONSENTIMENTO', 'FICHA_FILIACAO', 'CONTRATO', 'DOCUMENTO_PESSOAL', 'OUTRO');

-- CreateEnum
CREATE TYPE "AcaoAuditoria" AS ENUM ('LOGIN', 'LOGOUT', 'CREATE', 'UPDATE', 'DELETE', 'VALIDACAO_QR', 'EXPORT');

-- CreateEnum
CREATE TYPE "StatusRecadastramento" AS ENUM ('PENDENTE', 'APROVADO', 'REJEITADO');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senha_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'FUNCIONARIO',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ultimo_login_em" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expira_em" TIMESTAMP(3) NOT NULL,
    "revogado" BOOLEAN NOT NULL DEFAULT false,
    "user_agent" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_resets" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expira_em" TIMESTAMP(3) NOT NULL,
    "usado" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_resets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "filiados" (
    "id" TEXT NOT NULL,
    "matricula" TEXT NOT NULL,
    "nome_completo" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "rg" TEXT,
    "uf_rg" TEXT,
    "data_nascimento" TIMESTAMP(3) NOT NULL,
    "sexo" "Sexo",
    "estado_civil" "EstadoCivil",
    "naturalidade" TEXT,
    "foto_key" TEXT,
    "foto_thumb_key" TEXT,
    "telefone_principal" TEXT,
    "telefone_secundario" TEXT,
    "email" TEXT,
    "cep" TEXT,
    "endereco" TEXT,
    "numero" TEXT,
    "complemento" TEXT,
    "bairro" TEXT,
    "cidade" TEXT,
    "estado" TEXT,
    "formacao" "FormacaoProfissional",
    "numero_coren" TEXT,
    "data_admissao" TIMESTAMP(3),
    "situacao" "SituacaoFiliado" NOT NULL DEFAULT 'PENDENTE',
    "aprovado_em" TIMESTAMP(3),
    "qr_token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "filiados_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vinculos_profissionais" (
    "id" TEXT NOT NULL,
    "filiado_id" TEXT NOT NULL,
    "empresa" TEXT NOT NULL,
    "cargo" TEXT,
    "matricula" TEXT,
    "ordem" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vinculos_profissionais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dependentes" (
    "id" TEXT NOT NULL,
    "filiado_id" TEXT NOT NULL,
    "tipo" "TipoDependente" NOT NULL,
    "nome" TEXT NOT NULL,
    "cpf" TEXT,
    "data_nascimento" TIMESTAMP(3) NOT NULL,
    "foto_key" TEXT,
    "foto_thumb_key" TEXT,
    "qr_token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dependentes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funcionarios" (
    "id" TEXT NOT NULL,
    "matricula" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "data_nascimento" TIMESTAMP(3),
    "data_admissao" TIMESTAMP(3),
    "telefone" TEXT,
    "email" TEXT,
    "cargo" TEXT,
    "departamento" TEXT,
    "cep" TEXT,
    "endereco" TEXT,
    "numero" TEXT,
    "complemento" TEXT,
    "bairro" TEXT,
    "cidade" TEXT,
    "estado" TEXT,
    "foto_key" TEXT,
    "foto_thumb_key" TEXT,
    "status" "StatusGenerico" NOT NULL DEFAULT 'ATIVO',
    "qr_token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funcionarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prestadores" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo_pessoa" "TipoPrestador" NOT NULL DEFAULT 'PESSOA_FISICA',
    "cpf_cnpj" TEXT NOT NULL,
    "empresa" TEXT,
    "telefone" TEXT,
    "email" TEXT,
    "contrato_numero" TEXT,
    "vigencia_inicio" TIMESTAMP(3),
    "vigencia_fim" TIMESTAMP(3),
    "foto_key" TEXT,
    "foto_thumb_key" TEXT,
    "status" "StatusGenerico" NOT NULL DEFAULT 'ATIVO',
    "qr_token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prestadores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventos" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "local" TEXT,
    "data_inicio" TIMESTAMP(3) NOT NULL,
    "data_fim" TIMESTAMP(3),
    "capacidade_maxima" INTEGER,
    "tipo" "TipoEvento" NOT NULL DEFAULT 'OUTRO',
    "status" "StatusEvento" NOT NULL DEFAULT 'AGENDADO',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "eventos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "presencas" (
    "id" TEXT NOT NULL,
    "evento_id" TEXT NOT NULL,
    "tipo_pessoa" "TipoPessoa" NOT NULL,
    "filiado_id" TEXT,
    "dependente_id" TEXT,
    "funcionario_id" TEXT,
    "prestador_id" TEXT,
    "registrado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nome_snapshot" TEXT NOT NULL,

    CONSTRAINT "presencas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carteirinhas" (
    "id" TEXT NOT NULL,
    "filiado_id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "emitida_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valida_ate" TIMESTAMP(3),
    "status" "StatusCarteirinha" NOT NULL DEFAULT 'ATIVA',
    "pdf_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "carteirinhas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documentos" (
    "id" TEXT NOT NULL,
    "tipo" "TipoDocumento" NOT NULL,
    "titulo" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT,
    "tamanho_bytes" INTEGER,
    "assinado" BOOLEAN NOT NULL DEFAULT false,
    "assinatura_key" TEXT,
    "filiado_id" TEXT,
    "funcionario_id" TEXT,
    "prestador_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recadastramentos" (
    "id" TEXT NOT NULL,
    "filiado_id" TEXT NOT NULL,
    "status" "StatusRecadastramento" NOT NULL DEFAULT 'PENDENTE',
    "dados_anteriores" JSONB,
    "dados_novos" JSONB NOT NULL,
    "observacao" TEXT,
    "revisor_id" TEXT,
    "revisado_em" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recadastramentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auditorias" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "acao" "AcaoAuditoria" NOT NULL,
    "entidade" TEXT,
    "entidade_id" TEXT,
    "descricao" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auditorias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "password_resets_email_idx" ON "password_resets"("email");

-- CreateIndex
CREATE UNIQUE INDEX "filiados_matricula_key" ON "filiados"("matricula");

-- CreateIndex
CREATE UNIQUE INDEX "filiados_cpf_key" ON "filiados"("cpf");

-- CreateIndex
CREATE UNIQUE INDEX "filiados_qr_token_key" ON "filiados"("qr_token");

-- CreateIndex
CREATE INDEX "filiados_situacao_idx" ON "filiados"("situacao");

-- CreateIndex
CREATE INDEX "filiados_cpf_idx" ON "filiados"("cpf");

-- CreateIndex
CREATE INDEX "vinculos_profissionais_filiado_id_idx" ON "vinculos_profissionais"("filiado_id");

-- CreateIndex
CREATE UNIQUE INDEX "dependentes_qr_token_key" ON "dependentes"("qr_token");

-- CreateIndex
CREATE INDEX "dependentes_filiado_id_idx" ON "dependentes"("filiado_id");

-- CreateIndex
CREATE UNIQUE INDEX "funcionarios_matricula_key" ON "funcionarios"("matricula");

-- CreateIndex
CREATE UNIQUE INDEX "funcionarios_cpf_key" ON "funcionarios"("cpf");

-- CreateIndex
CREATE UNIQUE INDEX "funcionarios_qr_token_key" ON "funcionarios"("qr_token");

-- CreateIndex
CREATE INDEX "funcionarios_status_idx" ON "funcionarios"("status");

-- CreateIndex
CREATE UNIQUE INDEX "prestadores_cpf_cnpj_key" ON "prestadores"("cpf_cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "prestadores_qr_token_key" ON "prestadores"("qr_token");

-- CreateIndex
CREATE INDEX "prestadores_status_idx" ON "prestadores"("status");

-- CreateIndex
CREATE INDEX "eventos_status_idx" ON "eventos"("status");

-- CreateIndex
CREATE INDEX "eventos_data_inicio_idx" ON "eventos"("data_inicio");

-- CreateIndex
CREATE INDEX "presencas_evento_id_idx" ON "presencas"("evento_id");

-- CreateIndex
CREATE UNIQUE INDEX "presencas_evento_id_filiado_id_key" ON "presencas"("evento_id", "filiado_id");

-- CreateIndex
CREATE UNIQUE INDEX "presencas_evento_id_dependente_id_key" ON "presencas"("evento_id", "dependente_id");

-- CreateIndex
CREATE UNIQUE INDEX "presencas_evento_id_funcionario_id_key" ON "presencas"("evento_id", "funcionario_id");

-- CreateIndex
CREATE UNIQUE INDEX "presencas_evento_id_prestador_id_key" ON "presencas"("evento_id", "prestador_id");

-- CreateIndex
CREATE UNIQUE INDEX "carteirinhas_filiado_id_key" ON "carteirinhas"("filiado_id");

-- CreateIndex
CREATE UNIQUE INDEX "carteirinhas_numero_key" ON "carteirinhas"("numero");

-- CreateIndex
CREATE INDEX "documentos_filiado_id_idx" ON "documentos"("filiado_id");

-- CreateIndex
CREATE INDEX "documentos_tipo_idx" ON "documentos"("tipo");

-- CreateIndex
CREATE INDEX "recadastramentos_filiado_id_idx" ON "recadastramentos"("filiado_id");

-- CreateIndex
CREATE INDEX "recadastramentos_status_idx" ON "recadastramentos"("status");

-- CreateIndex
CREATE INDEX "auditorias_user_id_idx" ON "auditorias"("user_id");

-- CreateIndex
CREATE INDEX "auditorias_acao_idx" ON "auditorias"("acao");

-- CreateIndex
CREATE INDEX "auditorias_created_at_idx" ON "auditorias"("created_at");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vinculos_profissionais" ADD CONSTRAINT "vinculos_profissionais_filiado_id_fkey" FOREIGN KEY ("filiado_id") REFERENCES "filiados"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dependentes" ADD CONSTRAINT "dependentes_filiado_id_fkey" FOREIGN KEY ("filiado_id") REFERENCES "filiados"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presencas" ADD CONSTRAINT "presencas_evento_id_fkey" FOREIGN KEY ("evento_id") REFERENCES "eventos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presencas" ADD CONSTRAINT "presencas_filiado_id_fkey" FOREIGN KEY ("filiado_id") REFERENCES "filiados"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presencas" ADD CONSTRAINT "presencas_dependente_id_fkey" FOREIGN KEY ("dependente_id") REFERENCES "dependentes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presencas" ADD CONSTRAINT "presencas_funcionario_id_fkey" FOREIGN KEY ("funcionario_id") REFERENCES "funcionarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presencas" ADD CONSTRAINT "presencas_prestador_id_fkey" FOREIGN KEY ("prestador_id") REFERENCES "prestadores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carteirinhas" ADD CONSTRAINT "carteirinhas_filiado_id_fkey" FOREIGN KEY ("filiado_id") REFERENCES "filiados"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos" ADD CONSTRAINT "documentos_filiado_id_fkey" FOREIGN KEY ("filiado_id") REFERENCES "filiados"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos" ADD CONSTRAINT "documentos_funcionario_id_fkey" FOREIGN KEY ("funcionario_id") REFERENCES "funcionarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos" ADD CONSTRAINT "documentos_prestador_id_fkey" FOREIGN KEY ("prestador_id") REFERENCES "prestadores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recadastramentos" ADD CONSTRAINT "recadastramentos_filiado_id_fkey" FOREIGN KEY ("filiado_id") REFERENCES "filiados"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recadastramentos" ADD CONSTRAINT "recadastramentos_revisor_id_fkey" FOREIGN KEY ("revisor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditorias" ADD CONSTRAINT "auditorias_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
