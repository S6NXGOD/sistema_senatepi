import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { UserRole } from '@prisma/client';
import { ColoniaService } from './colonia.service';
import {
  AlocacaoManualDto,
  CancelarReservaDto,
  CreateReservaDiretaDto,
  DataSorteioDto,
  EntrarSorteioDto,
  StatusTemporadaDto,
} from './dto/colonia.dto';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('colonia')
@Controller('colonia')
export class ColoniaController {
  constructor(private readonly service: ColoniaService) {}

  private ctx(req: Request, userId?: string) {
    return { ip: req.ip, userAgent: req.headers['user-agent'], userId };
  }

  // -------- Público (exige Temporada Ativa) --------

  @Public()
  @Get('disponibilidade')
  disponibilidade(@Query('slug') slug?: string) {
    return this.service.disponibilidade(slug);
  }

  // Rate-limit reforçado nos endpoints públicos de escrita (anti-abuso/spam).
  @Public()
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Post('reservas')
  reservaDireta(@Body() dto: CreateReservaDiretaDto, @Req() req: Request) {
    return this.service.criarReservaDireta(dto, this.ctx(req));
  }

  @Public()
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Post('sorteio/inscricao')
  entrarSorteio(@Body() dto: EntrarSorteioDto, @Req() req: Request) {
    return this.service.entrarNoSorteio(dto, this.ctx(req));
  }

  // -------- Administrativo (Diretoria) --------

  @ApiBearerAuth()
  @Roles(UserRole.ADMIN, UserRole.DIRETORIA)
  @Get('admin/temporadas')
  temporadas() {
    return this.service.listarTemporadas();
  }

  @ApiBearerAuth()
  @Roles(UserRole.ADMIN, UserRole.DIRETORIA)
  @Patch('admin/temporadas/:id/status')
  statusTemporada(
    @Param('id') id: string,
    @Body() dto: StatusTemporadaDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return this.service.definirStatusTemporada(id, dto.status, this.ctx(req, userId));
  }

  @ApiBearerAuth()
  @Roles(UserRole.ADMIN, UserRole.DIRETORIA)
  @Patch('admin/temporadas/:id/sorteio')
  dataSorteio(
    @Param('id') id: string,
    @Body() dto: DataSorteioDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return this.service.definirDataSorteio(id, dto.dataSorteio, this.ctx(req, userId));
  }

  @ApiBearerAuth()
  @Roles(UserRole.ADMIN, UserRole.DIRETORIA)
  @Get('admin/painel')
  painel(@Query('temporadaId') temporadaId?: string) {
    return this.service.painelAdmin(temporadaId);
  }

  @ApiBearerAuth()
  @Roles(UserRole.ADMIN, UserRole.DIRETORIA)
  @Patch('admin/reservas/:id/sincronizar-filiado')
  sincronizarReserva(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('nome') autor: string,
    @Req() req: Request,
  ) {
    return this.service.sincronizarFiliado('reserva', id, this.ctx(req, userId), autor);
  }

  @ApiBearerAuth()
  @Roles(UserRole.ADMIN, UserRole.DIRETORIA)
  @Patch('admin/inscricoes/:id/sincronizar-filiado')
  sincronizarInscricao(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('nome') autor: string,
    @Req() req: Request,
  ) {
    return this.service.sincronizarFiliado('inscricao', id, this.ctx(req, userId), autor);
  }

  @ApiBearerAuth()
  @Roles(UserRole.ADMIN, UserRole.DIRETORIA)
  @Get('admin/relatorio.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async relatorioCsv(@Query('temporadaId') temporadaId: string, @Res() res: Response) {
    const { nome, conteudo } = await this.service.relatorioCsv(temporadaId);
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
    res.send(conteudo);
  }

  @ApiBearerAuth()
  @Roles(UserRole.ADMIN, UserRole.DIRETORIA)
  @Get('admin/reservas')
  listar(@Query('temporadaId') temporadaId?: string) {
    return this.service.listarReservas(temporadaId);
  }

  @ApiBearerAuth()
  @Roles(UserRole.ADMIN, UserRole.DIRETORIA)
  @Post('admin/alocacao-manual')
  alocacaoManual(
    @Body() dto: AlocacaoManualDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return this.service.alocacaoManual(dto, this.ctx(req, userId));
  }

  @ApiBearerAuth()
  @Roles(UserRole.ADMIN, UserRole.DIRETORIA)
  @Patch('admin/reservas/:id/cancelar')
  cancelar(
    @Param('id') id: string,
    @Body() dto: CancelarReservaDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return this.service.cancelarReserva(id, dto.motivo, this.ctx(req, userId));
  }

  @ApiBearerAuth()
  @Roles(UserRole.ADMIN, UserRole.DIRETORIA)
  @Post('admin/lotes/:loteId/sorteio/realizar')
  realizarSorteio(
    @Param('loteId') loteId: string,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return this.service.realizarSorteio(loteId, this.ctx(req, userId));
  }
}
