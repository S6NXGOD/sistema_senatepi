import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Request } from 'express';
import { AudienciasService } from './audiencias.service';
import { AudienciasDoDiarioService } from './audiencias-do-diario.service';
import {
  AgendarAudienciaDto,
  DispensarAudienciaDto,
  ListAudienciasQueryDto,
  RelerPautasQueryDto,
} from './dto/audiencias.dto';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Modulo } from '../../common/permissions/modulo.decorator';
import { OperacaoDeSistema } from '../../common/permissions/operacao-de-sistema.decorator';
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
  constructor(
    private readonly service: AudienciasService,
    private readonly doDiario: AudienciasDoDiarioService,
  ) {}

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
   * RELER O DIÁRIO ATRÁS DE PAUTA — a mesma varredura da noite, sob demanda.
   *
   * Existe porque o leitor melhora: toda vez que um tribunal escreve a data de
   * um jeito novo e a regra passa a entender, o histórico inteiro precisa ser
   * relido. Sem este botão, só o que chegasse DEPOIS do deploy seria lido.
   *
   * NÃO leva a marca de operação de sistema. Ela é para o que só o
   * Administrador dispara, e são exatamente três rotas — um teste as CONTA no
   * texto dos arquivos, então nem citar o nome do decorador aqui dá: escrever
   * a palavra com os parênteses fazia a conta dar quatro e o teste reprovar.
   * Ler o Diário e agendar audiência é trabalho de quem cuida do processo, e
   * a matriz já responde isso: POST em controller de `processos` exige
   * `processos: EDITAR`. Como a rota GRAVA NA AGENDA, exige `agenda: EDITAR`
   * também — a mesma dupla trava do botão "agendar" aqui ao lado, porque o
   * `@Modulo` do controller cobre um módulo só.
   */
  @Post('ler-pautas-do-diario')
  @ApiOperation({ summary: 'Relê as publicações do DJEN e agenda as audiências designadas.' })
  lerPautasDoDiario(
    @Query() query: RelerPautasQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    if (RANK_NIVEL[nivelEfetivo(user.role, user.permissoes, 'agenda')] < RANK_NIVEL.EDITAR) {
      throw new ForbiddenException('Você não tem permissão para criar eventos na Agenda.');
    }
    return this.doDiario.varrer({
      /*
        Reprocessar NÃO ressuscita pauta vencida. `tudo=true` faz o leitor
        reexaminar o que já carimbou — para medir e corrigir a leitura —, mas
        audiência que já aconteceu continua fora da agenda: compromisso que
        nasce vencido é ruído, e 96 das 101 do acervo estão no passado.
      */
      reexaminar: query.tudo === true,
      limite: query.limite,
    });
  }

  /**
   * Reaplica o classificador em todo o histórico — usar depois de acrescentar
   * códigos TPU em `utils/audiencia.util.ts`.
   */
  @Post('reclassificar')
  @OperacaoDeSistema()
  @ApiOperation({ summary: 'Reprocessa o radar sobre todas as movimentações já sincronizadas.' })
  reclassificar(@CurrentUser('id') userId: string, @Req() req: Request) {
    return this.service.reclassificar(this.ctx(req, userId));
  }
}
