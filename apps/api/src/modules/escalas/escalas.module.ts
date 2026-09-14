import { Module } from '@nestjs/common';
import { AgendaModule } from '../agenda/agenda.module';
import { EscalasController } from './escalas.controller';
import { EscalasService } from './escalas.service';

/*
  AGENDA IMPORTADA (14/09/2026, D16): a troca de plantão passa as consultas de
  quem saiu, confere o choque de quem entra e escreve na linha do tempo da
  consulta — tudo pela porta da agenda. Sem ciclo: AgendaModule não importa
  nada, e quem importa Escalas (Atendimentos) não é importado pela Agenda.
*/
@Module({
  imports: [AgendaModule],
  controllers: [EscalasController],
  providers: [EscalasService],
  exports: [EscalasService],
})
export class EscalasModule {}
