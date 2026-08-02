import { Module } from '@nestjs/common';
import { CadastrosController } from './cadastros.controller';
import { CadastrosService } from './cadastros.service';
import { ColaboradoresController } from './colaboradores.controller';
import { ColaboradoresService } from './colaboradores.service';

/**
 * Colaboradores — cadastro ÚNICO da equipe do sindicato.
 *
 * O `ColaboradoresMigracaoService` saiu daqui: ele copiava Funcionário →
 * Colaborador a cada boot da API, mantendo viva a duplicidade que a unificação
 * deveria ter encerrado. Esse trabalho virou migração SQL de uma vez só
 * (20260801190000_unificacao_colaboradores), e as tabelas de origem deixaram
 * de existir.
 */
@Module({
  controllers: [CadastrosController, ColaboradoresController],
  providers: [CadastrosService, ColaboradoresService],
})
export class ColaboradoresModule {}
