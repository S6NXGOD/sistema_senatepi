-- CADASTRO DE SERVIDOR PÚBLICO — o que faltava para o segundo cliente.
--
-- Levantamento com o SINDSERM Teresina (Sindicato dos Servidores Públicos
-- Municipais): dos 16 dados que eles precisam guardar, 14 já existiam. Foto,
-- órgão, matrícula do empregador, cargo, endereço completo, data de admissão,
-- desconto em folha, carteirinha com QR e dependentes já estavam no sistema.
-- Faltavam três coisas — e são universais o bastante para virarem coluna, em
-- vez de campo genérico:
--
--   1. VÍNCULO FUNCIONAL (ativo/aposentado/pensionista). NÃO é a mesma coisa
--      que `situacao`, que descreve o vínculo com o SINDICATO: um aposentado
--      segue filiado e em dia; um servidor na ativa pode estar desfiliado.
--      Guardar as duas no mesmo campo obrigaria a escolher qual verdade contar.
--
--   2. LOTAÇÃO — onde a pessoa trabalha DENTRO do órgão (secretaria, unidade,
--      setor). `empresa` já guarda o empregador; num sindicato de servidores é
--      pela lotação que a base se organiza.
--
--   3. PAI e MÃE como dependentes, para sindicatos que estendem benefícios
--      (clube, convênios) à família de origem.
--
-- Tudo ADITIVO e opcional: nenhuma linha existente muda, e o SENATEPI segue
-- funcionando sem preencher nada disto.

CREATE TYPE "VinculoFuncional" AS ENUM ('ATIVO', 'APOSENTADO', 'PENSIONISTA');

ALTER TABLE "filiados"
  ADD COLUMN IF NOT EXISTS "vinculo_funcional" "VinculoFuncional";

ALTER TABLE "vinculos_profissionais"
  ADD COLUMN IF NOT EXISTS "lotacao" TEXT;

-- Postgres permite ADD VALUE dentro da transação da migration desde a 12,
-- contanto que o valor novo não seja USADO na mesma transação — e não é.
ALTER TYPE "TipoDependente" ADD VALUE IF NOT EXISTS 'PAI';
ALTER TYPE "TipoDependente" ADD VALUE IF NOT EXISTS 'MAE';
