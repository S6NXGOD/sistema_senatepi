-- Fila de suplentes do sorteio: ordem persistida para promoção automática.
ALTER TABLE "colonia_sorteio_inscricoes" ADD COLUMN "posicao_suplente" INTEGER;

-- Data/hora do sorteio público da temporada (ex.: terça-feira 19:30).
ALTER TABLE "colonia_temporadas" ADD COLUMN "data_sorteio" TIMESTAMP(3);
