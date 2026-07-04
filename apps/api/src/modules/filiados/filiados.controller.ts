import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { UserRole } from '@prisma/client';
import { FiliadosService } from './filiados.service';
import {
  ChangeSituacaoDto,
  CreateFiliadoDto,
  DesfiliarDto,
  ListFiliadosQueryDto,
  UpdateFiliadoDto,
} from './dto/filiado.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('filiados')
@ApiBearerAuth()
@Controller('filiados')
export class FiliadosController {
  constructor(private readonly service: FiliadosService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.DIRETORIA, UserRole.FUNCIONARIO)
  create(@Body() dto: CreateFiliadoDto, @CurrentUser('nome') autor: string) {
    return this.service.create(dto, autor);
  }

  @Get()
  findAll(@Query() query: ListFiliadosQueryDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  perfil(@Param('id') id: string) {
    return this.service.perfil(id);
  }

  @Get(':id/qrcode')
  qrCode(@Param('id') id: string) {
    return this.service.qrCode(id);
  }

  @Get(':id/historico')
  historico(@Param('id') id: string) {
    return this.service.historico(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.DIRETORIA, UserRole.FUNCIONARIO)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateFiliadoDto,
    @CurrentUser('nome') autor: string,
  ) {
    return this.service.update(id, dto, autor);
  }

  @Patch(':id/situacao')
  @Roles(UserRole.ADMIN, UserRole.DIRETORIA)
  changeSituacao(
    @Param('id') id: string,
    @Body() dto: ChangeSituacaoDto,
    @CurrentUser('nome') autor: string,
  ) {
    return this.service.changeSituacao(id, dto, autor);
  }

  @Patch(':id/desfiliar')
  @Roles(UserRole.ADMIN, UserRole.DIRETORIA)
  desfiliar(
    @Param('id') id: string,
    @Body() dto: DesfiliarDto,
    @CurrentUser('nome') autor: string,
  ) {
    return this.service.desfiliar(id, dto.motivo, autor);
  }

  @Get(':id/desfiliacao/pdf')
  @Header('Content-Type', 'application/pdf')
  async termoDesfiliacao(
    @Param('id') id: string,
    @Query('motivo') motivo: string,
    @CurrentUser('nome') autor: string,
    @Res() res: Response,
  ) {
    const buffer = await this.service.gerarTermoDesfiliacaoPdf(id, motivo, autor);
    res.setHeader('Content-Disposition', `inline; filename="desfiliacao-${id}.pdf"`);
    res.send(buffer);
  }

  @Post(':id/foto')
  @Roles(UserRole.ADMIN, UserRole.DIRETORIA, UserRole.FUNCIONARIO)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('foto'))
  foto(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser('nome') autor: string,
  ) {
    if (!file) throw new BadRequestException('Arquivo "foto" é obrigatório');
    return this.service.atualizarFoto(id, file.buffer, autor);
  }

  @Post(':id/documentos')
  @Roles(UserRole.ADMIN, UserRole.DIRETORIA, UserRole.FUNCIONARIO)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('arquivo'))
  addDocumento(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('titulo') titulo: string,
    @CurrentUser('nome') autor: string,
  ) {
    if (!file) throw new BadRequestException('Arquivo "arquivo" é obrigatório');
    return this.service.addDocumento(id, file, titulo, autor);
  }

  @Delete(':id/documentos/:documentoId')
  @Roles(UserRole.ADMIN, UserRole.DIRETORIA, UserRole.FUNCIONARIO)
  removeDocumento(@Param('id') id: string, @Param('documentoId') documentoId: string) {
    return this.service.removeDocumento(id, documentoId);
  }

  @Get(':id/termo/pdf')
  @Header('Content-Type', 'application/pdf')
  async termo(
    @Param('id') id: string,
    @CurrentUser('nome') autor: string,
    @Res() res: Response,
  ) {
    const buffer = await this.service.gerarTermoPdf(id, autor);
    res.setHeader('Content-Disposition', `inline; filename="termo-${id}.pdf"`);
    res.send(buffer);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.DIRETORIA)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
