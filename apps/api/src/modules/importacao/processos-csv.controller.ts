import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { Request } from 'express';
import { UserRole } from '@prisma/client';

import { ProcessosCsvService } from './processos-csv.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ModuloTenant } from '../../common/tenant/modulo-tenant.decorator';
import { Modulo } from '../../common/permissions/modulo.decorator';

/**
 * O QUE QUEM CONFIRMA A IMPORTAÇÃO PRECISA DECIDIR.
 *
 * Corpo OPCIONAL de propósito: a tela antiga chamava `POST :id/confirmar` sem
 * corpo nenhum, e com `forbidNonWhitelisted` ligado uma exigência nova aqui
 * quebraria a importação durante a janela de troca do deploy — o contêiner
 * antigo continua atendendo enquanto o novo sobe.
 */
export class ConfirmarImportacaoProcessosDto {
  @ApiPropertyOptional({
    default: false,
    description:
      'Deixa o robô de prazos avaliar as movimentações importadas. Padrão `false`: a planilha ' +
      'costuma ser acervo já acompanhado fora do sistema, e as tarefas nasceriam vencidas.',
  })
  @IsOptional() @IsBoolean()
  criarTarefasDePrazo?: boolean;
}

/**
 * IMPORTAÇÃO DE PROCESSOS EM LOTE.
 *
 * PREFIXO PRÓPRIO (`/importacoes/processos`), e não uma rota a mais em
 * `/importacoes` — o `@Get(':id')` de lá casaria "processos" como se fosse um
 * id de importação. Mesma razão e mesmo desenho do importador de colaboradores.
 *
 * GATEADO POR `processos`, e não por `importacao`: quem importa acervo jurídico
 * é o jurídico, e a permissão que importa é a de mexer em processo. Uma
 * instalação sem o módulo de processos não deve nem ver esta porta.
 */
@ApiTags('importacao-processos')
@ApiBearerAuth()
@ModuloTenant('processos')
@Modulo('processos')
@Controller('importacoes/processos')
@Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
export class ProcessosCsvController {
  constructor(private readonly service: ProcessosCsvService) {}

  private ctx(req: Request, userId?: string, nome?: string) {
    return { userId, nome, ip: req.ip };
  }

  /**
   * Sobe a planilha e devolve a conferência — NÃO importa nada ainda.
   *
   * Duas fases de propósito: uma importação de 82 processos é irreversível na
   * prática (desfazer significa apagar 82 registros com andamentos do CNJ
   * dentro), e ninguém deve descobrir que a coluna do advogado estava errada
   * depois de quarenta minutos de execução.
   */
  @Post('upload')
  @ApiOperation({ summary: 'Envia a planilha de processos e devolve a conferência (não importa).' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('arquivo', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser('id') userId: string,
    @CurrentUser('nome') nome: string,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('Envie a planilha no campo "arquivo".');
    if (!/\.(csv|txt|xlsx?)$/i.test(file.originalname)) {
      throw new BadRequestException('Formato não suportado. Envie .csv, .txt ou .xlsx.');
    }
    return this.service.processarUpload(file, this.ctx(req, userId, nome));
  }

  /** Como vai a importação — é o que a tela pergunta enquanto ela roda. */
  @Get(':id/resumo')
  @ApiOperation({ summary: 'Situação e contadores da importação.' })
  resumo(@Param('id') id: string) {
    return this.service.resumo(id);
  }

  @Get(':id/linhas')
  @ApiOperation({ summary: 'Linhas conferidas, com erros e avisos.' })
  linhas(
    @Param('id') id: string,
    @Query('apenasProblemas') apenasProblemas?: string,
    @Query('page') page?: string,
  ) {
    return this.service.listarLinhas(id, {
      apenasProblemas: apenasProblemas === 'true',
      page: Number(page) || 1,
    });
  }

  /**
   * Dispara a importação. Responde NA HORA, com status `IMPORTANDO`.
   *
   * São 80+ consultas ao CNJ com pausa entre elas — quarenta minutos que não
   * cabem num request. Quem acompanha é `GET :id/resumo`.
   */
  @Post(':id/confirmar')
  @ApiOperation({ summary: 'Executa a importação em segundo plano.' })
  confirmar(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('nome') nome: string,
    @Req() req: Request,
    @Body() body?: ConfirmarImportacaoProcessosDto,
  ) {
    return this.service.confirmar(id, this.ctx(req, userId, nome), {
      criarTarefasDePrazo: body?.criarTarefasDePrazo === true,
    });
  }
}
