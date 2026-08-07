-- ASSUNTOS POR INSTÂNCIA.
--
-- O assunto MUDA entre os graus, e nós guardávamos só o de uma instância — a
-- primeira que o Elasticsearch devolvesse, ou seja, arbitrária. Conferido nos 5
-- processos da produção em 07/08/2026:
--
--   0001000-26.2022.5.22.0002  G1: Adicional de Insalubridade
--                              G2: Multa de 40% do FGTS
--                              TST: Adicional de Insalubridade
--   0000764-11.2021.5.22.0002  G1: FGTS
--                              G2: Arbitragem
--                              TST: Inépcia da Inicial, Cerceamento de Defesa,
--                                   FGTS, Ente Público, Responsabilidade
--                                   Solidária/Subsidiária
--   0001204-05.2024.5.22.0001  G1: Acordo e Convenção Coletivos de Trabalho
--                              G2: Aviso Prévio
--
-- Em 4 dos 5 processos os assuntos DIFEREM entre instâncias. O que ficava
-- gravado era um deles, sorteado pela relevância do Elasticsearch.
--
-- CUSTOU MAIS QUE INFORMAÇÃO PERDIDA: a etiqueta automática de Perícia lê o
-- assunto, e no 0001000-26 o assunto gravado era "Multa de 40% do FGTS" — então
-- o processo que trata de INSALUBRIDADE, e portanto exige laudo pericial, não
-- recebia a etiqueta.
--
-- A partir daqui cada instância guarda os seus, e o `Processo` passa a expor a
-- UNIÃO de todos (é o conjunto de assuntos do processo, que é o que a busca e a
-- etiqueta precisam). A próxima sincronização preenche; até lá as colunas ficam
-- nulas e a leitura cai no que já existe em `processos`.

ALTER TABLE "processos_instancias"
  ADD COLUMN IF NOT EXISTS "assuntos" JSONB,
  ADD COLUMN IF NOT EXISTS "assunto_principal" TEXT;
