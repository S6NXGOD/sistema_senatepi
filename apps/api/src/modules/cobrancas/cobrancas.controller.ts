import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { UserRole } from '@prisma/client';
import { CobrancasService } from './cobrancas.service';
import {
  ConfiguracaoSindicatoDto,
  GravarCobrancaDto,
  ListarParcelasQueryDto,
  SimularCobrancaDto,
} from './dto/cobrancas.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('cobrancas')
@ApiBearerAuth()
@Roles(UserRole.ADMIN, UserRole.DIRETORIA)
@Controller('cobrancas')
export class CobrancasController {
  constructor(private readonly service: CobrancasService) {}

  private ctx(req: Request, userId?: string) {
    return { ip: req.ip, userAgent: req.headers['user-agent'], userId };
  }

  // ---- Configuração institucional (logo, assinatura, rodapé, PIX) ----
  @Get('config')
  obterConfig() {
    return this.service.obterConfig();
  }

  @Put('config')
  salvarConfig(
    @Body() dto: ConfiguracaoSindicatoDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return this.service.salvarConfig(dto, this.ctx(req, userId));
  }

  // ---- Simulação (não persiste) ----
  @Post('simular')
  simular(@Body() dto: SimularCobrancaDto) {
    return this.service.simular(dto);
  }

  // ---- Gravação da cobrança + parcelas (transação) ----
  @Post('gravar')
  gravar(
    @Body() dto: GravarCobrancaDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return this.service.gravar(dto, this.ctx(req, userId));
  }

  // ---- Lista geral de parcelas (gestão) com filtros ----
  @Get('parcelas')
  listarParcelas(@Query() query: ListarParcelasQueryDto) {
    return this.service.listarParcelas(query);
  }

  // ---- Histórico financeiro de um filiado (LGPD) ----
  @Get('filiado/:id')
  historicoFiliado(@Param('id') id: string) {
    return this.service.historicoFiliado(id);
  }

  // ---- PIX Copia e Cola de uma parcela ----
  @Get('parcela/:id/pix')
  pixParcela(@Param('id') id: string) {
    return this.service.gerarPixParcela(id);
  }

  // ---- Dados agregados para impressão do carnê de uma cobrança ----
  @Get(':id/carne')
  carne(@Param('id') id: string) {
    return this.service.dadosCarne(id);
  }

  // ---- Baixa manual de parcela (marca como paga) ----
  @Patch('parcela/:id/baixar')
  baixar(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return this.service.baixarParcela(id, this.ctx(req, userId));
  }

  // ---- Exclusão/cancelamento de parcela (400 se PAGA) ----
  @Delete('parcela/:id')
  excluir(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return this.service.excluirParcela(id, this.ctx(req, userId));
  }
}
