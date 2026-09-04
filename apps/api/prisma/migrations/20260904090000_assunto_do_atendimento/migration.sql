-- POR QUE O FILIADO PROCUROU O SINDICATO.
--
-- O atendimento sabia COMO a pessoa chegou (`canal`), QUEM atendeu (`setor`,
-- `responsavel`) e COMO terminou (`desfecho`) — e não sabia SOBRE O QUÊ. A
-- pergunta que a diretoria faz ("as pessoas vêm mais por nível ou por salário?
-- quantas só querem saber do processo?") não tinha como ser respondida, e a
-- descrição em texto livre dos registros existentes confirma o problema: sete
-- atendimentos, e cinco deles dizem apenas "Consulta Jurídica".
--
-- A LISTA É CURTA E FECHADA de propósito. Assunto em texto livre vira sinônimo
-- ("insalubridade", "adicional de insalubridade", "INSALUB") e nenhum relatório
-- consegue somar. `OUTRO` existe para o que não couber, e é ele que mostra,
-- pela contagem, quando falta uma categoria.
--
-- SEGURANÇA NA JANELA DE TROCA: criar tipo e acrescentar coluna NULA é
-- aditivo. O contêiner antigo não conhece a coluna e nunca a grava; o novo
-- aceita nulo em todo atendimento que já existe.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AssuntoAtendimento') THEN
    CREATE TYPE "AssuntoAtendimento" AS ENUM (
      'ANDAMENTO_PROCESSO',
      'DUVIDA_TRABALHISTA',
      'REMUNERACAO',
      'PROGRESSAO_NIVEL',
      'ADICIONAIS',
      'JORNADA_ESCALA',
      'ASSEDIO_RETALIACAO',
      'CONTRATO_VINCULO',
      'FERIAS_LICENCAS',
      'BENEFICIOS_SINDICAIS',
      'FINANCEIRO_SINDICAL',
      'OUTRO'
    );
  END IF;
END $$;

ALTER TABLE "atendimentos" ADD COLUMN IF NOT EXISTS "assunto" "AssuntoAtendimento";

-- O relatório agrupa por assunto dentro de um período.
CREATE INDEX IF NOT EXISTS "atendimentos_assunto_idx" ON "atendimentos"("assunto");
