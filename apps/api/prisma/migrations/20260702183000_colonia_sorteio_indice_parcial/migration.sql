-- CPF único (ativo) por temporada na fila de sorteio.
-- Cancelar/encerrar a inscrição (status != INSCRITO) libera o CPF.
CREATE UNIQUE INDEX "ux_colonia_sorteio_cpf_temporada"
  ON "colonia_sorteio_inscricoes" ("temporada_id", "cpf")
  WHERE "status" = 'INSCRITO';
