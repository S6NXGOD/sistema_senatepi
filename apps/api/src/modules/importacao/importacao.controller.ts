import {
  BadRequestException,
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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { UserRole } from '@prisma/client';
import { ImportacaoService } from './importacao.service';
import { RelatorioImportacaoService } from './relatorio.service';
import { ConfirmarImportacaoDto, EditarLinhaDto } from './dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('importacao')
@ApiBearerAuth()
@Controller('importacoes')
@Roles(UserRole.ADMIN) // importação de filiados: apenas administradores
export class ImportacaoController {
  constructor(
    private readonly service: ImportacaoService,
    private readonly relatorio: RelatorioImportacaoService,
  ) {}

  @Post('upload')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('arquivo'))
  upload(@UploadedFile() file: Express.Multer.File, @CurrentUser('id') userId: string) {
    if (!file) throw new BadRequestException('Envie o arquivo no campo "arquivo"');
    return this.service.processarUpload(file, userId);
  }

  @Get(':id')
  progresso(@Param('id') id: string) {
    return this.service.obterProgresso(id);
  }

  @Get(':id/linhas')
  linhas(
    @Param('id') id: string,
    @Query('busca') busca?: string,
    @Query('status') status?: 'validos' | 'erros' | 'duplicados',
    @Query('page') page?: number,
  ) {
    return this.service.listarLinhas(id, { busca, status, page });
  }

  @Get(':id/resumo-validacao')
  resumoValidacao(@Param('id') id: string) {
    return this.service.resumoValidacao(id);
  }

  @Patch(':id/linhas/:linhaId')
  editarLinha(
    @Param('id') id: string,
    @Param('linhaId') linhaId: string,
    @Body() dto: EditarLinhaDto,
  ) {
    return this.service.editarLinha(id, linhaId, dto);
  }

  @Post(':id/confirmar')
  confirmar(
    @Param('id') id: string,
    @Body() dto: ConfirmarImportacaoDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return this.service.confirmar(id, dto, { userId, ip: req.ip });
  }

  @Get(':id/relatorio.pdf')
  @Header('Content-Type', 'application/pdf')
  async pdf(@Param('id') id: string, @Res() res: Response) {
    const buffer = await this.relatorio.pdf(id);
    res.setHeader('Content-Disposition', `inline; filename="importacao-${id}.pdf"`);
    res.send(buffer);
  }

  @Get(':id/relatorio.xlsx')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  async excel(@Param('id') id: string, @Res() res: Response) {
    const buffer = await this.relatorio.excel(id);
    res.setHeader('Content-Disposition', `attachment; filename="importacao-${id}.xlsx"`);
    res.send(buffer);
  }
}
