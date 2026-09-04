import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { Modulo } from '../../common/permissions/modulo.decorator';
import { PendenciasService } from './pendencias.service';

/**
 * Controller próprio, com prefixo próprio: em `AgendaController` a rota
 * disputaria espaço com o `@Get(':id')` de lá.
 *
 * Gate de AGENDA e não de processos: o sino é sobre as atividades da pessoa.
 * Quem não tem agenda não tem o que ser lembrado — e a publicação sem tarefa,
 * que é o único item de fora, só chega a quem tem processo atribuído.
 */
@ApiTags('pendencias')
@ApiBearerAuth()
@Modulo('agenda')
@Controller('minhas-pendencias')
export class PendenciasController {
  constructor(private readonly pendencias: PendenciasService) {}

  @Get()
  @ApiOperation({ summary: 'O que está aberto e depende de quem está pedindo, agora.' })
  minhas(@CurrentUser() user: AuthUser) {
    return this.pendencias.minhas(user.id);
  }
}
