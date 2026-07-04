-- Marca (uma vez por registro) que os dados da Colônia já foram subidos para o
-- cadastro do filiado, com o snapshot do que foi atualizado (consulta).
ALTER TABLE "colonia_reservas" ADD COLUMN "filiado_sincronizado_em" TIMESTAMP(3);
ALTER TABLE "colonia_reservas" ADD COLUMN "filiado_sincronizacao" JSONB;

ALTER TABLE "colonia_sorteio_inscricoes" ADD COLUMN "filiado_sincronizado_em" TIMESTAMP(3);
ALTER TABLE "colonia_sorteio_inscricoes" ADD COLUMN "filiado_sincronizacao" JSONB;
