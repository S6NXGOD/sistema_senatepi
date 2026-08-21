-- ---------------------------------------------------------------------------
-- O CHECK DO NPU PRECISA ACEITAR OS DOIS RÓTULOS
--
-- `processos_npu_obrigatorio_check` diz: processo sem número único só existe
-- enquanto o status for o pré-processual. A regra continua valendo — o que
-- mudou é que agora esse estado tem DOIS nomes (ver o comentário do enum em
-- `schema.prisma`), e o CHECK só conhecia o antigo:
--
--   CHECK (numero_cnj IS NOT NULL OR status_interno = 'RASCUNHO')
--
-- POR QUE ISTO NÃO APARECEU ANTES. A primeira versão da mudança renomeava o
-- rótulo, e o Postgres reescreve sozinho a expressão do CHECK quando o rótulo é
-- renomeado (a constraint guarda o OID do valor, não o texto). Ao trocar o
-- rename por uma adição — que é o que evita derrubar a listagem durante o
-- deploy —, esse ajuste automático deixou de acontecer, e o CHECK ficou para
-- trás. Sem esta migração, TODO caso pré-processual novo é recusado pelo banco:
--
--   23514: a nova linha viola a restrição "processos_npu_obrigatorio_check"
--
-- ou seja, o desfecho "processo novo" da agenda quebraria em produção, sempre.
--
-- POR QUE EM ARQUIVO SEPARADO. `ALTER TYPE ... ADD VALUE` e o USO do valor
-- adicionado não cabem na mesma transação ("unsafe use of new value of enum
-- type"), e o Prisma roda cada migração dentro de uma. A anterior acrescenta o
-- rótulo; esta, já em outra transação, pode citá-lo.
--
-- A validação varre `processos` inteira e pega ACCESS EXCLUSIVE por um instante.
-- A tabela é pequena (ordem de centenas) e todas as linhas já satisfazem a
-- condição — a nova é estritamente mais PERMISSIVA que a antiga, então não há
-- como reprovar o que já está gravado.
-- ---------------------------------------------------------------------------

ALTER TABLE "processos" DROP CONSTRAINT IF EXISTS "processos_npu_obrigatorio_check";

ALTER TABLE "processos" ADD CONSTRAINT "processos_npu_obrigatorio_check"
  CHECK (
    "numero_cnj" IS NOT NULL
    OR "status_interno" IN ('RASCUNHO', 'PRE_PROCESSUAL')
  );
