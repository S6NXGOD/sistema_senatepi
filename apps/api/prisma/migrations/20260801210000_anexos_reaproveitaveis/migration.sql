-- ANEXOS REAPROVEITÁVEIS ("puxar documento de outro atendimento")
--
-- O filiado entrega o mesmo laudo/RG/contracheque várias vezes ao longo do ano.
-- Em vez de exigir upload novo a cada atendimento, a equipe PUXA um documento
-- que já está no acervo do filiado: cria-se uma nova linha em
-- `anexos_documentos` apontando para a MESMA `storage_key` (o arquivo no bucket
-- continua único) e guardando a procedência.
--
-- Consequência para a exclusão: o arquivo só sai do storage quando nenhuma outra
-- linha (aqui ou em `documentos`) ainda aponta para aquela chave — a checagem
-- vive no AnexosService.remover().

-- 1) Terceiro dono possível: a atividade da Agenda.
--    Antes, um compromisso só conseguia EXIBIR os anexos da triagem/processo de
--    origem; uma audiência criada direto na agenda não tinha onde guardar um
--    documento. Agora tem — e a herança da triagem continua valendo.
ALTER TABLE "anexos_documentos"
  ADD COLUMN "compromisso_id"      TEXT,
  ADD COLUMN "origem_anexo_id"     TEXT,
  ADD COLUMN "origem_documento_id" TEXT;

-- 2) Índices: dono (agenda) e a chave do storage (usada para deduplicar o que
--    já foi puxado e para decidir se o arquivo pode ser apagado do bucket).
CREATE INDEX "anexos_documentos_compromisso_id_idx" ON "anexos_documentos"("compromisso_id");
CREATE INDEX "anexos_documentos_storage_key_idx"    ON "anexos_documentos"("storage_key");

-- 3) Vínculos.
--    CASCADE no dono (o documento pertence ao registro); SET NULL na procedência
--    (apagar o anexo de origem não pode apagar a cópia já vinculada em outro
--    atendimento — o documento continua válido onde foi puxado).
ALTER TABLE "anexos_documentos"
  ADD CONSTRAINT "anexos_documentos_compromisso_id_fkey"
  FOREIGN KEY ("compromisso_id") REFERENCES "compromissos"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "anexos_documentos"
  ADD CONSTRAINT "anexos_documentos_origem_anexo_id_fkey"
  FOREIGN KEY ("origem_anexo_id") REFERENCES "anexos_documentos"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "anexos_documentos"
  ADD CONSTRAINT "anexos_documentos_origem_documento_id_fkey"
  FOREIGN KEY ("origem_documento_id") REFERENCES "documentos"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 4) Invariante do vínculo polimórfico: exatamente UM dono.
--    NOT VALID de propósito — vale para tudo que entrar daqui em diante e não
--    trava a migração se alguma linha antiga tiver ficado órfã.
ALTER TABLE "anexos_documentos"
  ADD CONSTRAINT "anexos_documentos_dono_unico_chk"
  CHECK (
    (("atendimento_id" IS NOT NULL)::int
     + ("processo_id"   IS NOT NULL)::int
     + ("compromisso_id" IS NOT NULL)::int) = 1
  ) NOT VALID;
