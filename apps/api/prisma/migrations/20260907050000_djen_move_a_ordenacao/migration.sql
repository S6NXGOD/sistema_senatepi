-- A PUBLICAÇÃO NO DIÁRIO PASSA A CONTAR COMO MOVIMENTO.
--
-- `ultimo_movimento_em` ordena a lista de processos em "Movimentação recente".
-- Ela era mantida pelo gatilho das notas internas e pelo lado DataJud; o DJEN
-- nunca a tocou. Medido na produção em 07/09/2026: 37 processos tinham
-- publicação no Diário MAIS NOVA do que a coluna que os ordena — um processo
-- publicado anteontem aparecia abaixo de outro parado desde julho.
--
-- O código novo passa a atualizar a coluna a cada ingestão. Isto aqui é o
-- passado: sem o recálculo, os 37 só sairiam do lugar na próxima vez que o
-- tribunal falasse neles, o que pode levar meses.
--
-- SÓ AVANÇA, nunca recua: o `>` na comparação garante que uma publicação antiga
-- não puxe para trás um processo com nota interna mais recente.
--
-- ADITIVA POR CONSTRUÇÃO. Não cria, não renomeia e não remove nada — só
-- reescreve valores de uma coluna que já existe. O contêiner antigo, que serve
-- tráfego contra este banco durante a troca, continua lendo e escrevendo nela
-- normalmente; ele apenas não fará a atualização nas publicações que ingerir
-- até o contêiner novo assumir.
UPDATE "processos" p
   SET "ultimo_movimento_em" = d.pub
  FROM (
    SELECT "processo_id", max("data_disponibilizacao")::timestamp AS pub
      FROM "comunicacoes_djen"
     WHERE "processo_id" IS NOT NULL
     GROUP BY "processo_id"
  ) d
 WHERE p."id" = d."processo_id"
   AND (p."ultimo_movimento_em" IS NULL OR d.pub > p."ultimo_movimento_em");
