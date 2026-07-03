-- Índices ÚNICOS PARCIAIS (só entre reservas CONFIRMADAS).
-- Cancelar uma reserva (status = CANCELADA) libera a vaga e o CPF novamente.

-- CPF único por temporada (entre reservas confirmadas)
CREATE UNIQUE INDEX "ux_colonia_reserva_cpf_temporada"
  ON "colonia_reservas" ("temporada_id", "cpf")
  WHERE "status" = 'CONFIRMADA';

-- Uma reserva confirmada por vaga (lote + quarto)
CREATE UNIQUE INDEX "ux_colonia_reserva_vaga"
  ON "colonia_reservas" ("lote_id", "quarto_id")
  WHERE "status" = 'CONFIRMADA';
