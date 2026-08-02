-- Correção da extração de HORA da audiência (refaz o backfill do radar).
--
-- POR QUE UMA MIGRAÇÃO NOVA
-- A regra corrigida nasceu como edição da própria `20260730160000_radar_audiencias`.
-- Isso não pode: aquela migração já foi aplicada, e o Prisma guarda o checksum
-- do arquivo — alterá-lo faz `migrate deploy` abortar com "migration was
-- modified after it was applied" e, como o start do servidor roda
-- `prisma migrate deploy && node dist/src/main.js`, a API nem sobe.
-- O arquivo original foi restaurado e a correção vive aqui.
--
-- O QUE MUDA
-- O backfill antigo pegava QUALQUER hora do texto, mesmo longe da data:
-- "15/08/2026. Local: Fórum, guichê 09:15" virava audiência às 9h15. Agora o
-- horário só conta quando vem logo APÓS a data, separado no máximo por
-- pontuação e "às" — a mesma regra do classificador em TypeScript
-- (utils/audiencia.util.ts), para os dois não divergirem.
--
-- Idempotente e seguro em base vazia: sem movimentações, é um no-op.

UPDATE "movimentacoes_processuais" m
SET "audiencia_data" = (
      (
        to_timestamp(
          d.data || ' ' || coalesce(translate(d.hora, 'hH', '::'), '00:00'),
          'DD/MM/YYYY HH24:MI'
        )::timestamp AT TIME ZONE 'America/Fortaleza'
      ) AT TIME ZONE 'UTC'
    )
FROM (
  SELECT
    "id",
    substring("descricao" from '(?:0[1-9]|[12][0-9]|3[01])/(?:0[1-9]|1[0-2])/20[0-9]{2}') AS data,
    substring(
      "descricao"
      from '(?:0[1-9]|[12][0-9]|3[01])/(?:0[1-9]|1[0-2])/20[0-9]{2}[ ,.:()-]*(?:[àÀ]s|[aA][sS])?[ ]*((?:[01][0-9]|2[0-3])[:hH][0-5][0-9])'
    ) AS hora
  FROM "movimentacoes_processuais"
  WHERE "eh_audiencia" = true
    AND "descricao" ~ '(?:0[1-9]|[12][0-9]|3[01])/(?:0[1-9]|1[0-2])/20[0-9]{2}'
) d
WHERE m."id" = d."id";
