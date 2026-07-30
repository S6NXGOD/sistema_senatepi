-- RADAR DE AUDIÊNCIAS — alerta "Audiências a Agendar".
--
-- Marca, na própria movimentação do DataJud, se ela é uma DESIGNAÇÃO de
-- audiência, qual a data designada (extraída do texto) e o estado do alerta
-- (dispensado / já virou evento na agenda). O estado precisa ficar no banco
-- porque a varredura noturna (cron das 02:00) tem de respeitá-lo.

-- 1) Colunas do radar
ALTER TABLE "movimentacoes_processuais"
  ADD COLUMN "eh_audiencia"      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "audiencia_data"    TIMESTAMP(3),
  ADD COLUMN "compromisso_id"    TEXT,
  ADD COLUMN "dispensado_em"     TIMESTAMP(3),
  ADD COLUMN "dispensado_por"    TEXT,
  ADD COLUMN "dispensado_motivo" TEXT;

-- 2) Índices da consulta do radar (pendentes) e do vínculo com a agenda
CREATE INDEX "movimentacoes_processuais_eh_audiencia_dispensado_em_idx"
  ON "movimentacoes_processuais"("eh_audiencia", "dispensado_em");
CREATE INDEX "movimentacoes_processuais_compromisso_id_idx"
  ON "movimentacoes_processuais"("compromisso_id");

-- 3) Vínculo com o evento da agenda. ON DELETE SET NULL de propósito: excluir o
--    evento faz a audiência voltar a aparecer como pendente de agendamento.
ALTER TABLE "movimentacoes_processuais"
  ADD CONSTRAINT "movimentacoes_processuais_compromisso_id_fkey"
  FOREIGN KEY ("compromisso_id") REFERENCES "compromissos"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 4) BACKFILL do histórico já sincronizado.
--
--    Espelha (em SQL) a regra de apps/api/src/modules/processos/utils/audiencia.util.ts
--    — que é a fonte de verdade daqui para a frente. Esta cópia é intencional e
--    de uso único; para reaplicar a regra depois (ex.: ao acrescentar códigos
--    TPU) use POST /audiencias-a-agendar/reclassificar, que roda o classificador
--    em TypeScript sobre todo o histórico.
-- ---------------------------------------------------------------------------

-- 4a) Sinaliza as designações de audiência.
--     Exige SUBSTANTIVO (audiência/sessão de julgamento/perícia) + VERBO de
--     designação. "Disponibilização no Diário", "Publicação" e "Decurso de
--     prazo" não têm verbo de designação e, portanto, não entram.
UPDATE "movimentacoes_processuais"
SET "eh_audiencia" = true
WHERE (
        "codigo_movimento" IN (11025, 12173)
        OR (
          "descricao" ~* '(audi[êe]ncia|sess[ãa]o de julgamento|sess[ãa]o virtual|per[íi]cia)'
          AND "descricao" ~* '(designad|redesignad|remarcad|aprazad|marcad|inclu[íi]d. em pauta|pauta de julgamento)'
        )
      )
  -- Veto: audiência desmarcada não é audiência a agendar.
  AND "descricao" !~* '(cancelad|prejudicad|sem efeito|n[ãa]o realizad|dispensad)';

-- 4b) Extrai a data designada do texto (dd/mm/aaaa + hh:mm opcional).
--     O horário é interpretado no fuso de Teresina e gravado como instante UTC,
--     igual ao que o classificador em TypeScript faz.
UPDATE "movimentacoes_processuais"
SET "audiencia_data" = (
      (
        to_timestamp(
          substring("descricao" from '[0-3][0-9]/[01][0-9]/20[0-9]{2}')
            || ' ' || coalesce(substring("descricao" from '[0-2]?[0-9]:[0-5][0-9]'), '00:00'),
          'DD/MM/YYYY HH24:MI'
        )::timestamp AT TIME ZONE 'America/Fortaleza'
      ) AT TIME ZONE 'UTC'
    )
WHERE "eh_audiencia" = true
  AND "descricao" ~ '[0-3][0-9]/[01][0-9]/20[0-9]{2}';
