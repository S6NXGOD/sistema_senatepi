import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Request } from 'express';
import { AudienciasService } from './audiencias.service';
import {
  AgendarAudienciaDto,
  DispensarAudienciaDto,
  ListAudienciasQueryDto,
} from './dto/audiencias.dto';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Modulo } from '../../common/permissions/modulo.decorator';
import { RANK_NIVEL, nivelEfetivo } from '../../common/permissions/permissoes.constants';

/**
 * Radar "Audiências a Agendar".
 *
 * Rota de primeiro nível de propósito: aninhar em `/processos/...` colidiria
 * com o `GET /processos/:id` já existente, que casaria com qualquer sufixo.
 */
@ApiTags('audiencias-a-agendar')
@ApiBearerAuth()
@Modulo('processos')
@Controller('audiencias-a-agendar')
export class AudienciasController {
  constructor(private readonly service: AudienciasService) {}

  private ctx(req: Request, userId?: string) {
    return { ip: req.ip, userAgent: req.headers['user-agent'], userId };
  }

  /**
   * Alertas em aberto. O advogado enxerga a própria carteira; coordenação e
   * administração enxergam a operação inteira (mesmo escopo do dashboard).
   */
  @Get()
  @ApiOperation({ summary: 'Audiências designadas no DataJud que ainda não estão na agenda.' })
  listar(@Query() query: ListAudienciasQueryDto, @CurrentUser() user: AuthUser) {
    const escopoPessoal = query.apenasMeus || user.role === UserRole.ADVOGADO;
    return this.service.listar({
      advogadoId: escopoPessoal ? user.id : undefined,
      limite: query.limite,
    });
  }

  /** Marca o alerta como resolvido no banco — não reaparece na varredura noturna. */
  @Post(':id/dispensar')
  @ApiOperation({ summary: 'Dispensa o alerta (persistido; o cron das 02:00 respeita).' })
  dispensar(
    @Param('id') id: string,
    @Body() dto: DispensarAudienciaDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return this.service.dispensar(id, dto.motivo, this.ctx(req, userId));
  }

  /** Desfaz a dispensa (para o caso de clique errado). */
  @Post(':id/restaurar')
  @ApiOperation({ summary: 'Reabre um alerta dispensado.' })
  restaurar(@Param('id') id: string, @CurrentUser('id') userId: string, @Req() req: Request) {
    return this.service.restaurar(id, this.ctx(req, userId));
  }

  /** Cria o evento na Agenda e amarra o alerta a ele. */
  @Post(':id/agendar')
  @ApiOperation({ summary: 'Cria o compromisso de audiência na Agenda e resolve o alerta.' })
  agendar(
    @Param('id') id: string,
    @Body() dto: AgendarAudienciaDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    // A rota grava na Agenda, então exige permissão de EDITAR também lá — o
    // @Modulo do controller só cobre "processos".
    if (RANK_NIVEL[nivelEfetivo(user.role, user.permissoes, 'agenda')] < RANK_NIVEL.EDITAR) {
      throw new ForbiddenException('Você não tem permissão para criar eventos na Agenda.');
    }
    return this.service.agendar(id, dto, this.ctx(req, user.id));
  }

  /**
   * Reaplica o classificador em todo o histórico — usar depois de acrescentar
   * códigos TPU em `utils/audiencia.util.ts`.
   */
  @Post('reclassificar')
  @Roles(UserRole.ADMINISTRADOR)
  @ApiOperation({ summary: 'Reprocessa o radar sobre todas as movimentações já sincronizadas.' })
  reclassificar(@CurrentUser('id') userId: string, @Req() req: Request) {
    return this.service.reclassificar(this.ctx(req, userId));
  }
}
