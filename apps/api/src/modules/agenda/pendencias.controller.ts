import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { Modulo } from '../../common/permissions/modulo.decorator';
import { nivelEfetivo } from '../../common/permissions/permissoes.constants';
import { PendenciasService } from './pendencias.service';

/**
 * Controller próprio, com prefixo próprio: em `AgendaController` a rota
 * disputaria espaço com o `@Get(':id')` de lá.
 *
 * Gate de AGENDA e não de processos: o sino é sobre as atividades da pessoa.
 * Quem não tem agenda não tem o que ser lembrado — e a publicação sem tarefa,
 * que é o único item de fora, só chega a quem tem processo atribuído.
 *
 * A AÇÃO NOVA É A SEGUNDA EXCEÇÃO, e ela precisa do outro módulo: só conta para
 * quem pode CADASTRAR processo. O nível é resolvido aqui, e não no serviço,
 * porque é aqui que a matriz de permissão do usuário está à mão — e porque um
 * serviço que decide permissão sozinho é um serviço que a próxima chamada
 * esquece de perguntar.
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
    const cadastraProcesso = nivelEfetivo(user.role, user.permissoes, 'processos') === 'EDITAR';
    return this.pendencias.minhas(user.id, cadastraProcesso);
  }
}
